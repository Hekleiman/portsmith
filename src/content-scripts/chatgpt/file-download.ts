import type { GizmoAPIResponse } from "@/shared/messaging";

// ─── ChatGPT knowledge file downloads ───────────────────────

/** Files are passed around as base64 in runtime messages; keep them modest. */
export const MAX_DOWNLOAD_BYTES = 7_500_000;

type GizmoFile = NonNullable<GizmoAPIResponse["files"]>[number];

const DOWNLOAD_FILE_ID = /^file[-_]/;

/**
 * The ID that /backend-api/files/download accepts for a gizmo file.
 * `/gizmos/{id}` returns both `id` and `file_id` for each file, and they
 * differ: `id` gets a 422 ("expected to start with 'file-' or 'file_'")
 * while `file_id` downloads. Falls back to `id` when `file_id` is missing
 * or isn't in that form.
 */
export function downloadFileIdFor(file: GizmoFile): string | undefined {
  if (typeof file.file_id === "string" && DOWNLOAD_FILE_ID.test(file.file_id)) {
    return file.file_id;
  }
  return file.id;
}

/** The file with `id` set to its download ID (see downloadFileIdFor). */
export function withDownloadFileId(file: GizmoFile): GizmoFile {
  return { ...file, id: downloadFileIdFor(file) };
}

/**
 * Download a single file blob directly from ChatGPT's backend API.
 * Runs in the content script (same-origin), so the service worker
 * can't die mid-request.
 */
export async function downloadFileBlob(
  fileId: string,
  gizmoId: string,
): Promise<{
  success: boolean;
  blob?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}> {
  try {
    // Step 1: Get access token from ChatGPT session
    const sessionResp = await fetch("/api/auth/session");
    if (!sessionResp.ok) return { success: false, error: "Failed to get session" };
    const session = (await sessionResp.json()) as Record<string, unknown>;
    const token = session.accessToken as string | undefined;
    if (!token) return { success: false, error: "No access token" };

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    // Step 2: Get signed download URL
    console.log("[PortSmith] Fetching download URL for:", fileId);
    const dlResp = await fetch(
      `/backend-api/files/download/${encodeURIComponent(fileId)}?gizmo_id=${encodeURIComponent(gizmoId)}`,
      { headers },
    );
    if (!dlResp.ok) return { success: false, error: `HTTP ${dlResp.status}` };
    const dlData = (await dlResp.json()) as { download_url?: string };
    if (!dlData.download_url) return { success: false, error: "No download URL" };

    // Step 3: Get file metadata
    let meta: { file_name?: string; mime_type?: string } = {};
    try {
      const metaResp = await fetch(
        `/backend-api/files/${encodeURIComponent(fileId)}/simple?gizmo_id=${encodeURIComponent(gizmoId)}`,
        { headers },
      );
      if (metaResp.ok) meta = (await metaResp.json()) as typeof meta;
    } catch {
      // Non-fatal: metadata is nice-to-have
    }

    // Step 4: Download the actual file blob
    console.log("[PortSmith] Downloading blob for:", meta.file_name ?? fileId);
    const blobResp = await fetch(dlData.download_url);
    if (!blobResp.ok) return { success: false, error: `Blob HTTP ${blobResp.status}` };

    const arrayBuffer = await blobResp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      return { success: false, error: `Too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB)` };
    }

    // Base64 encode in chunks to avoid call stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }

    console.log("[PortSmith] File downloaded:", meta.file_name ?? fileId, `(${(bytes.length / 1024).toFixed(1)}KB)`);

    return {
      success: true,
      blob: btoa(binary),
      fileName: meta.file_name ?? undefined,
      mimeType: meta.mime_type ?? blobResp.headers.get("content-type") ?? "application/octet-stream",
      sizeBytes: bytes.length,
    };
  } catch (e: unknown) {
    console.error("[PortSmith] Download error for", fileId, e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

