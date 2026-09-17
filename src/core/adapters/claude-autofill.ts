import type { KnowledgeFile, Workspace } from "@/core/schema/types";
import type { ImportStep } from "./claude-adapter";
import {
  safeSendTabMessage,
  sendTabMessage,
  type AutofillStepStatus,
  type InstructionsDelivery,
} from "@/shared/messaging";
import { loadFile } from "@/core/storage/indexed-db";
import { getInstructionsForTarget } from "@/core/platforms";
import {
  projectMemoryEntryCount,
  projectMemoryFileName,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";
import { buildManualCreateFallback, handOverNote } from "./manual-fallback";

// ─── Types ──────────────────────────────────────────────────

export interface AutofillStepResult {
  id: string;
  title: string;
  status: AutofillStepStatus;
  /** Manual instructions shown when a step needs the user */
  fallback?: ImportStep;
  /** Set on instructions-related steps to track delivery method */
  instructionsDelivery?: InstructionsDelivery;
  /** Set on verify steps to indicate API verification passed */
  verified?: boolean;
  /** True once the project exists (created by API or confirmed by the user) */
  projectCreated?: boolean;
  /** Button labels for "pending" steps */
  confirmLabel?: string;
  skipLabel?: string;
  /** Knowledge files that reached Claude in this step */
  filesDelivered?: number;
  /** True once the project memory document is in the project */
  projectMemoryAdded?: boolean;
  /** Something the user still has to check, whatever the step's status */
  followUp?: string;
}

export interface AutofillOptions {
  /** Ask before creating each project */
  hybrid?: boolean;
  /** Name of the source platform, used in user-facing text */
  sourceLabel?: string;
}

/** Value the orchestrator sends back into the generator after a pause. */
type Resume = boolean | undefined;

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

/**
 * Make sure the tab is on claude.ai with a live content script.
 * Yields "navigate_failed" prompts and waits for the user to retry.
 * Returns true when ready.
 */
async function* ensureClaudeReady(
  tabId: number,
  stepId: string,
): AsyncGenerator<AutofillStepResult, boolean, Resume> {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      yield { id: stepId, title: "Retrying...", status: "running" };
    }

    let problem: string;
    try {
      const tab = await chrome.tabs.get(tabId);
      const onClaude = /^https:\/\/claude\.ai\//.test(tab.url ?? "");
      let loaded = true;
      if (!onClaude) {
        loaded = await navigateAndWaitForLoad(tabId, "https://claude.ai/projects");
        if (loaded) await delay(1000);
      }
      if (loaded && (await waitForContentScript(tabId))) return true;
      problem = loaded
        ? "Claude loaded but PortSmith can't reach the page. Refresh the Claude tab, then click Retry."
        : "Could not open Claude. Open claude.ai in the PortSmith tab, then click Retry.";
    } catch (err) {
      console.warn("[PortSmith] Claude tab check failed:", err);
      problem = "The Claude tab was closed or can't be reached. Open claude.ai, then click Retry.";
    }

    // Only offer Retry when there is an attempt left to use it.
    if (attempt === maxAttempts - 1) return false;
    const retry: Resume = yield { id: stepId, title: problem, status: "navigate_failed" };
    if (retry === false) return false;
  }

  return false;
}

async function focusTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // Not critical
  }
}

interface ProjectMatch {
  uuid: string;
  createdAt: string;
}

/** Projects with this name (newest first), or null if the lookup failed. */
async function findProjectsNamed(
  tabId: number,
  name: string,
): Promise<ProjectMatch[] | null> {
  try {
    const result = await safeSendTabMessage(tabId, "CLAUDE_FIND_PROJECTS", {
      names: [name],
    });
    if (result.error) return null;
    return (result.matches ?? []).map((m) => ({ uuid: m.uuid, createdAt: m.createdAt }));
  } catch {
    return null;
  }
}

function projectUrl(uuid: string): string {
  return `https://claude.ai/project/${uuid}`;
}

/**
 * Claude's documented per-file limit for project files
 * (support.claude.com, "Upload files to Claude", checked Sep 2026).
 */
export const CLAUDE_PROJECT_FILE_LIMIT_BYTES = 30 * 1024 * 1024;

function handNote(file: KnowledgeFile): string {
  if (file.sizeBytes > CLAUDE_PROJECT_FILE_LIMIT_BYTES) {
    return "larger than Claude's 30 MB limit for project files; split or compress it first";
  }
  return file.conversionNeeded ?? "Claude doesn't take this format as a project file";
}

// ─── AsyncGenerator ─────────────────────────────────────────

