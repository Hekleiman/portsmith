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
