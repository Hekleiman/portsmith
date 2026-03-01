import { sendTabMessage } from "@/shared/messaging";

// ─── Types ──────────────────────────────────────────────────

export interface VerificationResult {
  found: string[];
  notFound: string[];
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────

async function findClaudeTab(): Promise<number | null> {
  try {
    const active = await chrome.tabs.query({
      url: "https://claude.ai/*",
      active: true,
      currentWindow: true,
    });
    if (active.length > 0 && active[0]?.id != null) return active[0].id;

    const all = await chrome.tabs.query({ url: "https://claude.ai/*" });
    if (all.length > 0 && all[0]?.id != null) return all[0].id;
  } catch {
    // Not in extension context
  }
  return null;
}

// ─── Verification ───────────────────────────────────────────

/**
 * Best-effort verification: checks claude.ai/projects page for
 * project names that match migrated workspaces.
 *
 * Runs in the service worker context. Finds the active Claude tab,
 * navigates to /projects, then asks the content script to scan
 * the DOM for matching project names.
 */
export async function verifyProjects(
  projectNames: string[],
): Promise<VerificationResult> {
  if (projectNames.length === 0) {
    return { found: [], notFound: [] };
  }

  const tabId = await findClaudeTab();
  if (tabId === null) {
    return {
      found: [],
      notFound: projectNames,
      error: "No Claude tab found. Open claude.ai to verify projects.",
    };
  }

  // Navigate to projects page for scanning
  try {
    await chrome.tabs.update(tabId, { url: "https://claude.ai/projects" });
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch {
    return {
      found: [],
      notFound: projectNames,
      error: "Could not navigate to Claude projects page.",
    };
  }

  // Ask the content script to scan the DOM
  try {
    return await sendTabMessage(tabId, "VERIFY_PROJECTS", { projectNames });
  } catch {
    return {
      found: [],
      notFound: projectNames,
      error: "Could not communicate with Claude page. Verification skipped.",
    };
  }
}
