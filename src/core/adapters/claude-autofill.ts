import type { Workspace } from "@/core/schema/types";
import type { ImportStep } from "./claude-adapter";
import { generateInstructions } from "./claude-adapter";
import {
  sendTabMessage,
  safeSendTabMessage,
  type AutofillStepStatus,
  type InstructionsDelivery,
} from "@/shared/messaging";
import { loadFile } from "@/core/storage/indexed-db";

// ─── Types ──────────────────────────────────────────────────

export interface AutofillStepResult {
  id: string;
  title: string;
  status: AutofillStepStatus;
  /** Guided-mode fallback step shown when autofill fails */
  fallback?: ImportStep;
  /** Set on instructions-related steps to track delivery method */
  instructionsDelivery?: InstructionsDelivery;
  /** Set on verify steps to indicate API verification passed */
  verified?: boolean;
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
    | "fill_instructions"
    | "dismiss_popover"
    | "api_create_project"
    | "api_set_instructions"
    | "api_verify_project"
    | "api_upload_files"
    | "navigate_to_project";
  target?: string; // SELECTOR_MAP key
  value?: string;
  guidedIndex: number; // index into the guided steps for fallback
  phase: 1 | 2;
}

/**
 * Build API-based step definitions for creating a Claude project.
 * Instead of clicking DOM buttons, this uses Claude's internal API.
 */
function buildApiStepDefs(workspace: Workspace): AutofillStepDef[] {
  const description =
    workspace.description.trim().length > 0
      ? workspace.description
      : workspace.name;
  const translatedInstructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;

  const defs: AutofillStepDef[] = [
    {
      id: `${workspace.id}-navigate`,
      title: "Opening Claude",
      action: "navigate",
      guidedIndex: 0,
      phase: 1,
    },
    {
      id: `${workspace.id}-create-api`,
      title: "Creating project",
      action: "api_create_project",
      value: JSON.stringify({ name: workspace.name, description }),
      guidedIndex: -1,
      phase: 1,
    },
  ];

  if (translatedInstructions.trim()) {
    defs.push({
      id: `${workspace.id}-instructions-api`,
      title: "Setting project instructions",
      action: "api_set_instructions",
      value: translatedInstructions,
      guidedIndex: -1,
      phase: 2,
    });
  }

  // Knowledge files — upload via API when blobs are available, manual for the rest
  // Upload BEFORE verify so verification can check the file count.
  const filesWithBlobs = workspace.knowledgeFiles.filter(
    (f) => f.compatible && f.contentRef,
  );
  const filesWithoutBlobs = workspace.knowledgeFiles.filter(
    (f) => f.compatible && !f.contentRef,
  );
  const incompatibleCount = workspace.knowledgeFiles.filter(
    (f) => !f.compatible,
  ).length;

  if (filesWithBlobs.length > 0) {
    defs.push({
      id: `${workspace.id}-upload-files`,
      title: `Uploading ${filesWithBlobs.length} file(s)`,
      action: "api_upload_files",
      value: JSON.stringify(
        filesWithBlobs.map((f) => ({
          contentRef: f.contentRef,
          fileName: f.originalName,
          mimeType: f.mimeType,
        })),
      ),
      guidedIndex: -1,
      phase: 2,
    });
  }

  // Verify the project was created correctly (after all API operations)
  defs.push({
    id: `${workspace.id}-verify`,
    title: "Verifying project",
    action: "api_verify_project",
    guidedIndex: -1,
    phase: 2,
  });

  // Navigate to the new project page so the user can see it
  defs.push({
    id: `${workspace.id}-open-project`,
    title: "Opening your new project",
    action: "navigate_to_project",
    guidedIndex: -1,
    phase: 2,
  });

  // Manual step for files without blobs or incompatible files
  if (filesWithoutBlobs.length > 0 || incompatibleCount > 0) {
    const guidedIdx = translatedInstructions.trim() ? 8 : 5;
    const manualCount = filesWithoutBlobs.length + incompatibleCount;
    defs.push({
      id: `${workspace.id}-files`,
      title: `Upload remaining files (${manualCount} need attention)`,
      action: "manual",
      guidedIndex: guidedIdx,
      phase: 2,
    });
  }

  return defs;
}

// ─── Legacy DOM-based step builders (kept as fallback) ──────
// These are no longer used in the primary flow. The API-based
// approach above replaces them. Preserved in case API calls
// become unavailable and we need to revert to DOM automation.

// function buildPhase1Defs(workspace: Workspace): AutofillStepDef[] { ... }
// function buildPhase2Defs(workspace: Workspace): AutofillStepDef[] { ... }

// ─── AsyncGenerator ─────────────────────────────────────────

/**
 * Autofill a single workspace as a Claude Project.
 *
 * Uses Claude's internal API to create the project and set instructions.
 * Falls back to guided mode if API calls fail. Falls back to clipboard
 * if instructions API fails.
 */
