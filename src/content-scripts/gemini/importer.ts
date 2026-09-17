// ─── Gemini Gem Importer ─────────────────────────────────────
// Content script that runs on gemini.google.com.
// Creates, updates, and deletes Gems via the batchexecute API.
//
// Reuses the batchexecute transport from ./batchexecute.ts and
// session management from ./session.ts.

import { onMessage, initMessageRouter } from "@/shared/messaging";
import type {
  GemConfig,
  GemImportResult,
  GemImportFallback,
} from "@/core/adapters/gemini-import-types";
import {
  batchExecute,
  extractResponseBody,
  type GeminiSession,
  type RPCPayload,
} from "./batchexecute";
import { getSession, refreshSession } from "./session";
import {
  GEMINI_FILE_LIMIT_BYTES,
  buildKnowledgeField,
  processFile,
  uploadFileBytes,
} from "./knowledge";
import { base64ToBytes } from "@/shared/encoding";
import {
  createSavedInfoRequest,
  listSavedInfoRequest,
  parseCreateSavedInfoRefusal,
  parseCreateSavedInfoResponse,
  parseListSavedInfoResponse,
  SAVED_INFO_API_MAX_LENGTH,
  type SavedInfoEntry,
} from "./saved-info";

// ─── RPC Constants ──────────────────────────────────────────

const RPC_CREATE_GEM = "oMH3Zd";
const RPC_UPDATE_GEM = "kHv0Vd";
const RPC_DELETE_GEM = "UXcSJb";

// ─── Payload Builders ───────────────────────────────────────

/**
 * Build the create-gem payload.
 *
 * Format: `[[name, desc, prompt, null×5, 0, null, 1, null×3, []]]`
 * (15-element inner array wrapped in an outer array)
 */
function buildCreatePayload(config: GemConfig): string {
  return JSON.stringify([
    [
      config.name,
      config.description,
      config.instructions,
      null,
      null,
      null,
      null,
      null,
      0,
      null,
      1,
      null,
      null,
      null,
      [],
    ],
  ]);
}

/**
 * Build the update-gem payload, as the Gem editor sends it (Sep 2026):
 * `[gem_id, [name, desc, prompt, null×5, 0, null, 1, null×3, knowledge, null, null, 0]]`
 *
 * `knowledge` replaces the Gem's knowledge files, so pass every handle the
 * Gem should keep. An empty list removes them all.
 */
export function buildUpdatePayload(
  gemId: string,
  config: GemConfig,
  knowledgeHandles: string[],
): string {
  return JSON.stringify([
    gemId,
    [
      config.name,
      config.description,
      config.instructions,
      null,
      null,
      null,
      null,
      null,
      0,
      null,
      1,
      null,
      null,
      null,
      buildKnowledgeField(knowledgeHandles),
      null,
      null,
      0,
    ],
  ]);
}

/**
 * Build the delete-gem payload.
 *
 * Format: `[gem_id]`
 */
function buildDeletePayload(gemId: string): string {
  return JSON.stringify([gemId]);
}

// ─── Guided Fallback ────────────────────────────────────────

function buildCreateFallback(config: GemConfig): GemImportFallback {
  return {
    steps: [
      "1. Go to https://gemini.google.com/gems/new",
      `2. Enter the name: "${config.name}"`,
      config.description
        ? `3. Enter the description: "${config.description}"`
        : "3. (Optional) Enter a description",
      "4. Paste the following instructions into the Instructions field",
      "5. Click Save",
      "6. Your new Gem will appear at https://gemini.google.com/gems",
    ],
    configData: config,
  };
}

function buildUpdateFallback(config: GemConfig): GemImportFallback {
  return {
    steps: [
      "1. Go to https://gemini.google.com/gems",
      `2. Find and click on the Gem named "${config.name}"`,
      "3. Click the Edit (pencil) icon",
      "4. Update the name, description, and instructions as needed",
      "5. Click Save",
    ],
    configData: config,
  };
}

function buildDeleteFallback(): GemImportFallback {
  return {
    steps: [
      "1. Go to https://gemini.google.com/gems",
      "2. Find the Gem you want to delete",
      "3. Click the three-dot menu on the Gem",
      "4. Select Delete",
      "5. Confirm the deletion",
    ],
    configData: { name: "", description: "", instructions: "" },
  };
}

// ─── Retry Helper ───────────────────────────────────────────

/**
 * Execute a batchexecute call with automatic session-refresh retry
 * on 400 / 401 errors (same pattern as the extractor).
 */
