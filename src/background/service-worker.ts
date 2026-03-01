import { APP_NAME, APP_VERSION } from "@/shared/constants";
import { initMessageRouter, onMessage } from "@/shared/messaging";
import { registerOrchestratorHandlers } from "./migration-orchestrator";
import { verifyProjects } from "@/core/adapters/claude-verifier";

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

  console.log("[PortSmith] DIAG-AUTH-1: Fetching access token from /api/auth/session");

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
    console.log(`[PortSmith] DIAG-AUTH-2: Token obtained (${token.substring(0, 8)}...)`);
    accessTokenCache.set(tabId, { token, ts: Date.now() });
  } else {
    console.log("[PortSmith] DIAG-AUTH-2: Failed to obtain access token");
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
    func: (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
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
    args: [payload.selector],
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
