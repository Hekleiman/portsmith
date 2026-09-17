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
/** BardFrontendService.DeleteMemory: request [id] */
export const RPC_DELETE_SAVED_INFO = "Ok9j9b";
/** The page asks for 100 per page. */
export const SAVED_INFO_PAGE_SIZE = 100;
/** The saved-info editor's maxlength. */
export const SAVED_INFO_MAX_LENGTH = 10_000;
/**
 * What `xVRQX` actually accepts, which is not what the editor allows.
 * Measured against a live account (Sep 2026) by binary search: 1500
 * characters saves, 1501 comes back as error code 13 with no body, in about
 * 150 ms rather than the ~4 s a real save takes. See
 * docs/gemini-saved-info-probe.md.
 */
export const SAVED_INFO_API_MAX_LENGTH = 1_500;

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

/**
 * Gemini answered and turned the entry down: a `wrb.fr` frame for the create
 * call with no body, carrying an error code at index 5 (13 in every refusal
 * the probe saw). Distinct from a request that never got an answer, which is
 * why this is safe to retry: the server replied, so nothing was saved.
 *
 * Returns the error code, `[]` when the frame carries none, or `null` when
 * there is no create frame at all.
 */
export function parseCreateSavedInfoRefusal(
  frames: unknown[],
  identifier = "generic",
): number[] | null {
  for (const frame of frames) {
    if (!Array.isArray(frame) || frame[0] !== "wrb.fr" || frame[1] !== RPC_CREATE_SAVED_INFO) {
      continue;
    }
    if (getFrameIdentifier(frame) !== identifier) continue;
    if (typeof frame[2] === "string") return null; // it has a body: not a refusal
    const code: unknown = frame[5];
    return Array.isArray(code) ? code.filter((n): n is number => typeof n === "number") : [];
  }
  return null;
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Within both the character limit and, conservatively, the same byte limit. */
function fits(text: string, limit: number): boolean {
  return text.length <= limit && utf8Length(text) <= limit;
}

/** Break a run of text that has no separator left to split on. */
function hardSplit(text: string, limit: number): string[] {
  const parts: string[] = [];
  let current = "";
  // Iterate code points so a split never lands inside a surrogate pair.
  for (const char of text) {
    if (!fits(current + char, limit)) {
      if (current) parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Greedily pack pieces, splitting any single piece that is still too long. */
function pack(pieces: string[], limit: number, join: string, refine: (p: string) => string[]): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? current + join + piece : piece;
    if (fits(candidate, limit)) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (fits(piece, limit)) {
      current = piece;
    } else {
      const refined = refine(piece);
      out.push(...refined.slice(0, -1));
      current = refined[refined.length - 1] ?? "";
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Cut text into pieces `xVRQX` will accept, preferring line breaks, then
 * sentence ends, then word boundaries, and only cutting mid-word when a
 * single word is longer than the limit on its own.
 *
 * Returns `[]` for text that is blank once trimmed, and `[text]` when it
 * already fits, so the common case is untouched.
 */
export function splitSavedInfoText(
  text: string,
  limit: number = SAVED_INFO_API_MAX_LENGTH,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (fits(trimmed, limit)) return [trimmed];

  const byWord = (piece: string): string[] =>
    pack(piece.split(/\s+/).filter(Boolean), limit, " ", (word) => hardSplit(word, limit));
  const bySentence = (piece: string): string[] =>
    pack(piece.split(/(?<=[.!?])\s+/).filter(Boolean), limit, " ", byWord);

  return pack(trimmed.split(/\n+/).filter(Boolean), limit, "\n", bySentence)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Loose comparison, since Gemini adjusts case and punctuation. */
export function savedInfoKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * How alike two entries have to be to count as the same memory.
 *
 * Measured against 219 real entries (23,871 pairs). True rewrites and
 * different-but-related memories overlap badly: real rewrites score from 0.67
 * up, while distinct memories reach 0.83 ("A primary use case for my Claude
 * Code workflow is trade-up" against "Dartvision is a primary use case for my
 * Claude Code workflow"). No threshold separates them cleanly.
 *
 * So this is set where no false match was observed, not where recall is best.
 * A missed match re-sends a memory and adds a duplicate, which is visible and
 * reversible. A false match marks an unsaved memory as saved and loses it
 * silently. See docs/gemini-saved-info-probe.md for the pairs.
 */
export const SAVED_INFO_SIMILARITY_THRESHOLD = 0.9;

/** Words short enough to be grammar rather than content are dropped. */
const SIMILARITY_MIN_WORD_LENGTH = 4;
/**
 * Below this many content words, a partial overlap says too little, so the
 * sets have to match completely. Two content words sharing one of them is
 * noise, not a rewrite.
 */
const SIMILARITY_MIN_TOKENS = 3;

/**
 * Content words of an entry, for comparing wording Gemini has rewritten.
 *
 * Numbers are kept whatever their length. They are short but highly
 * distinguishing: dropping them makes "Fact number 0" and "Fact number 1"
 * identical, and does the same to two dates or two counts.
 */
export function savedInfoTokens(text: string): Set<string> {
  return new Set(
    savedInfoKey(text)
      .split(" ")
      .filter((word) => word.length >= SIMILARITY_MIN_WORD_LENGTH || /^\d+$/.test(word)),
  );
}

/**
 * How much two entries look like the same memory, from 0 to 1.
 *
 * Gemini rewrites what it saves ("Goes by Er, also Henry or Erik" is stored as
 * "I go by both Henry and Erik."), so the stored wording cannot be compared
 * with `savedInfoKey`. This compares content words instead, as a share of
 * whichever entry has fewer of them, so a rewrite that drops or adds words
 * still scores high.
 *
 * Entries with fewer than `SIMILARITY_MIN_TOKENS` content words have to match
 * exactly: with so few words, a partial overlap is as likely to be a different
 * memory about the same subject.
 */
export function savedInfoSimilarity(a: string, b: string): number {
  const left = savedInfoTokens(a);
  const right = savedInfoTokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;

  const smaller = Math.min(left.size, right.size);
  if (smaller < SIMILARITY_MIN_TOKENS) {
    return shared === left.size && shared === right.size ? 1 : 0;
  }
  return shared / smaller;
}
