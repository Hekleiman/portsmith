import { APP_NAME, APP_VERSION } from "@/shared/constants";
import { initMessageRouter, onMessage } from "@/shared/messaging";
import { registerOrchestratorHandlers } from "./migration-orchestrator";
import { verifyProjects } from "@/core/adapters/claude-verifier";
import { saveFile } from "@/core/storage/indexed-db";

console.log(`${APP_NAME} service worker started (v${APP_VERSION})`);

initMessageRouter();
registerOrchestratorHandlers();

// Open side panel when the extension icon is clicked (no popup needed)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── Track active ChatGPT tabs ──────────────────────────────
// Content scripts send PAGE_STATE when they load. We record the
// tab so other extension contexts can locate it if needed.

const platformTabs = new Map<string, number>();

onMessage("PAGE_STATE", (payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId !== undefined) {
    platformTabs.set(payload.platform, tabId);
    console.log(
      `[${APP_NAME}] Registered ${payload.platform} tab ${tabId}: ${payload.url}`,
    );
  }
});

// ─── Project Verification ───────────────────────────────────

onMessage("VERIFY_PROJECTS", async (payload) => {
  return verifyProjects(payload.projectNames);
});

// ─── ChatGPT Access Token ───────────────────────────────────
// ChatGPT's backend API requires Authorization: Bearer <token>.
// The token is retrieved from /api/auth/session (MAIN world, same-origin
// cookies). Cached per tab to avoid re-fetching for every gizmo.

const accessTokenCache = new Map<number, { token: string; ts: number }>();
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getChatGPTAccessToken(tabId: number): Promise<string | null> {
  const cached = accessTokenCache.get(tabId);
  if (cached && Date.now() - cached.ts < TOKEN_TTL_MS) {
    return cached.token;
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      try {
        const resp = await fetch("https://chatgpt.com/api/auth/session");
        if (!resp.ok) return null;
        const data = await resp.json();
        return (data as Record<string, unknown>).accessToken ?? null;
      } catch {
        return null;
      }
    },
    args: [],
  });

  const token = result?.result as string | null;
  if (token) {
    accessTokenCache.set(tabId, { token, ts: Date.now() });
  }

  return token;
}

// ─── Gizmo API Fetch (MAIN world) ────────────────────────────
// Fetches project data from ChatGPT's backend API. Requires an access
// token obtained from /api/auth/session. Runs in MAIN world for
// same-origin cookie access.

onMessage("FETCH_GIZMO_API", async (payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { error: "No tab ID" };

  const token = await getChatGPTAccessToken(tabId);
  if (!token) return { error: "Could not retrieve ChatGPT access token" };

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (gizmoId: string, accessToken: string) => {
      try {
        const resp = await fetch(
          `https://chatgpt.com/backend-api/gizmos/${gizmoId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        return await resp.json();
      } catch (e) {
        return { error: String(e) };
      }
    },
    args: [payload.gizmoId, token],
  });

  return result?.result ?? { error: "executeScript failed" };
});

// ─── File Storage (from content script) ─────────────────────
// Content script downloads file blobs directly (same-origin fetch),
// then sends the base64 blob here for IndexedDB storage.

onMessage("STORE_DOWNLOADED_FILE", async (payload) => {
  try {
    const contentRef = `file-${payload.fileId}`;
    await saveFile(contentRef, payload.blob, payload.mimeType, payload.fileName);
    console.log("[PortSmith] Stored file in IndexedDB:", contentRef, payload.fileName);
    return { success: true, contentRef };
  } catch (e: unknown) {
    console.error("[PortSmith] Failed to store file:", e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// ─── Main-World Click Execution ─────────────────────────────
// Content scripts run in an ISOLATED world — synthetic events they dispatch
// are untrusted and Radix UI ignores them. This handler uses
// chrome.scripting.executeScript with world:'MAIN' so the click runs
// in the page's own JS context and is treated as a real user event.

onMessage("CLICK_IN_MAIN_WORLD", async (payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selector: string, text?: string) => {
      // ── Find the target element ──────────────────────────
      let el: HTMLElement | null = null;
      if (text) {
        const candidates = document.querySelectorAll(selector);
        for (const c of candidates) {
          if (
            c instanceof HTMLElement &&
            c.textContent?.trim().toLowerCase() === text.toLowerCase()
          ) {
            el = c;
            break;
          }
        }
      } else {
        el = document.querySelector(selector) as HTMLElement | null;
      }

      if (!el) {
        return false;
      }

      // ── Traverse to nearest interactive element ───────────
      const interactiveTags = new Set(["button", "a", "input", "select", "textarea"]);
      const isInteractive =
        interactiveTags.has(el.tagName.toLowerCase()) ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("tabindex") !== null;

      if (!isInteractive) {
        const parent = el.closest(
          "button, a, [role='button'], [tabindex]",
        ) as HTMLElement | null;
        if (parent) {
          el = parent;
        } else {
          const child = el.querySelector(
            "button, a, [role='button']",
          ) as HTMLElement | null;
          if (child) {
            el = child;
          }
        }
      }

      // ── Dismiss any active popover/dropdown ──────────────
      const focused = document.activeElement;
      if (focused && focused instanceof HTMLElement && focused !== el) {
        focused.blur();
        await new Promise((r) => setTimeout(r, 150));
      }

      // ── Compute click coordinates ─────────────────────────
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // ── Strategy 1: native .click() ──────────────────────
      el.click();

      // ── Strategy 2: form.requestSubmit() for form buttons ─
      if (el instanceof HTMLButtonElement && el.form) {
        try {
          el.form.requestSubmit(el);
        } catch {
          // Not all forms support requestSubmit
        }
      }

      // ── Strategy 3: dispatch full event sequence ──────────
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        pointerId: 1,
        pointerType: "mouse" as const,
      };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new PointerEvent("click", opts));
      el.dispatchEvent(new MouseEvent("click", opts));

      return true;
    },
    args: [payload.selector, payload.text],
  });

  return result?.result ?? false;
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  accessTokenCache.delete(tabId);
  for (const [platform, id] of platformTabs) {
    if (id === tabId) {
      platformTabs.delete(platform);
      break;
    }
  }
});
