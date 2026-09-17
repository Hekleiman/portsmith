// ─── Gemini saved info ("Your instructions for Gemini") ─────
// Recorded on gemini.google.com/saved-info (Sep 2026). The "Add" button
// sends one xVRQX call per entry:
//
//   request  [[null, "i prefer short concise responses"]]
//   reply    [null, null, null, [[[id, "I prefer short concise responses.", [secs, nanos], …]]]]
//
// Gemini tidies the text before saving it, so the saved wording can
// differ slightly from what was sent.

import {
  extractResponseBody,
  getFrameIdentifier,
  type RPCPayload,
} from "./batchexecute";

export const RPC_CREATE_SAVED_INFO = "xVRQX";
/** BardFrontendService.ListMemories: request [pageSize, pageToken?] */
export const RPC_LIST_SAVED_INFO = "ZKcapf";
/** The page asks for 100 per page. */
export const SAVED_INFO_PAGE_SIZE = 100;
/** The saved-info editor's maxlength. */
export const SAVED_INFO_MAX_LENGTH = 10_000;

export interface SavedInfoEntry {
  id: string;
  text: string;
}

export function buildCreateSavedInfoPayload(text: string): string {
  return JSON.stringify([[null, text]]);
}

export function createSavedInfoRequest(text: string, identifier = "generic"): RPCPayload {
  return {
    rpcid: RPC_CREATE_SAVED_INFO,
    payload: buildCreateSavedInfoPayload(text),
    identifier,
  };
}

export function listSavedInfoRequest(pageToken?: string): RPCPayload {
  return {
    rpcid: RPC_LIST_SAVED_INFO,
    payload: JSON.stringify(
      pageToken ? [SAVED_INFO_PAGE_SIZE, pageToken] : [SAVED_INFO_PAGE_SIZE],
    ),
  };
}

/** One page of a ZKcapf reply: `[[entry, …], nextPageToken?]`. */
export function parseListSavedInfoResponse(
  frames: unknown[],
): { entries: SavedInfoEntry[]; nextPageToken: string | null } | null {
  for (const frame of frames) {
    if (!Array.isArray(frame) || frame[0] !== "wrb.fr" || frame[1] !== RPC_LIST_SAVED_INFO) {
      continue;
    }
    const body = extractResponseBody(frame);
    if (!Array.isArray(body)) return null;
    const rows = Array.isArray(body[0]) ? (body[0] as unknown[]) : [];
    const entries = rows
      .map((row) => (Array.isArray(row) ? row : []))
      .filter((row) => typeof row[0] === "string" && typeof row[1] === "string")
      .map((row) => ({ id: row[0] as string, text: row[1] as string }));
    const token: unknown = body[1];
    return { entries, nextPageToken: typeof token === "string" && token ? token : null };
  }
  return null;
}

/** The entry Gemini saved, from the frames of an xVRQX reply. */
export function parseCreateSavedInfoResponse(
  frames: unknown[],
  identifier = "generic",
): SavedInfoEntry | null {
  for (const frame of frames) {
    if (!Array.isArray(frame) || frame[0] !== "wrb.fr" || frame[1] !== RPC_CREATE_SAVED_INFO) {
      continue;
    }
    if (getFrameIdentifier(frame) !== identifier) continue;
    const body = extractResponseBody(frame);
    const entry = Array.isArray(body) ? firstEntry(body[3]) : null;
    if (entry) return entry;
  }
  return null;
}

function firstEntry(value: unknown): SavedInfoEntry | null {
  // [[[id, text, …]]]
  const list = Array.isArray(value) ? value[0] : null;
  const row: unknown = Array.isArray(list) ? list[0] : null;
  if (!Array.isArray(row)) return null;
  const [id, text] = row as unknown[];
  return typeof id === "string" && id && typeof text === "string"
    ? { id, text }
    : null;
}

/** Loose comparison, since Gemini adjusts case and punctuation. */
export function savedInfoKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
