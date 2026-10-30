// ─── ChatGPT Project Importer ────────────────────────────────
// Content script that runs on chatgpt.com.
// Creates projects and adds files to their Sources via ChatGPT's internal
// API. Every endpoint below was verified live on 2026-10-30 from a
// signed-in Plus account:
//
//   Create (one call, name and instructions together)
//     POST /backend-api/projects
//
//   Add a file to Sources (all four steps are required)
//     1. POST /backend-api/files                         reserve, get upload_url
//     2. PUT  <upload_url>                               raw bytes to Azure blob storage
//     3. POST /backend-api/files/process_upload_stream   index it (NDJSON events)
//     4. POST /backend-api/projects/{gizmo_id}/files     attach it to the project
//
// Without step 4 the file is processed but never appears in the project.
//
// The PUT goes to oaiusercontent.com with a SAS query string, so it uses
// plain fetch: the bearer token must never be sent there. Neither the
// token nor the upload_url is ever logged or returned.

import { onMessage, initMessageRouter } from "@/shared/messaging";
import type {
  ChatGPTCreateResult,
  ChatGPTProjectConfig,
  ChatGPTUploadRequest,
  ChatGPTUploadResult,
} from "@/core/adapters/chatgpt-import-types";
import {
  CHATGPT_INSTRUCTIONS_MAX,
  CHATGPT_PROJECT_NAME_MAX,
  codePointLength,
} from "@/core/transform/chatgpt-limits";
import { base64ToBytes } from "@/shared/encoding";
import {
  ChatGPTApiError,
  chatgptRequest,
  chatgptRequestText,
  isProjectGizmoId,
  listProjectSummaries,
  nameKey,
  readValidationError,
} from "./api";

// ─── Constants ──────────────────────────────────────────────

const PROJECTS_PATH = "/backend-api/projects";
const FILES_PATH = "/backend-api/files";
const PROCESS_PATH = "/backend-api/files/process_upload_stream";

/** ChatGPT's per-file limit: 536,870,912 bytes is accepted, one more is not. */
export const CHATGPT_FILE_MAX_BYTES = 512 * 1024 * 1024;

const DEFAULT_MIME = "application/octet-stream";
const PROCESSING_COMPLETED = "file.processing.completed";

// ─── Helpers ────────────────────────────────────────────────

/**
 * A short error message that never carries a response body. Validation
 * errors become a readable sentence; anything else is reduced to its
 * HTTP status.
 */
