import type { PortsmithManifest } from "@/core/schema/types";
import type {
  DOMExtractionResult,
  ProjectExtractionResult,
} from "@/core/adapters/chatgpt-dom-types";
import type {
  ClaudeExtractionOptions,
  ClaudeExtractionResult,
} from "@/core/adapters/claude-dom-types";
import type { GemExtractionResult } from "@/core/adapters/gemini-dom-types";
import type { GemConfig, GemImportResult } from "@/core/adapters/gemini-import-types";

// ─── Placeholder Types (move to dedicated modules when implemented) ──

export interface MigrationState {
  status:
    | "idle"
    | "extracting"
    | "reviewing"
    | "migrating"
    | "complete"
    | "error";
  sourcePlatform: string | null;
  targetPlatform: string | null;
  progress: number;
  error: string | null;
}

export type AutofillAction = "click" | "fill" | "clear_and_fill" | "dismiss_popover";

export interface AutofillExecuteRequest {
  action: AutofillAction;
  target: string; // key in Claude SELECTOR_MAP, e.g. "form.nameInput"
  value?: string; // text to fill for fill actions
}

export interface AutofillExecuteResponse {
  success: boolean;
  error?: string;
}

export type AutofillStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "fallback"
  | "skipped"
  | "clipboard"
  | "navigate_failed";

/** Legacy placeholder — kept for backward compatibility */
export interface AutofillStep {
  action: string;
  selector: string;
  value: string;
}

export type DOMExtractionTarget =
  | "custom_gpts"
  | "projects"
  | "memory"
  | "custom_instructions";

// ─── Gizmo API Types ──────────────────────────────────────────

export interface GizmoAPIResponse {
  gizmo?: {
    id: string;
    instructions: string;
    display: {
      name: string;
      description: string;
      prompt_starters: string[];
    };
    memory_enabled: boolean;
  };
  files?: Array<{ id?: string; name: string; type: string; size: number }>;
  error?: string;
}

// ─── Sidebar Scan Types ─────────────────────────────────────

export interface SidebarItem {
  id: string;
  name: string;
  url: string;
}

export interface SidebarScanResult {
  projects: SidebarItem[];
  gpts: SidebarItem[];
}

// ─── DOM Inspection Types ───────────────────────────────────

export interface DOMInspectionReport {
  url: string;
  page: string;
  loggedIn: boolean;
  sidebarProjectCount: number;
  sidebarGPTCount: number;
  timestamp: number;
}

// ─── Orchestrator Types ─────────────────────────────────────

/** A file the user can download from a guided step and upload by hand. */
export interface StepDownload {
  label: string;
  fileName: string;
  mimeType: string;
  /** Inline text content (e.g. rendered project memory) */
  content?: string;
  /** IndexedDB file reference (e.g. a knowledge file copied from the source) */
  contentRef?: string;
}

export interface MigrationStepFallback {
  id: string;
  title: string;
  description: string;
  copyBlocks: Array<{ label: string; content: string }>;
  fileNames?: string[];
  downloads?: StepDownload[];
  link?: string;
  actionHint?: string;
  stepNumber?: number;
  /** Leaving it unticked doesn't count as unfinished work */
  optional?: boolean;
}

export type InstructionsDelivery =
  | "autofilled"
  | "clipboard"
  | "manual"
  | "none"
  | "pending";

export interface MigrationStep {
  id: string;
  title: string;
  status: AutofillStepStatus;
  fallback?: MigrationStepFallback;
  /** Set on instructions-related steps to track delivery method */
  instructionsDelivery?: InstructionsDelivery;
  /** Set on verify steps to indicate API verification passed */
  verified?: boolean;
  /** True once the project/Gem exists on the target */
  projectCreated?: boolean;
  /** Button labels for "pending" steps */
  confirmLabel?: string;
  skipLabel?: string;
  /** Knowledge files that reached the target in this step */
  filesDelivered?: number;
  /** True once the project memory document is on the target */
  projectMemoryAdded?: boolean;
  /** Something the user still has to check, whatever the step's status */
  followUp?: string;
}

