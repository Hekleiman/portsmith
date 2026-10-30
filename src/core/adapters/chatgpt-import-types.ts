// ─── ChatGPT Import Result Types ─────────────────────────────
// Types for creating ChatGPT projects and adding files to their Sources
// through ChatGPT's internal API.

/** Config payload for creating a ChatGPT project. */
export interface ChatGPTProjectConfig {
  /** At most 50 code points (see core/transform/chatgpt-limits.ts). */
  name: string;
  /** At most 8000 code points. */
  instructions: string;
}

/** Result of creating a ChatGPT project. */
export interface ChatGPTCreateResult {
  success: boolean;
  /** The new project's `g-p-` ID. Also set on an instructions mismatch. */
  gizmoId?: string;
  /** Human-readable error message on failure. */
  error?: string;
  /** The request may have reached ChatGPT, so the project may exist. */
  maybeCreated?: boolean;
  /** The project exists, but ChatGPT saved different instructions. */
  instructionsMismatch?: boolean;
}

/** One file to add to a project's Sources. */
export interface ChatGPTUploadRequest {
  /** The project's `g-p-` ID. */
  gizmoId: string;
  fileName: string;
  mimeType: string;
  /** The file's bytes, base64-encoded (at most 512 MiB decoded). */
  base64: string;
}

/** Result of adding one file to a project's Sources. */
export interface ChatGPTUploadResult {
  success: boolean;
  /** The `file_` ID ChatGPT assigned. */
  fileId?: string;
  /** Human-readable error message on failure. */
  error?: string;
  /** Which of the four upload steps failed. */
  step?: "reserve" | "upload" | "process" | "attach";
}
