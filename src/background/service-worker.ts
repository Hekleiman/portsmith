import { APP_NAME, APP_VERSION } from "@/shared/constants";
import { initMessageRouter, onMessage } from "@/shared/messaging";
import { registerOrchestratorHandlers } from "./migration-orchestrator";
import { verifyProjects } from "@/core/adapters/claude-verifier";

console.log(`${APP_NAME} service worker started (v${APP_VERSION})`);

initMessageRouter();
registerOrchestratorHandlers();

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

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [platform, id] of platformTabs) {
    if (id === tabId) {
      platformTabs.delete(platform);
      break;
    }
  }
});