export interface MigrationGuidedInstructions {
  workspaceId: string;
  workspaceName: string;
  steps: MigrationStepFallback[];
  totalSteps?: number;
}

/** Knowledge that didn't reach a Gem during an automatic run. */
export interface KnowledgeLeftover {
  /** Where to add it (the Gem editor when the Gem is known) */
  link: string;
  /** Copied files that still need adding, by name */
  fileNames: string[];
  /** Whether the project memory document still needs adding */
  projectMemory: boolean;
}

export interface OrchestratorStatus {
  phase: "idle" | "running" | "paused" | "memory" | "complete";
  mode: "autofill" | "guided" | "hybrid" | null;
  /** Target platform of the current run */
  targetPlatform: string | null;
  /** Manifest the current run was started from (null when idle) */
  manifestId: string | null;
  totalWorkspaces: number;
  currentWorkspaceIndex: number;
  currentWorkspaceName: string | null;
  completedWorkspaceIds: string[];
  failedWorkspaces: Array<{ id: string; name: string; error: string }>;
  /** Workspaces the extension could not finish; the user has manual steps */
  manualWorkspaces: Array<{ id: string; name: string; reason: string }>;
  currentSteps: MigrationStep[];
  pendingConfirmStepId: string | null;
  /** Changes with every question, even when the step ID stays the same */
  pendingConfirmToken: string | null;
  guidedInstructions: MigrationGuidedInstructions | null;
  memorySteps: MigrationStepFallback[];
  hasMemory: boolean;
  /** Per-workspace tracking of how instructions were delivered */
  instructionsDelivery: Record<string, InstructionsDelivery>;
  /** Instructions text for the current workspace (for clipboard UI) */
  currentWorkspaceInstructions: string | null;
  /** Per-workspace instructions text for workspaces that fell back to clipboard */
  clipboardInstructions: Record<string, string>;
  /** Workspace IDs that passed API verification during autofill */
  verifiedWorkspaceIds: string[];
  /** Workspaces that exist on the target (even if a later step stopped) */
  createdWorkspaceIds: string[];
  /** Per-workspace things that still need the user after the run */
  followUps: Record<string, string[]>;
  /** Knowledge files that reached the target, per workspace */
  filesDelivered: Record<string, number>;
  /** Workspaces whose project memory reached the target */
  projectMemoryWorkspaceIds: string[];
  /** Knowledge to add by hand after the run, per workspace */
  knowledgeLeftovers: Record<string, KnowledgeLeftover>;
  /** Memories PortSmith saved to the target by itself (null: it didn't try) */
  memoryAutoSaved: { saved: number; total: number } | null;
  /** Whether the user finished the memory steps (null: there were none yet) */
  memoryImported: boolean | null;
  /** Warning when multiple Claude tabs are detected */
  duplicateTabWarning?: string;
}

// ─── Message Map ─────────────────────────────────────────────