async function executeWithRetry(
  payloads: RPCPayload[],
): Promise<unknown[]> {
  return withSession((session) => batchExecute(session, payloads));
}

/** Run a request, refreshing the session once on HTTP 400 / 401. */
async function withSession<T>(
  request: (session: GeminiSession) => Promise<T>,
): Promise<T> {
  try {
    return await request(await getSession());
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("HTTP 401") ||
        err.message.includes("HTTP 400"))
    ) {
      return await request(await refreshSession());
    }
    throw err;
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Create a new custom Gem in the user's Gemini account.
 *
 * On success returns the newly created Gem's ID.
 * On failure returns an error message and guided fallback steps.
 */
export async function createGem(config: GemConfig): Promise<GemImportResult> {
  const payloads: RPCPayload[] = [
    {
      rpcid: RPC_CREATE_GEM,
      payload: buildCreatePayload(config),
    },
  ];

  let frames: unknown[];
  try {
    frames = await executeWithRetry(payloads);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create Gem";
    return {
      success: false,
      error: message,
      fallback: buildCreateFallback(config),
    };
  }

  // Parse the created Gem ID from the response.
  // Response body is at frames[0] → envelope[2] → parsed JSON → [0]
  for (const frame of frames) {
    const body = extractResponseBody(frame);
    if (!body || !Array.isArray(body)) continue;

    const gemId: unknown = body[0];
    if (typeof gemId === "string" && gemId) {
      return { success: true, gemId };
    }
  }

  return {
    success: false,
    error: "Gemini's reply didn't include a Gem ID, so the Gem may or may not exist",
    maybeCreated: true,
    fallback: buildCreateFallback(config),
  };
}

/**
 * Update an existing custom Gem.
 *
 * Gemini replaces the whole Gem: name, description, instructions and the
 * list of knowledge files. Pass every knowledge handle the Gem should keep.
 */
export async function updateGem(
  gemId: string,
  config: GemConfig,
  knowledgeHandles: string[],
): Promise<GemImportResult> {
  const payloads: RPCPayload[] = [
    {
      rpcid: RPC_UPDATE_GEM,
      payload: buildUpdatePayload(gemId, config, knowledgeHandles),
    },
  ];

  try {
    await executeWithRetry(payloads);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update Gem";
    return {
      success: false,
      error: message,
      fallback: buildUpdateFallback(config),
    };
  }

  // The Python client doesn't parse the update response — a 200 means
  // success. Return the same gemId back.
  return { success: true, gemId };
}

/**
 * Upload one file and return the handle to attach it to a Gem.
 */
export async function uploadKnowledgeFile(
  fileName: string,
  mimeType: string,
  base64: string,
): Promise<{ success: boolean; handle?: string; error?: string }> {
  try {
    const bytes = base64ToBytes(base64);
    if (bytes.length === 0) return { success: false, error: "the file is empty" };
    if (bytes.length > GEMINI_FILE_LIMIT_BYTES) {
      return { success: false, error: "the file is over Gemini's 100 MB limit" };
    }
    const type = mimeType || "application/octet-stream";
    const handle = await withSession(async (session) => {
      const ref = await uploadFileBytes(session, bytes, fileName, type);
      return processFile(session, ref, fileName, type);
    });
    return { success: true, handle };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "upload failed",
    };
  }
}

/** Short description of a reply, for a failure message. */
function describeFrames(frames: unknown[]): string {
  const parts: string[] = [];
  for (const frame of frames) {
    if (!Array.isArray(frame)) continue;
    const tag = frame[0];
    if (tag === "wrb.fr") {
      parts.push(`body ${JSON.stringify(frame[2] ?? null).slice(0, 200)}`);
    } else if (tag === "er") {
      parts.push(`error ${JSON.stringify(frame.slice(1, 4)).slice(0, 200)}`);
    }
  }
  return parts.join("; ") || "empty reply";
}

/** Everything in "Your instructions for Gemini", page by page. */
export async function listMemories(): Promise<
  { success: true; entries: SavedInfoEntry[] } | { success: false; error: string }
> {
  const entries: SavedInfoEntry[] = [];
  let token: string | undefined;
  try {
    for (let page = 0; page < 100; page++) {
      const frames = await executeWithRetry([listSavedInfoRequest(token)]);
      const result = parseListSavedInfoResponse(frames);
      if (!result) return { success: false, error: "Gemini's list reply had an unexpected shape" };
      entries.push(...result.entries);
      if (!result.nextPageToken) return { success: true, entries };
      token = result.nextPageToken;
    }
    return { success: false, error: "Too many pages" };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "request failed" };
  }
}

