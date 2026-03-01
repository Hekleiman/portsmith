import type { PortsmithManifest } from "@/core/schema/types";
import type { DOMExtractionResult } from "@/core/adapters/chatgpt-dom-types";

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
  | "skipped";

/** Legacy placeholder — kept for backward compatibility */
export interface AutofillStep {
  action: string;
  selector: string;
  value: string;
}

export type DOMExtractionTarget =
  | "custom_gpts"
  | "memory"
  | "custom_instructions";

// ─── Orchestrator Types ─────────────────────────────────────

export interface MigrationStepFallback {
  id: string;
  title: string;
  description: string;
  copyBlocks: Array<{ label: string; content: string }>;
  fileNames?: string[];
  link?: string;
}

export interface MigrationStep {
  id: string;
  title: string;
  status: AutofillStepStatus;
  fallback?: MigrationStepFallback;
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
  OPEN_SIDE_PANEL: {
    request: void;
    response: void;
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
  VERIFY_PROJECTS: {
    request: { projectNames: string[] };
    response: { found: string[]; notFound: string[] };
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
          msg.includes("Could not establish connection")
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