export interface MessageMap {
  EXTRACT_START: {
    request: { platform: string };
    response: { success: boolean };
  };
  EXTRACT_PROGRESS: {
    request: { step: string; percent: number };
    response: void;
  };
  EXTRACT_COMPLETE: {
    request: { manifest: PortsmithManifest };
    response: void;
  };
  AUTOFILL_STEP: {
    request: { step: AutofillStep };
    response: { success: boolean };
  };
  AUTOFILL_EXECUTE: {
    request: AutofillExecuteRequest;
    response: AutofillExecuteResponse;
  };
  GET_MIGRATION_STATE: {
    request: void;
    response: MigrationState;
  };
  PAGE_STATE: {
    request: { url: string; platform: string };
    response: void;
  };
  DOM_INSPECT: {
    request: void;
    response: DOMInspectionReport;
  };
  SCAN_SIDEBAR: {
    request: void;
    response: SidebarScanResult;
  };
  EXTRACT_PROJECT_PAGE: {
    request: void;
    response: ProjectExtractionResult;
  };
  DOM_EXTRACT: {
    request: { target: DOMExtractionTarget };
    response: { success: boolean };
  };
  DOM_EXTRACT_RESULT: {
    request: DOMExtractionResult;
    response: void;
  };
  MIGRATION_START: {
    request: {
      manifestId: string;
      mode: "autofill" | "guided" | "hybrid";
      workspaceIds: string[];
      targetPlatform?: string;
    };
    response: { success: boolean };
  };
  MIGRATION_STATUS: {
    request: void;
    response: OrchestratorStatus;
  };
  MIGRATION_PAUSE: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_RESUME: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_CANCEL: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_CONFIRM: {
    /**
     * `token` is the `pendingConfirmToken` the user saw. A stale token (a
     * double click reaching the next question) is ignored.
     */
    request: { confirmed: boolean; token?: string };
    response: { success: boolean };
  };
  MIGRATION_WORKSPACE_DONE: {
    /** IDs of guided steps the user didn't tick off */
    request: { workspaceId: string; skippedStepIds?: string[] };
    response: { success: boolean };
  };
  MIGRATION_MEMORY_DONE: {
    /** False when the user skipped some memory steps */
    request: { allDone: boolean };
    response: { success: boolean };
  };
  MIGRATION_UPDATE_DELIVERY: {
    request: { workspaceId: string; delivery: InstructionsDelivery };
    response: { success: boolean };
  };
  VERIFY_PROJECTS: {
    request: { projectNames: string[] };
    response: { found: string[]; notFound: string[]; error?: string };
  };
  /** Look up project names in the user's Claude account (no navigation) */
  CLAUDE_FIND_PROJECTS: {
    request: { names: string[] };
    response: {
      found: string[];
      notFound: string[];
      /** Every project whose name matched, newest first */
      matches?: Array<{ name: string; uuid: string; createdAt: string }>;
      error?: string;
    };
  };
  /** Ask content script to watch for SPA navigation to a matching URL */
  WAIT_FOR_NAVIGATION: {
    request: { urlPattern: string; timeoutMs: number };
    response: { success: boolean; currentUrl: string; error?: string };
  };
  /** Copy text to clipboard from the content script context */
  CLIPBOARD_WRITE: {
    request: { text: string };
    response: { success: boolean; error?: string };
  };
  /** Get the current page URL from the content script */
  GET_PAGE_URL: {
    request: void;
    response: { url: string };
  };
  /** Compound action: scroll to Instructions section, click "+", fill editor, save */
  FILL_PROJECT_INSTRUCTIONS: {
    request: { instructions: string };
    response: { success: boolean; saved?: boolean; error?: string };
  };
  CLICK_IN_MAIN_WORLD: {
    request: { selector: string; text?: string };
    response: boolean;
  };
  FETCH_GIZMO_API: {
    request: { gizmoId: string };
    response: GizmoAPIResponse;
  };
  /** Lightweight ping to verify content script is alive */
  PING: {
    request: void;
    response: { pong: true };
  };
  /** Create a Claude project via internal API */
  CLAUDE_CREATE_PROJECT: {
    request: { name: string; description: string };
    response: { success: boolean; uuid?: string; error?: string };
  };
  /** Set instructions on a Claude project via internal API */
  CLAUDE_SET_INSTRUCTIONS: {
    request: { projectUuid: string; instructions: string };
    response: { success: boolean; error?: string };
  };
  /** Verify a Claude project exists and has correct data */
  CLAUDE_VERIFY_PROJECT: {
    request: { projectUuid: string };
    response: {
      success: boolean;
      name?: string;
      hasInstructions?: boolean;
      instructionsLength?: number;
      filesCount?: number;
      error?: string;
    };
  };
  /** Upload a file to a Claude project (base64-encoded blob) */
  CLAUDE_UPLOAD_FILE: {
    request: { projectUuid: string; fileName: string; fileBlob: string; mimeType: string };
    response: { success: boolean; fileUuid?: string; error?: string };
  };
  /** Extract Projects from the user's Claude account via internal API */
  CLAUDE_EXTRACT_PROJECTS: {
    request: ClaudeExtractionOptions;
    response: ClaudeExtractionResult;
  };
  /** Add a text document to a Claude project's knowledge */
  CLAUDE_CREATE_DOC: {
    request: { projectUuid: string; fileName: string; content: string };
    response: { success: boolean; uuid?: string; error?: string };
  };
  /** Extract Gems from the user's Gemini account via batchexecute API */
  GEMINI_EXTRACT_GEMS: {
    request: void;
    response: GemExtractionResult;
  };
  /** Create a new Gem in the user's Gemini account */
  GEMINI_CREATE_GEM: {
    request: GemConfig;
    response: GemImportResult;
  };
  /**
   * Replace a Gem's fields and knowledge files. `knowledgeHandles` is the
   * complete list the Gem should have afterwards (empty removes them all).
   */
  GEMINI_UPDATE_GEM: {
    request: GemConfig & { gemId: string; knowledgeHandles: string[] };
    response: GemImportResult;
  };
  /** Upload a file for a Gem's knowledge (base64) and return its handle */
  GEMINI_UPLOAD_KNOWLEDGE_FILE: {
    request: { fileName: string; mimeType: string; base64: string };
    response: { success: boolean; handle?: string; error?: string };
  };
  /** Add entries to "Your instructions for Gemini" (one per text) */
  GEMINI_SAVE_MEMORIES: {
    request: { texts: string[] };
    response: {
      results: Array<{ text: string; success: boolean; id?: string; error?: string }>;
    };
  };
  /** Delete a Gem by ID */
  GEMINI_DELETE_GEM: {
    request: { gemId: string };
    response: GemImportResult;
  };
  /** Store a downloaded file blob in IndexedDB (sent from content script) */
  STORE_DOWNLOADED_FILE: {
    request: { fileId: string; blob: string; mimeType: string; fileName: string };
    response: { success: boolean; contentRef?: string; error?: string };
  };
  /** List files in a Claude project */
  CLAUDE_LIST_FILES: {
    request: { projectUuid: string };
    response: {
      success: boolean;
      files?: Array<{ uuid: string; name: string; kind: string; sizeBytes: number | null }>;
      error?: string;
    };
  };
}