export async function* autofillWorkspace(
  workspace: Workspace,
  tabId: number,
  options: { hybrid?: boolean } = {},
): AsyncGenerator<AutofillStepResult, void, boolean | undefined> {
  const guidedInstructions = generateInstructions(workspace);
  const guidedSteps = guidedInstructions.steps;

  const allDefs = buildApiStepDefs(workspace);

  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;
  const hasInstructions = instructions.trim().length > 0;
  let instructionsDelivered = false;
  let clipboardCopied = false;

  // UUID of the project created via API, used for subsequent steps
  let createdProjectUuid: string | null = null;

  for (const def of allDefs) {
    // ── Hybrid confirmation (skip internal steps) ────────
    const skipHybrid =
      def.action === "api_create_project" ||
      def.action === "api_set_instructions" ||
      def.action === "api_verify_project" ||
      def.action === "api_upload_files" ||
      def.action === "navigate_to_project";
    if (options.hybrid && !skipHybrid) {
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

          const alreadyOnClaude = /claude\.ai\//.test(tab.url ?? "");

          if (!alreadyOnClaude) {
            console.log("[PortSmith] Navigate step: navigating to claude.ai");
            const loaded = await navigateAndWaitForLoad(
              tabId,
              "https://claude.ai/projects",
            );
            console.log("[PortSmith] Navigate step: navigateAndWaitForLoad result =", loaded);

            if (!loaded) {
              const retry: boolean | undefined = yield {
                id: def.id,
                title: "Could not navigate to Claude. Please open claude.ai in your browser tab.",
                status: "navigate_failed",
              };
              if (retry === false) {
                console.log("[PortSmith] Navigate step: user cancelled");
                return;
              }
              console.log("[PortSmith] Navigate step: user retrying");
              continue;
            }
            await delay(1000);
          }

          // Verify content script is ready (needed for clipboard fallback)
          console.log("[PortSmith] Navigate step: pinging content script");
          const ready = await waitForContentScript(tabId);
          console.log("[PortSmith] Navigate step: content script ready =", ready);

          if (ready) {
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
            title: "Navigation error. Please open claude.ai manually and click Retry.",
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

    // ── API: Create project ──────────────────────────────
    if (def.action === "api_create_project") {
      try {
        const { name, description } = JSON.parse(def.value ?? "{}") as {
          name: string;
          description: string;
        };
        console.log("[PortSmith] Calling CLAUDE_CREATE_PROJECT via content script, tabId:", tabId);
        const result = await safeSendTabMessage(tabId, "CLAUDE_CREATE_PROJECT", {
          name,
          description,
        });
        console.log("[PortSmith] CLAUDE_CREATE_PROJECT result:", JSON.stringify(result));

        if (result.success && result.uuid) {
          createdProjectUuid = result.uuid;
          console.log("[PortSmith] API create succeeded, uuid =", result.uuid);
          yield { id: def.id, title: def.title, status: "success" };
        } else {
          console.log("[PortSmith] API create failed:", result.error);
          yield {
            id: def.id,
            title: def.title,
            status: "fallback",
            fallback: guidedSteps[1], // "Start a new project" step
          };
        }
      } catch (e) {
        console.log("[PortSmith] API create error:", e);
        yield {
          id: def.id,
          title: def.title,
          status: "fallback",
          fallback: guidedSteps[1],
        };
      }
      continue;
    }

    // ── API: Set instructions ────────────────────────────
    if (def.action === "api_set_instructions") {
      if (!createdProjectUuid) {
        // Project wasn't created via API — fall back to clipboard
        if (def.value) {
          const clipOk = await clipboardWrite(tabId, def.value);
          clipboardCopied = clipOk;
          yield {
            id: def.id,
            title: def.title,
            status: clipOk ? "clipboard" : "fallback",
            instructionsDelivery: clipOk ? "clipboard" : "none",
          };
        } else {
          yield { id: def.id, title: def.title, status: "skipped" };
        }
        continue;
      }

      try {
        console.log("[PortSmith] Calling CLAUDE_SET_INSTRUCTIONS via content script, tabId:", tabId);
        const result = await safeSendTabMessage(tabId, "CLAUDE_SET_INSTRUCTIONS", {
          projectUuid: createdProjectUuid,
          instructions: def.value ?? "",
        });
        console.log("[PortSmith] CLAUDE_SET_INSTRUCTIONS result:", JSON.stringify(result));

        if (result.success) {
          instructionsDelivered = true;
          console.log("[PortSmith] API set instructions succeeded");
          yield {
            id: def.id,
            title: def.title,
            status: "success",
            instructionsDelivery: "autofilled",
          };
        } else {
          console.log("[PortSmith] API set instructions failed:", result.error);
          const clipOk = def.value
            ? await clipboardWrite(tabId, def.value)
            : false;
          clipboardCopied = clipOk;
          yield {
            id: def.id,
            title: def.title,
            status: clipOk ? "clipboard" : "fallback",
            instructionsDelivery: clipOk ? "clipboard" : "none",
          };
        }
      } catch (e) {
        console.log("[PortSmith] API set instructions error:", e);
        const clipOk = def.value
          ? await clipboardWrite(tabId, def.value)
          : false;
        clipboardCopied = clipOk;
        yield {
          id: def.id,
          title: def.title,
          status: clipOk ? "clipboard" : "fallback",
          instructionsDelivery: clipOk ? "clipboard" : "none",
        };
      }
      continue;
    }

    // ── API: Upload files ─────────────────────────────────
    if (def.action === "api_upload_files") {
      if (!createdProjectUuid) {
        yield { id: def.id, title: def.title, status: "skipped" };
        continue;
      }

      try {
        const files = JSON.parse(def.value ?? "[]") as Array<{
          contentRef: string;
          fileName: string;
          mimeType: string;
        }>;
        let uploaded = 0;
        let failed = 0;

        for (const file of files) {
          try {
            const fileRecord = await loadFile(file.contentRef);
            if (!fileRecord?.blob) {
              console.log("[PortSmith] No blob found for:", file.contentRef);
              failed++;
              continue;
            }

            const result = await safeSendTabMessage(tabId, "CLAUDE_UPLOAD_FILE", {
              projectUuid: createdProjectUuid,
              fileName: file.fileName,
              fileBlob: fileRecord.blob,
              mimeType: file.mimeType,
            });

            if (result.success) {
              uploaded++;
              console.log("[PortSmith] Uploaded:", file.fileName);
            } else {
              failed++;
              console.log("[PortSmith] Upload failed:", file.fileName, result.error);
            }
          } catch (e) {
            failed++;
            console.log("[PortSmith] Upload error:", file.fileName, e);
          }
        }

        if (failed === 0) {
          yield { id: def.id, title: `Uploaded ${uploaded} file(s)`, status: "success" };
        } else if (uploaded > 0) {
          yield {
            id: def.id,
            title: `Uploaded ${uploaded}/${files.length} (${failed} failed)`,
            status: "fallback",
          };
        } else {
          yield { id: def.id, title: "File upload failed", status: "fallback" };
        }
      } catch (e) {
        console.log("[PortSmith] api_upload_files error:", e);
        yield { id: def.id, title: def.title, status: "fallback" };
      }
      continue;
    }

    // ── API: Verify project ─────────────────────────────
    if (def.action === "api_verify_project") {
      if (!createdProjectUuid) {
        yield { id: def.id, title: def.title, status: "skipped" };
        continue;
      }

      try {
        const result = await safeSendTabMessage(tabId, "CLAUDE_VERIFY_PROJECT", {
          projectUuid: createdProjectUuid,
        });

        if (result.success) {
          const issues: string[] = [];
          if (result.name !== workspace.name) {
            issues.push(`Name mismatch: expected "${workspace.name}", got "${result.name}"`);
          }

          const expectedInstructions =
            workspace.instructions.translated?.claude ?? workspace.instructions.raw;
          if (expectedInstructions.trim() && !result.hasInstructions) {
            issues.push("Instructions not found on project");
          }

          if (issues.length > 0) {
            console.log("[PortSmith] Verification issues:", issues);
            yield {
              id: def.id,
              title: `Verified with ${issues.length} issue(s)`,
              status: "fallback",
              verified: false,
            };
          } else {
            console.log("[PortSmith] Verification passed: name matches, instructions present");
            yield { id: def.id, title: "Project verified", status: "success", verified: true };
          }
        } else {
          console.log("[PortSmith] Verification API failed:", result.error);
          yield { id: def.id, title: def.title, status: "skipped" };
        }
      } catch (e) {
        console.log("[PortSmith] Verification error:", e);
        yield { id: def.id, title: def.title, status: "skipped" };
      }
      continue;
    }

    // ── Navigate to new project page ─────────────────────
    if (def.action === "navigate_to_project") {
      if (createdProjectUuid) {
        try {
          await navigateAndWaitForLoad(
            tabId,
            `https://claude.ai/project/${createdProjectUuid}`,
          );
          await delay(1000);
        } catch {
          // Non-fatal — user can navigate manually
        }
      }
      yield { id: def.id, title: def.title, status: "success" };
      continue;
    }

    // ── Manual step — always pause for user confirmation ──
    if (def.action === "manual") {
      const pending: AutofillStepResult = {
        id: def.id,
        title: def.title,
        status: "pending",
        fallback: guidedSteps[def.guidedIndex],
      };
      const confirmed: boolean | undefined = yield pending;

      if (confirmed === false) {
        yield { id: def.id, title: def.title, status: "skipped" };
      } else {
        yield { id: def.id, title: def.title, status: "success" };
      }
      continue;
    }

    // ── DOM action (click or fill) — legacy fallback ─────
    const success = await executeOnTab(
      tabId,
      def.action as "click" | "fill" | "clear_and_fill",
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