function describeError(err: unknown, action: string): string {
  if (err instanceof ChatGPTApiError) {
    const readable = readValidationError(err);
    if (readable) return readable;
    return `ChatGPT answered HTTP ${err.status} ${action}`;
  }
  return `Couldn't reach ChatGPT ${action}${
    err instanceof Error && err.message ? ` (${err.message})` : ""
  }`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Byte length of base64 data, without decoding it. Note that V8 caps a
 * string at about 2^29 characters, so base64 for a file near the 512 MiB
 * limit can't exist in the first place; this check is the backstop.
 */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

// ─── Create ─────────────────────────────────────────────────

/**
 * Creates a project with its name and instructions in one call.
 *
 * A 4xx means ChatGPT refused and nothing was created. A 5xx or a network
 * error may have created it anyway, so those return `maybeCreated`.
 * ChatGPT echoes the saved instructions; if they differ from what was
 * sent, the project exists but the result is a failure.
 */
export async function createProject(
  config: ChatGPTProjectConfig,
): Promise<ChatGPTCreateResult> {
  if (codePointLength(config.name) > CHATGPT_PROJECT_NAME_MAX) {
    return {
      success: false,
      error: `ChatGPT allows at most ${CHATGPT_PROJECT_NAME_MAX} characters in a project name`,
    };
  }
  if (codePointLength(config.instructions) > CHATGPT_INSTRUCTIONS_MAX) {
    return {
      success: false,
      error: `ChatGPT allows at most ${CHATGPT_INSTRUCTIONS_MAX} characters in project instructions`,
    };
  }

  let body: unknown;
  try {
    body = await chatgptRequest<unknown>(PROJECTS_PATH, {
      method: "POST",
      body: JSON.stringify({
        emoji: null,
        instructions: config.instructions,
        memory_scope: "unset",
        name: config.name,
        theme: null,
      }),
    });
  } catch (err) {
    const definite = err instanceof ChatGPTApiError && err.status < 500;
    return {
      success: false,
      error: describeError(err, "creating the project"),
      ...(definite ? {} : { maybeCreated: true }),
    };
  }

  const gizmo = asRecord(asRecord(asRecord(body)?.resource)?.gizmo);
  const gizmoId = gizmo?.id;
  if (!isProjectGizmoId(gizmoId)) {
    return {
      success: false,
      error:
        "ChatGPT's reply didn't include a project ID, so the project may or may not exist",
      maybeCreated: true,
    };
  }

  const saved = gizmo?.instructions ?? "";
  if (saved !== config.instructions) {
    return {
      success: false,
      gizmoId,
      instructionsMismatch: true,
      error:
        "ChatGPT created the project, but the instructions it saved don't match what PortSmith sent",
    };
  }

  return { success: true, gizmoId };
}

// ─── Upload ─────────────────────────────────────────────────

/**
 * Event names from a process_upload_stream body. The content type says
 * event-stream, but the body is newline-delimited JSON objects; a `data:`
 * prefix is tolerated in case that changes. The event name is read from
 * `event` or `type`, else from any top-level string that looks like one.
 */
export function readProcessEvents(text: string): string[] {
  const events: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^data:\s*/, "");
    if (!line || !line.startsWith("{")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (!record) continue;

    const named = [record.event, record.type].find(
      (v): v is string => typeof v === "string" && v.startsWith("file."),
    );
    const found =
      named ??
      Object.values(record).find(
        (v): v is string => typeof v === "string" && /^file\.[a-z_.]+$/.test(v),
      );
    if (found) events.push(found);
  }
  return events;
}

/** Whether a project file list (`resource.files`) includes `fileId`. */
function listIncludes(files: unknown, fileId: string): boolean {
  if (!Array.isArray(files)) return false;
  return files.some((f) => {
    const file = asRecord(f);
    return file?.file_id === fileId || file?.id === fileId;
  });
}

/**
 * Adds one file to a project's Sources: reserve, upload the bytes,
 * process, then attach. Each step must succeed before the next runs, and
 * a failure reports which step it was.
 */