export type MessageName = keyof MessageMap;

// ─── Wire Protocol (internal) ────────────────────────────────

interface MessageEnvelope {
  __portsmith: true;
  type: MessageName;
  payload: unknown;
}

type ResponseEnvelope =
  | { __portsmith: true; ok: true; data: unknown }
  | { __portsmith: true; ok: false; error: string };

function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__portsmith === true &&
    "type" in value &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}

function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__portsmith === true &&
    "ok" in value
  );
}

// ─── Constants ───────────────────────────────────────────────

export const MESSAGE_TIMEOUT_MS = 10_000;

/** Per-message timeout overrides for long-running operations. */
// Claude requests retry on HTTP 429 for up to ~30 seconds (see
// content-scripts/claude/api.ts). The sender must wait longer than that:
// giving up early while a retry is still on its way is how v0.4 betas
// created projects twice.
const MESSAGE_TIMEOUT_OVERRIDES: Partial<Record<MessageName, number>> = {
  STORE_DOWNLOADED_FILE: 30_000,
  CLAUDE_CREATE_PROJECT: 90_000,
  CLAUDE_SET_INSTRUCTIONS: 90_000,
  CLAUDE_VERIFY_PROJECT: 60_000,
  CLAUDE_UPLOAD_FILE: 180_000,
  CLAUDE_CREATE_DOC: 120_000,
  CLAUDE_FIND_PROJECTS: 120_000,
  VERIFY_PROJECTS: 130_000,
  // Extraction fans out to one request per project (plus memory and docs),
  // so it needs far more than the default budget on large accounts.
  CLAUDE_EXTRACT_PROJECTS: 180_000,
  GEMINI_EXTRACT_GEMS: 60_000,
  GEMINI_CREATE_GEM: 60_000,
  GEMINI_UPDATE_GEM: 60_000,
  GEMINI_UPLOAD_KNOWLEDGE_FILE: 180_000,
  // Up to 10 entries per message, each can take several seconds
  GEMINI_SAVE_MEMORIES: 180_000,
  FETCH_GIZMO_API: 30_000,
};

/** Resolve the timeout used for a given message. */
export function getMessageTimeout(name: MessageName): number {
  return MESSAGE_TIMEOUT_OVERRIDES[name] ?? MESSAGE_TIMEOUT_MS;
}