/**
 * Create one workspace as a Claude Project through Claude's internal API.
 *
 * Yields progress for the side panel. "pending" steps pause the run until
 * the user confirms (the orchestrator passes the answer back into the
 * generator). Anything the API can't do becomes a manual card with the
 * text to copy and the files to download, instead of a clipboard write.
 */
export async function* autofillWorkspace(
  workspace: Workspace,
  tabId: number,
  options: AutofillOptions = {},
): AsyncGenerator<AutofillStepResult, void, Resume> {
  const sourceLabel = options.sourceLabel ?? "your previous assistant";
  const name = workspace.name;
  const description =
    workspace.description.trim().length > 0 ? workspace.description : name;
  const instructions = getInstructionsForTarget(workspace, "claude");
  const memoryDoc = renderProjectMemoryMarkdown(workspace, sourceLabel);
  const tooLarge = (f: KnowledgeFile): boolean =>
    f.sizeBytes > CLAUDE_PROJECT_FILE_LIMIT_BYTES;
  const uploadable = workspace.knowledgeFiles.filter(
    (f) => f.compatible && f.contentRef && !tooLarge(f),
  );
  // Everything else needs the user: files we couldn't copy, formats Claude
  // doesn't take as project files, and files over the size limit.
  const byHand = workspace.knowledgeFiles.filter((f) => !uploadable.includes(f));

  // ── 1. Claude tab ready ──────────────────────────────
  const navId = `${workspace.id}-navigate`;
  yield { id: navId, title: "Opening Claude", status: "running" };
  const ready = yield* ensureClaudeReady(tabId, navId);
  if (!ready) {
    yield {
      id: navId,
      title: "Claude isn't reachable, so this workspace was not migrated",
      status: "failed",
    };
    return;
  }
  await focusTab(tabId);
  yield { id: navId, title: "Claude is ready", status: "success" };

  // ── 2. Create the project ────────────────────────────
  const createId = `${workspace.id}-create-api`;
  if (options.hybrid) {
    const go: Resume = yield {
      id: createId,
      title: `Create the project "${name}" in Claude?`,
      status: "pending",
      confirmLabel: "Create project",
      skipLabel: "Skip",
    };
    if (go === false) {
      yield { id: createId, title: `Skipped "${name}"`, status: "skipped" };
      return;
    }
  }

  // Don't create a second project with the same name without asking
  // (a stopped or repeated run, or a project the user made by hand).
  yield { id: createId, title: "Checking your existing projects", status: "running" };
  const before = await findProjectsNamed(tabId, name);
  if (before && before.length > 0) {
    const again: Resume = yield {
      id: createId,
      title: `A project named "${name}" is already in Claude. Create another one?`,
      status: "pending",
      confirmLabel: "Create another",
      skipLabel: "Skip this one",
    };
    if (again === false) {
      yield {
        id: createId,
        title: "Skipped: a project with this name is already in Claude",
        status: "skipped",
      };
      return;
    }
  }

  yield { id: createId, title: "Creating project", status: "running" };
  let projectUuid: string | null = null;
  let createError = "";
  try {
    const result = await safeSendTabMessage(tabId, "CLAUDE_CREATE_PROJECT", {
      name,
      description,
    });
    if (result.success && result.uuid) {
      projectUuid = result.uuid;
    } else {
      createError = result.error ?? "Unknown error";
    }
  } catch (err) {
    createError = errorText(err);
  }

  if (!projectUuid && before !== null) {
    // A failed or timed-out request may still have created the project.
    // Only a project that wasn't there a moment ago can be ours; without
    // that baseline (the first lookup failed) the user decides.
    const after = await findProjectsNamed(tabId, name);
    const known = new Set(before.map((p) => p.uuid));
    const fresh = after?.filter((p) => !known.has(p.uuid)) ?? [];
    if (fresh.length === 1 && fresh[0]) {
      console.warn(
        `[PortSmith] Create reported "${createError}", but the project exists; continuing with it`,
      );
      projectUuid = fresh[0].uuid;
    }
  }

  if (!projectUuid) {
    console.warn("[PortSmith] Project creation failed:", createError);
    const done: Resume = yield {
      id: createId,
      title: "Couldn't create the project automatically",
      status: "pending",
      fallback: buildManualCreateFallback(
        workspace,
        "claude",
        sourceLabel,
        `Claude didn't confirm the new project (${createError}). Check your Claude projects first. If "${name}" isn't there, create it by hand:`,
      ),
      confirmLabel: "It's in Claude now",
      skipLabel: "Skip this one",
    };
    if (done === false) {
      yield { id: createId, title: "Not created", status: "skipped" };
    } else {
      yield {
        id: createId,
        title: "Created by hand",
        status: "success",
        projectCreated: true,
        instructionsDelivery: instructions.trim() ? "manual" : "none",
        followUp: handOverNote(workspace, instructions, memoryDoc),
      };
    }
    return;
  }

  yield {
    id: createId,
    title: "Project created",
    status: "success",
    projectCreated: true,
  };

  // ── 3. Instructions ──────────────────────────────────
  if (instructions.trim()) {
    const id = `${workspace.id}-instructions-api`;
    yield { id, title: "Setting project instructions", status: "running" };
    let error = "";
    try {
      const result = await safeSendTabMessage(tabId, "CLAUDE_SET_INSTRUCTIONS", {
        projectUuid,
        instructions,
      });
      if (!result.success) error = result.error ?? "Unknown error";
    } catch (err) {
      error = errorText(err);
    }

    if (!error) {
      yield {
        id,
        title: "Instructions set",
        status: "success",
        instructionsDelivery: "autofilled",
      };
    } else {
      const done: Resume = yield {
        id,
        title: "Add the instructions by hand",
        status: "pending",
        fallback: {
          id,
          title: "Paste the project instructions",
          description: `Claude didn't accept the instructions automatically (${error}). Open the project, click "Instructions", paste the text below and click "Save instructions".`,
          copyBlocks: [{ label: "Instructions", content: instructions }],
          link: projectUrl(projectUuid),
        },
        confirmLabel: "I've added them",
        skipLabel: "Skip",
      };
      yield {
        id,
        title: done === false ? "Instructions skipped" : "Instructions added by hand",
        status: done === false ? "skipped" : "success",
        instructionsDelivery: done === false ? "none" : "manual",
      };
    }
  }

  // ── 4. Project memory ────────────────────────────────
  if (memoryDoc) {
    const id = `${workspace.id}-memory-doc`;
    const count = projectMemoryEntryCount(workspace);
    const fileName = projectMemoryFileName(sourceLabel);
    yield { id, title: "Adding project memory", status: "running" };
    let error = "";
    try {
      const result = await safeSendTabMessage(tabId, "CLAUDE_CREATE_DOC", {
        projectUuid,
        fileName,
        content: memoryDoc,
      });
      if (!result.success) error = result.error ?? "Unknown error";
    } catch (err) {
      error = errorText(err);
    }

    if (!error) {
      yield {
        id,
        title: `Project memory added (${count} note${count === 1 ? "" : "s"})`,
        status: "success",
        projectMemoryAdded: true,
      };
    } else {
      const done: Resume = yield {
        id,
        title: "Add the project memory by hand",
        status: "pending",
        fallback: {
          id,
          title: "Add the project memory",
          description: `Claude didn't accept the memory document (${error}). In the project, click the "+" in the "Context" section and upload the file below, or add the text as text content.`,
          copyBlocks: [{ label: "Project memory", content: memoryDoc }],
          downloads: [
            {
              label: "Project memory",
              fileName,
              mimeType: "text/markdown",
              content: memoryDoc,
            },
          ],
          link: projectUrl(projectUuid),
        },
        confirmLabel: "I've added it",
        skipLabel: "Skip",
      };
      yield {
        id,
        title: done === false ? "Project memory skipped" : "Project memory added by hand",
        status: done === false ? "skipped" : "success",
        projectMemoryAdded: done !== false,
      };
    }
  }

  // ── 5. Knowledge files ───────────────────────────────
  if (uploadable.length > 0) {
    const id = `${workspace.id}-upload-files`;
    yield {
      id,
      title: `Uploading ${uploadable.length} file(s)`,
      status: "running",
    };
    const failed: typeof uploadable = [];
    const failures: string[] = [];

    for (const file of uploadable) {
      try {
        const record = await loadFile(file.contentRef!);
        if (!record?.blob) {
          failed.push(file);
          failures.push(`${file.originalName}: file data is missing`);
          continue;
        }
        const result = await safeSendTabMessage(tabId, "CLAUDE_UPLOAD_FILE", {
          projectUuid,
          fileName: file.originalName,
          fileBlob: record.blob,
          mimeType: file.mimeType,
        });
        if (!result.success) {
          failed.push(file);
          failures.push(`${file.originalName}: ${result.error ?? "upload failed"}`);
        }
      } catch (err) {
        failed.push(file);
        failures.push(`${file.originalName}: ${errorText(err)}`);
      }
    }

    const uploaded = uploadable.length - failed.length;
    if (failed.length === 0) {
      yield {
        id,
        title: `Uploaded ${uploaded} file(s)`,
        status: "success",
        filesDelivered: uploaded,
      };
    } else {
      const done: Resume = yield {
        id,
        title: `Uploaded ${uploaded} of ${uploadable.length} file(s)`,
        status: "pending",
        fallback: {
          id,
          title: "Upload the remaining files",
          description: `These files didn't upload automatically:\n${failures.map((f) => `• ${f}`).join("\n")}\n\nDownload them below, then upload them in the project's "Context" section.`,
          copyBlocks: [],
          downloads: failed.map((f) => ({
            label: f.originalName,
            fileName: f.originalName,
            mimeType: f.mimeType,
            contentRef: f.contentRef,
          })),
          link: projectUrl(projectUuid),
        },
        confirmLabel: "I've uploaded them",
        skipLabel: "Skip",
      };
      yield {
        id,
        title:
          done === false
            ? `Uploaded ${uploaded} of ${uploadable.length} file(s)`
            : `Uploaded all ${uploadable.length} file(s)`,
        status: done === false ? "skipped" : "success",
        filesDelivered: done === false ? uploaded : uploadable.length,
      };
    }
  }

  // ── 6. Verify ────────────────────────────────────────
  const verifyId = `${workspace.id}-verify`;
  yield { id: verifyId, title: "Checking the project", status: "running" };
  try {
    const result = await safeSendTabMessage(tabId, "CLAUDE_VERIFY_PROJECT", {
      projectUuid,
    });
    if (result.success) {
      const issues: string[] = [];
      if ((result.name ?? "").trim() !== name.trim()) {
        issues.push(`name is "${result.name ?? ""}"`);
      }
      if (instructions.trim() && !result.hasInstructions) {
        issues.push("instructions are missing");
      } else if (
        instructions.trim() &&
        (result.instructionsLength ?? 0) <
          Math.floor(instructions.trim().length * 0.95)
      ) {
        issues.push("instructions look shorter than expected");
      }

      if (issues.length === 0) {
        yield { id: verifyId, title: "Project checked", status: "success", verified: true };
      } else {
        yield {
          id: verifyId,
          title: `Check the project: ${issues.join(", ")}`,
          status: "fallback",
          verified: false,
        };
      }
    } else {
      yield { id: verifyId, title: "Couldn't check the project", status: "skipped" };
    }
  } catch {
    yield { id: verifyId, title: "Couldn't check the project", status: "skipped" };
  }

  // ── 7. Show the new project ──────────────────────────
  const openId = `${workspace.id}-open-project`;
  try {
    await navigateAndWaitForLoad(tabId, projectUrl(projectUuid));
    await delay(500);
    yield { id: openId, title: "Opened your new project", status: "success" };
  } catch {
    yield { id: openId, title: "Open your new project from Claude", status: "skipped" };
  }

  // ── 8. Files that need the user ──────────────────────
  if (byHand.length > 0) {
    const id = `${workspace.id}-files`;
    const saved = byHand.filter((f) => f.contentRef);
    const notSaved = byHand.filter((f) => !f.contentRef);
    const lines: string[] = [];
    if (saved.length > 0) {
      lines.push(
        "Download these below, fix them as noted, then upload them in the project's files section:",
        ...saved.map((f) => `• ${f.originalName} (${handNote(f)})`),
      );
    }
    if (notSaved.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(
        `PortSmith couldn't copy these from ${sourceLabel}. Download them there, then upload them here:`,
        ...notSaved.map((f) => `• ${f.originalName}${f.conversionNeeded ? ` (${f.conversionNeeded})` : ""}`),
      );
    }
    const done: Resume = yield {
      id,
      title: `${byHand.length} file(s) need to be uploaded by hand`,
      status: "pending",
      fallback: {
        id,
        title: "Upload the remaining files",
        description: lines.join("\n"),
        copyBlocks: [],
        ...(notSaved.length > 0
          ? { fileNames: notSaved.map((f) => f.originalName) }
          : {}),
        ...(saved.length > 0
          ? {
              downloads: saved.map((f) => ({
                label: f.originalName,
                fileName: f.originalName,
                mimeType: f.mimeType,
                contentRef: f.contentRef,
              })),
            }
          : {}),
        link: projectUrl(projectUuid),
      },
      confirmLabel: "Done",
      skipLabel: "I'll do this later",
    };
    yield {
      id,
      title: done === false ? "Remaining files left for later" : "Remaining files uploaded",
      status: done === false ? "skipped" : "success",
      ...(done === false ? {} : { filesDelivered: byHand.length }),
    };
  }
}