export async function uploadProjectFile(
  req: ChatGPTUploadRequest,
): Promise<ChatGPTUploadResult> {
  const { gizmoId, fileName } = req;
  const mimeType = req.mimeType || DEFAULT_MIME;

  if (!isProjectGizmoId(gizmoId)) {
    return { success: false, step: "reserve", error: "That isn't a ChatGPT project ID" };
  }
  if (base64ByteLength(req.base64) > CHATGPT_FILE_MAX_BYTES) {
    return {
      success: false,
      step: "reserve",
      error: `${fileName} is larger than ChatGPT's 512 MB file limit`,
    };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(req.base64);
  } catch {
    return { success: false, step: "reserve", error: `${fileName} couldn't be read` };
  }

  // 1. Reserve: ChatGPT returns a file ID and a one-time upload URL.
  let fileId: string;
  let uploadUrl: string;
  try {
    const reserved = asRecord(
      await chatgptRequest<unknown>(FILES_PATH, {
        method: "POST",
        body: JSON.stringify({
          file_name: fileName,
          file_size: bytes.byteLength,
          gizmo_id: gizmoId,
          mime_type: mimeType,
          reset_rate_limits: false,
          supports_direct_azure_multipart: true,
          timezone_offset_min: new Date().getTimezoneOffset(),
          use_case: "gizmo",
        }),
      }),
    );
    const id = reserved?.file_id;
    const url = reserved?.upload_url;
    if (
      reserved?.status !== "success" ||
      typeof id !== "string" ||
      !id ||
      typeof url !== "string" ||
      !url.startsWith("https://")
    ) {
      return {
        success: false,
        step: "reserve",
        error: `ChatGPT didn't accept ${fileName} for upload`,
      };
    }
    fileId = id;
    uploadUrl = url;
  } catch (err) {
    if (err instanceof ChatGPTApiError && err.body.includes("file_too_large")) {
      return {
        success: false,
        step: "reserve",
        error: `${fileName} is larger than ChatGPT's 512 MB file limit`,
      };
    }
    return {
      success: false,
      step: "reserve",
      error: describeError(err, `reserving ${fileName}`),
    };
  }

  // 2. Upload the bytes. Plain fetch with no credentials: the bearer
  // token must never go to oaiusercontent.com.
  try {
    const resp = await fetch(uploadUrl, {
      method: "PUT",
      body: bytes,
      credentials: "omit",
      headers: {
        "Content-Type": mimeType,
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": "2020-04-08",
        "x-ms-blob-content-type": mimeType,
      },
    });
    if (!resp.ok) {
      return {
        success: false,
        fileId,
        step: "upload",
        error: `File storage answered HTTP ${resp.status} uploading ${fileName}`,
      };
    }
  } catch {
    // The error could name the URL, so it is not passed on.
    return {
      success: false,
      fileId,
      step: "upload",
      error: `Couldn't reach ChatGPT's file storage uploading ${fileName}`,
    };
  }

  // 3. Process: index the file for the project.
  try {
    const stream = await chatgptRequestText(PROCESS_PATH, {
      method: "POST",
      body: JSON.stringify({
        entry_surface: "project_sources",
        file_id: fileId,
        file_name: fileName,
        gizmo_id: gizmoId,
        index_for_retrieval: true,
        mime_type: mimeType,
        use_case: "gizmo",
      }),
    });
    if (!readProcessEvents(stream).includes(PROCESSING_COMPLETED)) {
      return {
        success: false,
        fileId,
        step: "process",
        error: `ChatGPT didn't finish processing ${fileName}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      fileId,
      step: "process",
      error: describeError(err, `processing ${fileName}`),
    };
  }

  // 4. Attach to the project. This appends; the reply lists every file.
  try {
    const attached = asRecord(
      await chatgptRequest<unknown>(`${PROJECTS_PATH}/${gizmoId}/files`, {
        method: "POST",
        body: JSON.stringify({
          files: [
            {
              file_id: fileId,
              last_modified: Date.now(),
              location: "fs",
              name: fileName,
              size: bytes.byteLength,
              type: mimeType,
            },
          ],
        }),
      }),
    );
    if (!listIncludes(asRecord(attached?.resource)?.files, fileId)) {
      return {
        success: false,
        fileId,
        step: "attach",
        error: `ChatGPT processed ${fileName} but didn't list it in the project`,
      };
    }
  } catch (err) {
    return {
      success: false,
      fileId,
      step: "attach",
      error: describeError(err, `adding ${fileName} to the project`),
    };
  }

  return { success: true, fileId };
}

// ─── Duplicate check ────────────────────────────────────────

/**
 * IDs of the user's projects whose name matches `name` (case- and
 * space-insensitive). Null when the listing fails, so callers can tell
 * "none" from "couldn't check".
 */
export async function findProjectsNamed(name: string): Promise<string[] | null> {
  try {
    const key = nameKey(name);
    const projects = await listProjectSummaries();
    return projects.filter((p) => nameKey(p.name) === key).map((p) => p.gizmoId);
  } catch {
    return null;
  }
}

// ─── Message Handlers ───────────────────────────────────────

initMessageRouter();

onMessage("CHATGPT_CREATE_PROJECT", async (req) => {
  return createProject(req);
});

onMessage("CHATGPT_UPLOAD_PROJECT_FILE", async (req) => {
  return uploadProjectFile(req);
});

onMessage("CHATGPT_FIND_PROJECTS", async (req) => {
  const gizmoIds = await findProjectsNamed(req.name);
  return gizmoIds
    ? { success: true, gizmoIds }
    : { success: false, error: "Couldn't list your ChatGPT projects" };
});

console.log("[PortSmith] ChatGPT importer content script loaded");