// ─── Errors ──────────────────────────────────────────────────

export class MessageError extends Error {
  public readonly messageName: string;

  constructor(messageName: string, message: string) {
    super(`[${messageName}] ${message}`);
    this.name = "MessageError";
    this.messageName = messageName;
  }
}

export class MessageTimeoutError extends MessageError {
  constructor(messageName: string, timeoutMs: number = MESSAGE_TIMEOUT_MS) {
    super(messageName, `Timed out after ${timeoutMs}ms`);
    this.name = "MessageTimeoutError";
  }
}

export class NoListenerError extends MessageError {
  constructor(messageName: string) {
    super(
      messageName,
      "No listener available. Is the target context active?",
    );
    this.name = "NoListenerError";
  }
}

// ─── Content Script Injection ─────────────────────────────────

/**
 * Convert a Chrome match pattern (e.g. "https://chatgpt.com/*") to a RegExp.
 * Only handles literal schemes and hosts with a wildcard path — sufficient
 * for the patterns declared in our manifest.
 */
function matchesUrlPattern(url: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

/**
 * Programmatically inject the manifest-declared content script(s) that
 * match the given tab's URL. Used as a fallback when the extension was
 * installed/reloaded while the tab was already open.
 */
async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const tab = await chrome.tabs.get(tabId);
  const tabUrl = tab.url ?? "";
  const contentScripts = manifest.content_scripts ?? [];
  const filesToInject: string[] = [];

  for (const cs of contentScripts) {
    const matches = cs.matches ?? [];
    const isMatch = matches.some((p) => matchesUrlPattern(tabUrl, p));
    if (isMatch && cs.js) {
      filesToInject.push(...cs.js);
    }
  }

  if (filesToInject.length === 0) {
    throw new MessageError(
      "INJECT",
      `No content scripts match URL: ${tabUrl}`,
    );
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: filesToInject,
  });
}

// ─── Send ────────────────────────────────────────────────────

export function sendMessage<K extends MessageName>(
  name: K,
  ...[data]: MessageMap[K]["request"] extends void
    ? []
    : [MessageMap[K]["request"]]
): Promise<MessageMap[K]["response"]> {
  return new Promise<MessageMap[K]["response"]>((resolve, reject) => {
    const timeoutMs = getMessageTimeout(name);
    const timer = setTimeout(() => {
      reject(new MessageTimeoutError(String(name), timeoutMs));
    }, timeoutMs);

    const envelope: MessageEnvelope = {
      __portsmith: true,
      type: name,
      payload: data,
    };

    chrome.runtime.sendMessage(envelope, (raw: unknown) => {
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? "Unknown error";
        if (msg.includes("Receiving end does not exist")) {
          reject(new NoListenerError(String(name)));
        } else {
          reject(new MessageError(String(name), msg));
        }
        return;
      }

      if (!isResponseEnvelope(raw)) {
        resolve(undefined as MessageMap[K]["response"]);
        return;
      }

      if (raw.ok) {
        resolve(raw.data as MessageMap[K]["response"]);
      } else {
        reject(new MessageError(String(name), raw.error));
      }
    });
  });
}

export function sendTabMessage<K extends MessageName>(
  tabId: number,
  name: K,
  ...[data]: MessageMap[K]["request"] extends void
    ? []
    : [MessageMap[K]["request"]]
): Promise<MessageMap[K]["response"]> {
  return new Promise<MessageMap[K]["response"]>((resolve, reject) => {
    const timeoutMs = getMessageTimeout(name);
    const timer = setTimeout(() => {
      reject(new MessageTimeoutError(String(name), timeoutMs));
    }, timeoutMs);

    const envelope: MessageEnvelope = {
      __portsmith: true,
      type: name,
      payload: data,
    };

    chrome.tabs.sendMessage(tabId, envelope, (raw: unknown) => {
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? "Unknown error";
        if (
          msg.includes("Receiving end does not exist") ||
          msg.includes("Could not establish connection") ||
          msg.includes("back/forward cache")
        ) {
          reject(new NoListenerError(String(name)));
        } else {
          reject(new MessageError(String(name), msg));
        }
        return;
      }

      if (!isResponseEnvelope(raw)) {
        resolve(undefined as MessageMap[K]["response"]);
        return;
      }

      if (raw.ok) {
        resolve(raw.data as MessageMap[K]["response"]);
      } else {
        reject(new MessageError(String(name), raw.error));
      }
    });
  });
}