/** Waits between retries of a refused entry. */
const SAVE_RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * How many saves are in flight at once. Six produced transient refusals and
 * replies slowing from ~4 s to ~10 s against a live account, so this is
 * deliberately low: the call takes about four seconds whatever we do.
 */
const SAVE_CONCURRENCY = 2;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Save entries to "Your instructions for Gemini", a few at a time.
 * Each entry is its own request, like the page's "Add" button.
 *
 * Gemini refuses some entries it would accept a moment later, answering with
 * error code 13 and no body after about ten seconds instead of the usual four
 * (measured against a live account; see docs/gemini-saved-info-probe.md).
 * Those are retried, because a refusal means the server answered and saved
 * nothing. A request that threw is never retried: it may have been saved on
 * the way back, and a second try would add it twice.
 *
 * Text over `SAVED_INFO_API_MAX_LENGTH` is refused every time, so it is not
 * retried. Split it with `splitSavedInfoText` before calling this.
 */
export async function saveMemories(
  texts: string[],
  concurrency = SAVE_CONCURRENCY,
): Promise<Array<{ text: string; success: boolean; id?: string; error?: string }>> {
  const results: Array<{ text: string; success: boolean; id?: string; error?: string }> =
    texts.map((text) => ({ text, success: false }));
  let next = 0;

  const saveOne = async (index: number): Promise<void> => {
    const text = texts[index]!;
    const tooLong = text.length > SAVED_INFO_API_MAX_LENGTH;

    for (let attempt = 0; ; attempt++) {
      let frames: unknown[];
      try {
        frames = await executeWithRetry([createSavedInfoRequest(text)]);
      } catch (err) {
        results[index] = {
          text,
          success: false,
          error: err instanceof Error ? err.message : "request failed",
        };
        break;
      }

      const entry = parseCreateSavedInfoResponse(frames);
      if (entry) {
        results[index] = { text, success: true, id: entry.id };
        break;
      }

      const refusal = parseCreateSavedInfoRefusal(frames);
      results[index] = {
        text,
        success: false,
        error: tooLong
          ? `over Gemini's ${SAVED_INFO_API_MAX_LENGTH}-character limit for one entry (${text.length})`
          : `Gemini refused the entry${refusal && refusal.length > 0 ? ` (code ${refusal.join(",")})` : ""}: ${describeFrames(frames)}`,
      };

      const retryable = refusal !== null && !tooLong;
      const wait = SAVE_RETRY_DELAYS_MS[attempt];
      if (!retryable || wait === undefined) break;
      await delay(wait);
    }

    const failed = results[index];
    if (failed && !failed.success) {
      // Logged here so the reason is visible in the Gemini tab's console.
      console.warn(
        `[PortSmith] Gemini didn't save a memory (${failed.error ?? "no reason given"}): ${text.slice(0, 80)}`,
      );
    }
  };

  const worker = async (): Promise<void> => {
    while (next < texts.length) {
      const index = next++;
      await saveOne(index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, texts.length)) }, worker),
  );
  return results;
}

/**
 * Delete a custom Gem.
 */
export async function deleteGem(gemId: string): Promise<GemImportResult> {
  const payloads: RPCPayload[] = [
    {
      rpcid: RPC_DELETE_GEM,
      payload: buildDeletePayload(gemId),
    },
  ];

  try {
    await executeWithRetry(payloads);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete Gem";
    return {
      success: false,
      error: message,
      fallback: buildDeleteFallback(),
    };
  }

  return { success: true };
}

// ─── Message Handlers ───────────────────────────────────────

initMessageRouter();

onMessage("GEMINI_CREATE_GEM", async (req) => {
  return createGem(req);
});

onMessage("GEMINI_UPDATE_GEM", async (req) => {
  return updateGem(
    req.gemId,
    {
      name: req.name,
      description: req.description,
      instructions: req.instructions,
    },
    req.knowledgeHandles,
  );
});

onMessage("GEMINI_UPLOAD_KNOWLEDGE_FILE", async (req) => {
  return uploadKnowledgeFile(req.fileName, req.mimeType, req.base64);
});

onMessage("GEMINI_LIST_MEMORIES", async () => {
  const result = await listMemories();
  return result.success
    ? { success: true, texts: result.entries.map((e) => e.text) }
    : { success: false, error: result.error };
});

onMessage("GEMINI_SAVE_MEMORIES", async (req) => {
  return { results: await saveMemories(req.texts) };
});

onMessage("GEMINI_DELETE_GEM", async (req) => {
  return deleteGem(req.gemId);
});

console.log("[PortSmith] Gemini importer content script loaded");
