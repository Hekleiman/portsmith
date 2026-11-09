import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  downloadFileBlob,
  downloadFileIdFor,
  withDownloadFileId,
} from "@/content-scripts/chatgpt/file-download";

const GIZMO_ID = "g-p-" + "a".repeat(32);

/** A gizmo file in the live /gizmos/{id} shape: `id` and `file_id` differ. */
const LIVE_FILE = {
  id: "6ae53c0e-0000-4000-8000-000000000000",
  file_id: "file_abc",
  name: "portsmith-probe.md",
  type: "text/markdown",
  size: 85,
};

function response(status: number, body: unknown, bytes?: Uint8Array): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve((bytes ?? new Uint8Array()).buffer),
  } as unknown as Response;
}

let urls: string[];

beforeEach(() => {
  urls = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      if (url === "/api/auth/session") return Promise.resolve(response(200, { accessToken: "t" }));
      if (url.startsWith("/backend-api/files/download/")) {
        const id = decodeURIComponent(url.split("/")[4]!.split("?")[0]!);
        if (!/^file[-_]/.test(id)) {
          return Promise.resolve(response(422, { detail: "Invalid file_id" }));
        }
        return Promise.resolve(response(200, { download_url: "https://files.example/blob" }));
      }
      if (url.includes("/simple")) {
        return Promise.resolve(response(200, { file_name: "portsmith-probe.md", mime_type: "text/markdown" }));
      }
      if (url === "https://files.example/blob") {
        return Promise.resolve(response(200, null, new TextEncoder().encode("# probe\n")));
      }
      return Promise.resolve(response(404, {}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadFileIdFor", () => {
  it("prefers file_id when it differs from id", () => {
    expect(downloadFileIdFor(LIVE_FILE)).toBe("file_abc");
    expect(downloadFileIdFor({ ...LIVE_FILE, file_id: "file-xyz" })).toBe("file-xyz");
  });

  it("falls back to id when file_id is missing or not a file ID", () => {
    expect(downloadFileIdFor({ ...LIVE_FILE, file_id: undefined })).toBe(LIVE_FILE.id);
    expect(downloadFileIdFor({ ...LIVE_FILE, file_id: "6ae53" })).toBe(LIVE_FILE.id);
  });
});

describe("knowledge file download", () => {
  it("requests the download URL with file_id, not id", async () => {
    const file = withDownloadFileId(LIVE_FILE);
    const result = await downloadFileBlob(file.id!, GIZMO_ID);

    expect(result.success).toBe(true);
    expect(result.fileName).toBe("portsmith-probe.md");
    const download = urls.find((u) => u.startsWith("/backend-api/files/download/"));
    expect(download).toBe(
      `/backend-api/files/download/file_abc?gizmo_id=${encodeURIComponent(GIZMO_ID)}`,
    );
    expect(urls.some((u) => u.includes(LIVE_FILE.id))).toBe(false);
  });

  it("gets the live 422 when the raw id is used (the 0.5.0 bug)", async () => {
    const result = await downloadFileBlob(LIVE_FILE.id, GIZMO_ID);
    expect(result).toEqual({ success: false, error: "HTTP 422" });
  });
});
