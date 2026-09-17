// ─── Google batchexecute Protocol ────────────────────────────
// Encodes request payloads and decodes length-prefixed responses
// for the gemini.google.com internal RPC API.
//
// Reference: docs/gemini-api-analysis.md

// ─── Types ──────────────────────────────────────────────────

export interface RPCPayload {
  rpcid: string;
  /** JSON string containing the operation-specific payload */
  payload: string;
  /** Tag to match requests with responses in a batch */
  identifier?: string;
}

export interface GeminiSession {
  /** SNlM0e CSRF token — required for every batchexecute call */
  accessToken: string;
  /** cfb2h build label — sent as `bl` query param */
  buildLabel?: string;
  /** FdrFJe session ID — sent as `f.sid` query param */
  sessionId?: string;
  /** TuX5cc language code */
  language: string;
}

// ─── Constants ──────────────────────────────────────────────

const BATCH_EXEC_URL =
  "https://gemini.google.com/_/BardChatUi/data/batchexecute";

const BATCH_EXEC_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
  "X-Same-Domain": "1",
  "x-goog-ext-525001261-jspb":
    "[1,null,null,null,null,null,null,null,[4]]",
  "x-goog-ext-73010989-jspb": "[0]",
};

let reqId = Math.floor(Math.random() * 90000) + 10000;

// ─── Encoding ───────────────────────────────────────────────

/**
 * Serialize RPC payloads into the `f.req` form parameter value.
 *
 * Format: `JSON.stringify([[rpc1, rpc2, ...]])`
 * where each rpc is `[rpcid, payload_json_string, null, identifier]`.
 */
export function encodeRequest(payloads: RPCPayload[]): string {
  const serialized = payloads.map((p) => [
    p.rpcid,
    p.payload,
    null,
    p.identifier ?? "generic",
  ]);
  return JSON.stringify([serialized]);
}

// ─── Decoding ───────────────────────────────────────────────

/**
 * Parse a batchexecute response.
 *
 * 1. Strip the `)]}'` security prefix
 * 2. Parse length-prefixed frames (lengths are in UTF-16 code units)
 * 3. Return flat array of parsed JSON envelopes
 */
export function decodeResponse(text: string): unknown[] {
  let content = text;
  if (content.startsWith(")]}'")) {
    content = content.slice(4);
  }
  content = content.trimStart();
  return parseFrames(content);
}

/**
 * Google's length-prefixed framing protocol.
 *
 * Each frame: `[digit_count]\n[json_payload]`
 * where `digit_count` is the number of **UTF-16 code units** covering
 * everything from (and including) the `\n` after the digits to the end
 * of that frame's JSON.
 */
function parseFrames(content: string): unknown[] {
  const frames: unknown[] = [];
  let pos = 0;

  while (pos < content.length) {
    // Skip whitespace
    while (pos < content.length && /\s/.test(content.charAt(pos))) {
      pos++;
    }
    if (pos >= content.length) break;

    // Read the length marker: digits followed by \n
    const match = /^(\d+)\n/.exec(content.slice(pos));
    if (!match?.[1]) break;

    const digitStr: string = match[1];
    const lengthInUtf16 = parseInt(digitStr, 10);

    // Content starts right after the digit characters (the \n is part
    // of the counted length, matching the Python reference impl).
    const contentStart = pos + digitStr.length;

    // Walk forward counting UTF-16 code units
    let charCount = 0;
    let units = 0;
    while (
      units < lengthInUtf16 &&
      contentStart + charCount < content.length
    ) {
      const cp = content.codePointAt(contentStart + charCount)!;
      const unitSize = cp > 0xffff ? 2 : 1;
      if (units + unitSize > lengthInUtf16) break;
      units += unitSize;
      charCount++;
    }

    if (units < lengthInUtf16) break; // incomplete frame

    const chunk = content
      .slice(contentStart, contentStart + charCount)
      .trim();
    pos = contentStart + charCount;

    if (!chunk) continue;

    try {
      const parsed: unknown = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        frames.push(...(parsed as unknown[]));
      } else {
        frames.push(parsed);
      }
    } catch {
      // Skip malformed frames
    }
  }

  return frames;
}

/**
 * Extract the parsed body from a single batchexecute response envelope.
 *
 * Each envelope is `[rpcid, ???, body_json_string, ..., identifier]`.
 * Returns the parsed body (from index 2) or `null`.
 */
export function extractResponseBody(envelope: unknown): unknown | null {
  if (!Array.isArray(envelope)) return null;
  const bodyStr: unknown = envelope[2];
  if (typeof bodyStr !== "string") return null;
  try {
    return JSON.parse(bodyStr) as unknown;
  } catch {
    return null;
  }
}

/**
 * Get the identifier tag from a response envelope.
 */
export function getFrameIdentifier(envelope: unknown): string | null {
  if (!Array.isArray(envelope)) return null;
  const id: unknown = envelope[envelope.length - 1];
  return typeof id === "string" ? id : null;
}

// ─── HTTP ───────────────────────────────────────────────────

/**
 * Execute one or more RPCs via the batchexecute endpoint.
 *
 * Must be called from a content script running on gemini.google.com
 * so that cookies are included automatically.
 */
export async function batchExecute(
  session: GeminiSession,
  payloads: RPCPayload[],
): Promise<unknown[]> {
  const currentReqId = reqId;
  reqId += 100000;

  const params = new URLSearchParams({
    rpcids: payloads.map((p) => p.rpcid).join(","),
    hl: session.language,
    _reqid: String(currentReqId),
    rt: "c",
    "source-path": "/app",
  });

  if (session.buildLabel) {
    params.set("bl", session.buildLabel);
  }
  if (session.sessionId) {
    params.set("f.sid", session.sessionId);
  }

  const body = new URLSearchParams({
    at: session.accessToken,
    "f.req": encodeRequest(payloads),
  });

  const response = await fetch(`${BATCH_EXEC_URL}?${params.toString()}`, {
    method: "POST",
    headers: BATCH_EXEC_HEADERS,
    body: body.toString(),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      `batchexecute failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  return decodeResponse(text);
}
