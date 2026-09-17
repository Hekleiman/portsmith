// ─── Gem Knowledge Files ────────────────────────────────────
// Adds files to a Gem's "Knowledge" the way the Gem editor does
// (recorded on gemini.google.com, Sep 2026):
//
// 1. The file goes to Google's upload service and comes back as a
//    temporary reference ("/contrib_service/ttl_1d/...").
// 2. BardFrontendService/ProcessFile turns that reference into a
//    file handle ("$AX...").
// 3. Saving the Gem (kHv0Vd) sends the full list of handles. The list
//    replaces the Gem's knowledge, so it must always be complete.

import {
  BATCH_EXEC_HEADERS,
  GEMINI_ORIGIN,
  decodeResponse,
  extractResponseBody,
  nextReqId,
  type GeminiSession,
} from "./batchexecute";

/** Used when the page doesn't expose its own push channel. */
export const DEFAULT_PUSH_ID = "feeds/mcudyrk2a4khkz";
const UPLOAD_URL = "https://content-push.googleapis.com/upload";
const PROCESS_FILE_PATH =
  "/_/BardChatUi/data/assistant.lamda.BardFrontendService/ProcessFile";

/** Gemini's per-file upload limit (Gemini Apps Help, "Upload & analyze files"). */
export const GEMINI_FILE_LIMIT_BYTES = 100 * 1024 * 1024;

export class GeminiHttpError extends Error {
  constructor(
    public readonly status: number,
    what: string,
  ) {
    super(`${what} failed: HTTP ${status}`);
    this.name = "GeminiHttpError";
  }
}

// ─── Payloads ───────────────────────────────────────────────

/** `f.req` for ProcessFile. */
export function buildProcessFileRequest(
  fileRef: string,
  fileName: string,
  mimeType: string,
  language: string,
): string {
  const inner = [
    [[fileRef, null, 1, mimeType], fileName, null, null, null, null, null, null, [1]],
    null,
    1,
    [language],
  ];
  return JSON.stringify([null, JSON.stringify(inner)]);
}

/**
 * File handle from a ProcessFile reply. The reply streams the same
 * record more than once; the last one wins.
 */
export function parseProcessFileResponse(text: string): string | null {
  let handle: string | null = null;
  for (const envelope of decodeResponse(text)) {
    if (!Array.isArray(envelope) || envelope[0] !== "wrb.fr") continue;
    const body = extractResponseBody(envelope);
    if (!Array.isArray(body) || !Array.isArray(body[0])) continue;
    const value: unknown = (body[0] as unknown[])[5];
    if (typeof value === "string" && value.startsWith("$")) handle = value;
  }
  return handle;
}

/** The Gem's knowledge field (index 14 of the Gem record) for these handles. */
export function buildKnowledgeField(handles: string[]): unknown[] {
  if (handles.length === 0) return [];
  return [handles.map((h) => [null, null, null, null, null, h])];
}

// ─── Requests ───────────────────────────────────────────────

function uploadHeaders(session: GeminiSession): Record<string, string> {
  return {
    "Push-ID": session.pushId ?? DEFAULT_PUSH_ID,
    "X-Tenant-Id": "bard-storage",
  };
}

async function readFileRef(response: Response, what: string): Promise<string> {
  if (!response.ok) throw new GeminiHttpError(response.status, what);
  const ref = (await response.text()).trim();
  if (!ref.startsWith("/contrib_service/")) {
    throw new Error("File upload didn't return a file reference");
  }
  return ref;
}

/** One multipart request (what the Gemini-API Python client sends). */
async function uploadMultipart(
  session: GeminiSession,
  blob: Blob,
  fileName: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", blob, fileName);
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: uploadHeaders(session),
    body: form,
    credentials: "include",
  });
  return readFileRef(response, "File upload");
}

/** Google's resumable protocol: start, then upload and finalize. */
async function uploadResumable(
  session: GeminiSession,
  blob: Blob,
  fileName: string,
): Promise<string> {
  const headers = {
    ...uploadHeaders(session),
    "X-Goog-Upload-Protocol": "resumable",
    "X-Goog-Upload-Header-Content-Length": String(blob.size),
  };
  const start = await fetch(`${UPLOAD_URL}/`, {
    method: "POST",
    headers: {
      ...headers,
      "X-Goog-Upload-Command": "start",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: `File name: ${fileName}`,
    credentials: "include",
  });
  if (!start.ok) throw new GeminiHttpError(start.status, "Starting the file upload");
  const target = start.headers.get("X-Goog-Upload-Url") ?? "";
  if (!/^https:\/\/content-push\.googleapis\.com\//.test(target)) {
    throw new Error("File upload didn't return an upload address");
  }
  const response = await fetch(target, {
    method: "POST",
    headers: {
      ...headers,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body: blob,
    credentials: "include",
  });
  return readFileRef(response, "File upload");
}

/**
 * Upload the bytes and return Google's temporary file reference. Tries a
 * single multipart request first, then the resumable protocol.
 */
export async function uploadFileBytes(
  session: GeminiSession,
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const blob = new Blob([bytes], { type: mimeType });
  try {
    return await uploadMultipart(session, blob, fileName);
  } catch (first) {
    try {
      return await uploadResumable(session, blob, fileName);
    } catch (second) {
      const a = first instanceof Error ? first.message : String(first);
      const b = second instanceof Error ? second.message : String(second);
      throw new Error(a === b ? a : `${a} (retry: ${b})`);
    }
  }
}

/** Turn an uploaded file reference into a handle a Gem can keep. */
export async function processFile(
  session: GeminiSession,
  fileRef: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const prefix = session.prefix ?? "";
  const params = new URLSearchParams({
    hl: session.language,
    _reqid: String(nextReqId()),
    rt: "c",
  });
  if (session.buildLabel) params.set("bl", session.buildLabel);
  if (session.sessionId) params.set("f.sid", session.sessionId);

  const body = new URLSearchParams({
    "f.req": buildProcessFileRequest(fileRef, fileName, mimeType, session.language),
    at: session.accessToken,
  });

  const response = await fetch(
    `${GEMINI_ORIGIN}${prefix}${PROCESS_FILE_PATH}?${params.toString()}`,
    {
      method: "POST",
      headers: BATCH_EXEC_HEADERS,
      body: body.toString(),
      credentials: "include",
    },
  );
  if (!response.ok) throw new GeminiHttpError(response.status, "Processing the file");
  const handle = parseProcessFileResponse(await response.text());
  if (!handle) throw new Error("Gemini didn't accept the file");
  return handle;
}
