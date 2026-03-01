import type { Workspace } from "@/core/schema/types";
import type { ImportStep } from "./claude-adapter";
import { generateInstructions } from "./claude-adapter";
import {
  sendTabMessage,
  safeSendTabMessage,
  type AutofillStepStatus,
  type InstructionsDelivery,
} from "@/shared/messaging";

// ─── Types ──────────────────────────────────────────────────

export interface AutofillStepResult {
  id: string;
  title: string;
  status: AutofillStepStatus;
  /** Guided-mode fallback step shown when autofill fails */
  fallback?: ImportStep;
  /** Set on instructions-related steps to track delivery method */
  instructionsDelivery?: InstructionsDelivery;
}

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeOnTab(
  tabId: number,
  action: "click" | "fill" | "clear_and_fill",
  target: string,
  value?: string,
): Promise<boolean> {
  try {
    const response = await sendTabMessage(tabId, "AUTOFILL_EXECUTE", {
      action,
      target,
      value,
    });
    return response.success;
  } catch {
    return false;
  }
}

async function clipboardWrite(
  tabId: number,
  text: string,
): Promise<boolean> {
  try {
    const response = await sendTabMessage(tabId, "CLIPBOARD_WRITE", {
      text,
    });
    return response.success;
  } catch {
    return false;
  }
}

/**
 * Navigate a tab to a URL and wait for the page to finish loading.
 * Resolves true when the tab reaches "complete" status, false on timeout.
 */
async function navigateAndWaitForLoad(
  tabId: number,
  url: string,
  timeoutMs = 15000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ): void => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(() => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    });
  });
}

/**
 * Ping the content script repeatedly until it responds, confirming it's ready.
 * First attempt uses safeSendTabMessage which auto-injects if missing.
 */
async function waitForContentScript(
  tabId: number,
  maxRetries = 10,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // First attempt: auto-inject content script if not present
      const send = i === 0 ? safeSendTabMessage : sendTabMessage;
      const response = await send(tabId, "PING");
      if (response?.pong) return true;
    } catch {
      // Content script not ready yet
    }
    await delay(500);
  }
  return false;
}

// ─── Step Definitions ───────────────────────────────────────

interface AutofillStepDef {
  id: string;
  title: string;
  action:
    | "click"
    | "fill"
    | "clear_and_fill"
    | "navigate"
    | "manual"
    | "wait_for_navigation"
    | "fill_instructions";
  target?: string; // SELECTOR_MAP key
  value?: string;
  guidedIndex: number; // index into the guided steps for fallback
  phase: 1 | 2;
}

/**
 * Phase 1: Navigate to projects page, click Create, fill name + description,
 * click "Create project", then wait for navigation to project dashboard.
 */
function buildPhase1Defs(workspace: Workspace): AutofillStepDef[] {
  // Use workspace name as fallback if description is empty
  const description =
    workspace.description.trim().length > 0
      ? workspace.description
      : workspace.name;

  return [
    {
      id: `${workspace.id}-navigate`,
      title: "Opening Claude Projects",
      action: "navigate",
      guidedIndex: 0,
      phase: 1,
    },
    {
      id: `${workspace.id}-create`,
      title: "Clicking Create Project",
      action: "click",
      target: "projects.createButton",
      guidedIndex: 1,
      phase: 1,
    },
    {
      id: `${workspace.id}-name`,
      title: "Filling project name",
      action: "clear_and_fill",
      target: "form.nameInput",
      value: workspace.name,
      guidedIndex: 2,
      phase: 1,
    },
    {
      id: `${workspace.id}-description`,
      title: "Filling description",
      action: "clear_and_fill",
      target: "form.descriptionInput",
      value: description,
      guidedIndex: 3,
      phase: 1,
    },
    {
      id: `${workspace.id}-save`,
      title: "Creating project",
      action: "click",
      target: "form.saveButton",
      guidedIndex: 4,
      phase: 1,
    },
    {
      id: `${workspace.id}-wait-nav`,
      title: "Waiting for project page to load",
      action: "wait_for_navigation",
      guidedIndex: -1, // no guided equivalent
      phase: 1,
    },
  ];
}

/**
 * Phase 2: On the project dashboard, enter instructions and upload files.
 * Guided step indices continue from Phase 1 (which ends at index 4).
 */
