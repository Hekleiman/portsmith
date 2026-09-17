import { APP_NAME, APP_VERSION } from "@/shared/constants";
import { initMessageRouter, onMessage } from "@/shared/messaging";
import { registerOrchestratorHandlers } from "./migration-orchestrator";
import { verifyProjects } from "@/core/adapters/claude-verifier";
import { saveFile } from "@/core/storage/indexed-db";
import { normalizeGizmoId } from "@/shared/chatgpt-ids";

console.log(`${APP_NAME} service worker started (v${APP_VERSION})`);

initMessageRouter();
registerOrchestratorHandlers();

// Clicking the toolbar icon opens the side panel. (The manifest has no
// default_popup: a popup would take precedence over this behavior.)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => {
    console.warn(`[${APP_NAME}] Could not set side panel behavior:`, err);
  });

// ─── Sender checks ──────────────────────────────────────────
// Only our own content scripts on these hosts, or our own extension pages,
// may use the privileged handlers below.

function senderHost(sender: chrome.runtime.MessageSender): string | null {
  try {
    return sender.url ? new URL(sender.url).host : null;
  } catch {
    return null;
  }
}

function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    (sender.url ?? "").startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

function isFromContentScript(
  sender: chrome.runtime.MessageSender,
  hosts: string[],
): boolean {
  const host = senderHost(sender);
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    host !== null &&
    hosts.includes(host)
  );
}

const CONTENT_SCRIPT_HOSTS = ["chatgpt.com", "claude.ai", "gemini.google.com"];

// Content scripts announce themselves with PAGE_STATE. Nothing needs the
// tab registry today, so the message is just acknowledged.
onMessage("PAGE_STATE", () => undefined);

// ─── Project Verification ───────────────────────────────────

onMessage("VERIFY_PROJECTS", async (payload, sender) => {
  if (!isFromExtensionPage(sender)) {
    return { found: [], notFound: payload.projectNames, error: "Not allowed" };
  }
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
  if (tabId === undefined || !isFromContentScript(sender, ["chatgpt.com"])) {
    return { error: "Not allowed" };
  }

  const bareId = normalizeGizmoId(payload.gizmoId);
  if (!bareId) return { error: `Unrecognized gizmo ID: ${payload.gizmoId}` };

  const token = await getChatGPTAccessToken(tabId);
  if (!token) return { error: "Could not retrieve ChatGPT access token" };

  // Try the bare ID first; project URLs carry a readable slug after it.
  const candidates = [...new Set([bareId, payload.gizmoId])];

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (ids: string[], accessToken: string) => {
      let lastError = "";
      for (const id of ids) {
        try {
          const resp = await fetch(
            `https://chatgpt.com/backend-api/gizmos/${encodeURIComponent(id)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (resp.ok) return await resp.json();
          lastError = `HTTP ${resp.status}`;
          if (resp.status !== 404) break;
        } catch (e) {
          lastError = String(e);
          break;
        }
      }
      return { error: lastError || "Request failed" };
    },
    args: [candidates, token],
  });

  return result?.result ?? { error: "executeScript failed" };
});

// ─── File Storage (from content script) ─────────────────────
// Content script downloads file blobs directly (same-origin fetch),
// then sends the base64 blob here for IndexedDB storage.

onMessage("STORE_DOWNLOADED_FILE", async (payload, sender) => {
  if (!isFromContentScript(sender, CONTENT_SCRIPT_HOSTS)) {
    return { success: false, error: "Not allowed" };
  }
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
// Used by the DOM fallbacks. Dispatching from the page's MAIN world makes
// the events come from the page's own realm, which some React/Radix
// components handle more reliably than events built in the content
// script's isolated world. (They are still untrusted events.)

onMessage("CLICK_IN_MAIN_WORLD", async (payload, sender) => {
  const tabId = sender.tab?.id;
  if (
    tabId === undefined ||
    !isFromContentScript(sender, ["chatgpt.com", "claude.ai"])
  ) {
    return false;
  }

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

      // ── Dispatch one complete pointer/mouse sequence ─────
      // Radix menus open on pointerdown; ordinary buttons react to the
      // single click at the end. (The old version fired el.click(),
      // requestSubmit() and two more click events, so toggles flipped
      // several times and form buttons could submit more than once.)
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
        pointerType: "mouse" as const,
        isPrimary: true,
      };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
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
});
