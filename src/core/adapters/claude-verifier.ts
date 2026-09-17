import { safeSendTabMessage } from "@/shared/messaging";

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
 * Check that projects with these names exist in the user's Claude account.
 *
 * Uses Claude's project list API through the content script. The previous
 * version navigated the user's Claude tab to /projects and scanned the
 * page, which pulled the user away from the project they had just opened.
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

  try {
    return await safeSendTabMessage(tabId, "CLAUDE_FIND_PROJECTS", {
      names: projectNames,
    });
  } catch {
    return {
      found: [],
      notFound: projectNames,
      error: "Could not reach the Claude tab. Verification skipped.",
    };
  }
}