function buildPhase2Defs(workspace: Workspace): AutofillStepDef[] {
  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;
  const defs: AutofillStepDef[] = [];

  let guidedIdx = 5; // continues from Phase 1

  if (instructions.trim().length > 0) {
    defs.push({
      id: `${workspace.id}-instructions`,
      title: "Entering project instructions",
      action: "fill_instructions",
      value: instructions,
      guidedIndex: guidedIdx++,
      phase: 2,
    });
  }

  // Knowledge files — always manual (DOM file upload is fragile)
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  if (compatibleFiles.length > 0) {
    defs.push({
      id: `${workspace.id}-files`,
      title: "Upload knowledge files (manual step)",
      action: "manual",
      guidedIndex: guidedIdx,
      phase: 2,
    });
  }

  return defs;
}

// ─── AsyncGenerator ─────────────────────────────────────────

/**
 * Autofill a single workspace as a Claude Project.
 *
 * Phase 1: Create the project (name + description on creation modal).
 * Phase 2: Enter instructions on the project dashboard (after SPA navigation).
 *
 * If instructions can't be autofilled, they are copied to clipboard
 * and the step yields a "clipboard" status.
 */
export async function* autofillWorkspace(
  workspace: Workspace,
  tabId: number,
  options: { hybrid?: boolean } = {},
): AsyncGenerator<AutofillStepResult, void, boolean | undefined> {
  const guidedInstructions = generateInstructions(workspace);
  const guidedSteps = guidedInstructions.steps;

  const phase1Defs = buildPhase1Defs(workspace);
  const phase2Defs = buildPhase2Defs(workspace);
  const allDefs = [...phase1Defs, ...phase2Defs];

  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;
  const hasInstructions = instructions.trim().length > 0;
  let instructionsDelivered = false;
  let clipboardCopied = false;

  for (const def of allDefs) {
    // ── Hybrid confirmation ──────────────────────────────
    if (options.hybrid && def.action !== "wait_for_navigation") {
      const pending: AutofillStepResult = {
        id: def.id,
        title: def.title,
        status: "pending",
      };
      const confirmed: boolean | undefined = yield pending;
      if (confirmed === false) {
        yield { id: def.id, title: def.title, status: "skipped" };
        continue;
      }
      yield { id: def.id, title: def.title, status: "running" };
    } else {
      yield { id: def.id, title: def.title, status: "running" };
    }

    // ── Navigate step ────────────────────────────────────
    if (def.action === "navigate") {
      console.log("[PortSmith] Navigate step: starting, tabId =", tabId);
      let navigationSucceeded = false;
      const maxAttempts = 3;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          yield { id: def.id, title: "Retrying navigation...", status: "running" };
        }

        try {
          const tab = await chrome.tabs.get(tabId);
          console.log("[PortSmith] Navigate step: current tab URL =", tab?.url, "attempt =", attempt + 1);

          const alreadyOnProjects = tab.url?.startsWith(
            "https://claude.ai/projects",
          );

          if (!alreadyOnProjects) {
            console.log("[PortSmith] Navigate step: navigating to claude.ai/projects");
            const loaded = await navigateAndWaitForLoad(
              tabId,
              "https://claude.ai/projects",
            );
            console.log("[PortSmith] Navigate step: navigateAndWaitForLoad result =", loaded);

            if (!loaded) {
              const retry: boolean | undefined = yield {
                id: def.id,
                title: "Could not navigate to Claude. Please open claude.ai/projects in your browser tab.",
                status: "navigate_failed",
              };
              if (retry === false) {
                console.log("[PortSmith] Navigate step: user cancelled");
                return;
              }
              console.log("[PortSmith] Navigate step: user retrying");
              continue;
            }
            // Give content script time to inject after page load
            await delay(1000);
          }

          // Verify content script is ready before proceeding
          console.log("[PortSmith] Navigate step: pinging content script");
          const ready = await waitForContentScript(tabId);
          console.log("[PortSmith] Navigate step: content script ready =", ready);

          if (ready) {
            // Bring the tab to the foreground so the user can see it
            try {
              await chrome.tabs.update(tabId, { active: true });
              const focusTab = await chrome.tabs.get(tabId);
              if (focusTab.windowId) {
                await chrome.windows.update(focusTab.windowId, { focused: true });
              }
            } catch (e) {
              console.log("[PortSmith] Navigate step: could not activate tab", e);
            }
            navigationSucceeded = true;
            break;
          }

          // Content script not responding — prompt user
          const retry: boolean | undefined = yield {
            id: def.id,
            title: "Claude page loaded but extension not responding. Please refresh claude.ai and click Retry.",
            status: "navigate_failed",
          };
          if (retry === false) {
            console.log("[PortSmith] Navigate step: user cancelled after content script failure");
            return;
          }
        } catch (err) {
          console.warn("[PortSmith] Navigate step: error", err);
          const retry: boolean | undefined = yield {
            id: def.id,
            title: "Navigation error. Please open claude.ai/projects manually and click Retry.",
            status: "navigate_failed",
          };
          if (retry === false) return;
        }
      }

      if (navigationSucceeded) {
        console.log("[PortSmith] Navigate step: success");
        yield { id: def.id, title: def.title, status: "success" };
      } else {
        console.warn("[PortSmith] Navigate step: failed after", maxAttempts, "attempts");
        yield {
          id: def.id,
          title: "Navigation failed — migration cannot proceed",
          status: "failed",
        };
        return;
      }
      await delay(500);
      continue;
    }

    // ── Wait for navigation step ─────────────────────────
    if (def.action === "wait_for_navigation") {
      let navSuccess = false;
      try {
        const result = await sendTabMessage(tabId, "WAIT_FOR_NAVIGATION", {
          urlPattern: "^https://claude\\.ai/project/[a-f0-9-]+",
          timeoutMs: 15000,
        });
        navSuccess = result.success;
      } catch {
        // Navigation detection failed
      }

      if (navSuccess) {
        yield { id: def.id, title: def.title, status: "success" };
        // Extra settle time for React hydration
        await delay(2000);
      } else {
        // Timeout or failure — fall through to clipboard mode for instructions
        if (hasInstructions && !instructionsDelivered && !clipboardCopied) {
          const copied = await clipboardWrite(tabId, instructions);
          if (copied) {
            clipboardCopied = true;
            yield {
              id: def.id,
              title: "Navigation took too long — instructions copied to clipboard",
              status: "clipboard",
              instructionsDelivery: "clipboard",
            };
            await delay(3000);
            continue;
          }
        }
        yield { id: def.id, title: def.title, status: "fallback" };
        await delay(3000);
      }
      continue;
    }

    // ── Manual step ──────────────────────────────────────
    if (def.action === "manual") {
      yield {
        id: def.id,
        title: def.title,
        status: "fallback",
        fallback: guidedSteps[def.guidedIndex],
      };
      continue;
    }

    // ── Compound instructions action ─────────────────────
    if (def.action === "fill_instructions") {
      let success = false;
      try {
        const result = await sendTabMessage(tabId, "FILL_PROJECT_INSTRUCTIONS", {
          instructions: def.value!,
        });
        success = result.success;
      } catch {
        // Message failed
      }

      if (success) {
        instructionsDelivered = true;
        yield { id: def.id, title: def.title, status: "success" };
        await delay(500);
        continue;
      }

      // Clipboard fallback
      if (hasInstructions && !clipboardCopied) {
        const copied = await clipboardWrite(tabId, instructions);
        if (copied) {
          clipboardCopied = true;
          yield {
            id: def.id,
            title: def.title,
            status: "clipboard",
            instructionsDelivery: "clipboard",
            fallback: guidedSteps[def.guidedIndex],
          };
          continue;
        }
      }

      yield {
        id: def.id,
        title: def.title,
        status: "fallback",
        fallback: guidedSteps[def.guidedIndex],
      };
      await delay(500);
      continue;
    }

    // ── DOM action (click or fill) ───────────────────────
    const success = await executeOnTab(
      tabId,
      def.action,
      def.target!,
      def.value,
    );

    if (success) {
      yield { id: def.id, title: def.title, status: "success" };
    } else {
      yield {
        id: def.id,
        title: def.title,
        status: "fallback",
        fallback: guidedSteps[def.guidedIndex],
      };
    }

    await delay(500);
  }

  // ── Final instructions status ──────────────────────────
  if (hasInstructions) {
    if (instructionsDelivered) {
      yield {
        id: `${workspace.id}-instructions-status`,
        title: "Instructions entered successfully",
        status: "success",
        instructionsDelivery: "autofilled",
      };
    } else if (!clipboardCopied) {
      // Last-resort clipboard copy
      const copied = await clipboardWrite(tabId, instructions);
      clipboardCopied = copied;
      yield {
        id: `${workspace.id}-instructions-status`,
        title: copied
          ? "Instructions copied to clipboard"
          : "Instructions require manual entry",
        status: copied ? "clipboard" : "fallback",
        instructionsDelivery: copied ? "clipboard" : "none",
      };
    }
  }
}