// ─── Safe Send (with injection fallback) ─────────────────────

/**
 * Wrapper around `sendTabMessage` that automatically injects the content
 * script when the receiving end doesn't exist (i.e. extension was
 * installed/reloaded while the target tab was already open).
 *
 * 1. Tries `sendTabMessage`
 * 2. On `NoListenerError`: programmatically injects content script,
 *    waits 500ms for initialisation, then retries once
 * 3. On second failure: throws the error
 */
export function safeSendTabMessage<K extends MessageName>(
  tabId: number,
  name: K,
  ...[data]: MessageMap[K]["request"] extends void
    ? []
    : [MessageMap[K]["request"]]
): Promise<MessageMap[K]["response"]> {
  const args = (data === undefined ? [] : [data]) as MessageMap[K]["request"] extends void
    ? []
    : [MessageMap[K]["request"]];

  return sendTabMessage(tabId, name, ...args).catch(
    async (err: unknown): Promise<MessageMap[K]["response"]> => {
      if (!(err instanceof NoListenerError)) {
        throw err;
      }

      // After an extension reload or a bfcache eviction the old content
      // script is gone, so inject a fresh copy and retry once.
      console.log(
        `[PortSmith] Content script not found in tab ${tabId}, injecting programmatically...`,
      );
      await injectContentScript(tabId);
      await new Promise<void>((r) => setTimeout(r, 500));

      return sendTabMessage(tabId, name, ...args);
    },
  );
}

// ─── Receive ─────────────────────────────────────────────────

type MessageHandler<K extends MessageName> = (
  payload: MessageMap[K]["request"],
  sender: chrome.runtime.MessageSender,
) => MessageMap[K]["response"] | Promise<MessageMap[K]["response"]>;

type InternalHandler = (
  payload: unknown,
  sender: chrome.runtime.MessageSender,
) => unknown | Promise<unknown>;

const handlers = new Map<MessageName, InternalHandler>();

export function onMessage<K extends MessageName>(
  name: K,
  handler: MessageHandler<K>,
): () => void {
  const internal = handler as InternalHandler;
  handlers.set(name, internal);
  return () => {
    // Only remove the handler this call registered. A stale unsubscribe
    // (e.g. a timeout firing after a newer handler took over the same
    // message name) must not delete someone else's handler.
    if (handlers.get(name) === internal) {
      handlers.delete(name);
    }
  };
}

/** @internal — for testing only */
export function _resetHandlers(): void {
  handlers.clear();
  routerListener = null;
}

// ─── Router ──────────────────────────────────────────────────

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

let routerListener: RuntimeListener | null = null;

/**
 * Install the single `chrome.runtime.onMessage` listener for this JS realm.
 *
 * Idempotent: content scripts that share an isolated world (e.g. the Claude
 * extractor and importer, or the Gemini extractor and importer) also share
 * this module instance and its handler map. Registering a second listener
 * would dispatch every message to the same handler twice, which created
 * duplicate projects and Gems in v0.3.0.
 */
export function initMessageRouter(): void {
  if (routerListener) {
    const stillAttached =
      typeof chrome.runtime.onMessage.hasListener === "function"
        ? chrome.runtime.onMessage.hasListener(routerListener)
        : true;
    if (stillAttached) return;
  }

  const listener: RuntimeListener = (message, sender, sendResponse) => {
    if (!isMessageEnvelope(message)) return false;

    const handler = handlers.get(message.type);
    if (!handler) return false;

    Promise.resolve()
      .then(() => handler(message.payload, sender))
      .then((data) => {
        sendResponse({ __portsmith: true, ok: true, data });
      })
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        sendResponse({ __portsmith: true, ok: false, error: errorMessage });
      });

    // Keep message channel open for async sendResponse
    return true;
  };

  routerListener = listener;
  chrome.runtime.onMessage.addListener(listener);
}
