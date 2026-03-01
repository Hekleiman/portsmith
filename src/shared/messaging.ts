import type { PortsmithManifest } from "@/core/schema/types";
import type {
  DOMExtractionResult,
  ProjectExtractionResult,
} from "@/core/adapters/chatgpt-dom-types";

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

export type AutofillAction = "click" | "fill" | "clear_and_fill";

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
  files?: Array<{ name: string; type: string; size: number }>;
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

export interface MigrationStepFallback {
  id: string;
  title: string;
  description: string;
  copyBlocks: Array<{ label: string; content: string }>;
  fileNames?: string[];
  link?: string;
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
}

export interface MigrationGuidedInstructions {
  workspaceId: string;
  workspaceName: string;
  steps: MigrationStepFallback[];
}

export interface OrchestratorStatus {
  phase: "idle" | "running" | "paused" | "memory" | "complete";
  mode: "autofill" | "guided" | "hybrid" | null;
  totalWorkspaces: number;
  currentWorkspaceIndex: number;
  currentWorkspaceName: string | null;
  completedWorkspaceIds: string[];
  failedWorkspaces: Array<{ id: string; name: string; error: string }>;
  currentSteps: MigrationStep[];
  pendingConfirmStepId: string | null;
  guidedInstructions: MigrationGuidedInstructions | null;
  memorySteps: MigrationStepFallback[];
  hasMemory: boolean;
  /** Per-workspace tracking of how instructions were delivered */
  instructionsDelivery: Record<string, InstructionsDelivery>;
  /** Instructions text for the current workspace (for clipboard UI) */
  currentWorkspaceInstructions: string | null;
  /** Per-workspace instructions text for workspaces that fell back to clipboard */
  clipboardInstructions: Record<string, string>;
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
    request: { confirmed: boolean };
    response: { success: boolean };
  };
  MIGRATION_WORKSPACE_DONE: {
    request: { workspaceId: string };
    response: { success: boolean };
  };
  MIGRATION_MEMORY_DONE: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_UPDATE_DELIVERY: {
    request: { workspaceId: string; delivery: InstructionsDelivery };
    response: { success: boolean };
  };
  VERIFY_PROJECTS: {
    request: { projectNames: string[] };
    response: { found: string[]; notFound: string[] };
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
    request: { selector: string };
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
  constructor(messageName: string) {
    super(messageName, `Timed out after ${MESSAGE_TIMEOUT_MS}ms`);
    this.name = "MessageTimeoutError";
  }
}

export class NoListenerError extends MessageError {
  constructor(messageName: string) {
    super(
      messageName,
      "No listener available — is the target context active?",
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

/** Tracks tabs where we already attempted programmatic injection. */
const injectedTabs = new Set<number>();

// ─── Send ────────────────────────────────────────────────────

export function sendMessage<K extends MessageName>(
  name: K,
  ...[data]: MessageMap[K]["request"] extends void
    ? []
    : [MessageMap[K]["request"]]
): Promise<MessageMap[K]["response"]> {
  return new Promise<MessageMap[K]["response"]>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MessageTimeoutError(String(name)));
    }, MESSAGE_TIMEOUT_MS);

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
    const timer = setTimeout(() => {
      reject(new MessageTimeoutError(String(name)));
    }, MESSAGE_TIMEOUT_MS);

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

      // After a navigation (e.g. bfcache eviction), the old content script
      // is gone. Clear the injection guard so we can re-inject.
      injectedTabs.delete(tabId);

      console.log(
        `[PortSmith] Content script not found in tab ${tabId}, injecting programmatically...`,
      );
      injectedTabs.add(tabId);
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
  handlers.set(name, handler as InternalHandler);
  return () => {
    handlers.delete(name);
  };
}

/** @internal — for testing only */
export function _resetHandlers(): void {
  handlers.clear();
}

// ─── Router ──────────────────────────────────────────────────

export function initMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  });
}
