import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown, sender?: unknown) => unknown>(),
}));

vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (payload: unknown) => unknown) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
  sendMessage: vi.fn(async () => undefined),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cookieJar = { cookie: `lastActiveOrg=${ORG}` };
vi.stubGlobal("document", cookieJar);

import "@/content-scripts/claude/importer";
import { textToBase64, bytesToBase64 } from "@/shared/encoding";

// ─── Fake Claude API ────────────────────────────────────────

interface Call {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  headers: Record<string, string>;
}

type Responder = (call: Call) => Response;

const calls: Call[] = [];
let respond: Responder;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function call<T>(name: string, payload: unknown): Promise<T> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for ${name}`);
  return (await handler(payload)) as T;
}

beforeEach(() => {
  calls.length = 0;
  cookieJar.cookie = `lastActiveOrg=${ORG}`;
  respond = () => json({ uuid: "new-uuid" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(c);
      return respond(c);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────

describe("CLAUDE_CREATE_PROJECT", () => {
  it("creates a private project and returns its ID", async () => {
    respond = () => json({ uuid: PROJECT, name: "Trips" });
    const result = await call<{ success: boolean; uuid?: string }>("CLAUDE_CREATE_PROJECT", {
      name: "Trips",
      description: "Plans trips",
    });
    expect(result).toEqual({ success: true, uuid: PROJECT });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/organizations/${ORG}/projects`);
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      name: "Trips",
      description: "Plans trips",
      is_private: true,
    });
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
  });

  it("fails without a Claude session and makes no request", async () => {
    cookieJar.cookie = "other=1";
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_CREATE_PROJECT", {
      name: "Trips",
      description: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not logged in/i);
    expect(calls).toHaveLength(0);
  });

  it("does not report success when Claude returns no project ID", async () => {
    respond = () => json({ ok: true });
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_CREATE_PROJECT", {
      name: "Trips",
      description: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/check your projects/i);
  });

  it("retries after HTTP 429 and creates the project once", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    respond = () => {
      attempts++;
      return attempts === 1
        ? json({ error: "rate limited" }, 429, { "retry-after": "2" })
        : json({ uuid: PROJECT });
    };
    const pending = call<{ success: boolean; uuid?: string }>("CLAUDE_CREATE_PROJECT", {
      name: "Trips",
      description: "",
    });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ success: true, uuid: PROJECT });
    expect(attempts).toBe(2);
  });

  it("surfaces the HTTP status on failure", async () => {
    respond = () => json({ error: { message: "nope" } }, 403);
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_CREATE_PROJECT", {
      name: "Trips",
      description: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 403");
  });
});

describe("CLAUDE_SET_INSTRUCTIONS", () => {
  it("writes prompt_template with PUT", async () => {
    respond = () => json({ uuid: PROJECT });
    const result = await call<{ success: boolean }>("CLAUDE_SET_INSTRUCTIONS", {
      projectUuid: PROJECT,
      instructions: "Be brief.",
    });
    expect(result.success).toBe(true);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe(`/api/organizations/${ORG}/projects/${PROJECT}`);
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ prompt_template: "Be brief." });
  });

  it("rejects a project ID that is not a UUID", async () => {
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_SET_INSTRUCTIONS", {
      projectUuid: "../../organizations",
      instructions: "x",
    });
    expect(result).toEqual({ success: false, error: "Invalid project ID" });
    expect(calls).toHaveLength(0);
  });
});

describe("CLAUDE_UPLOAD_FILE", () => {
  it("sends text files as JSON project docs", async () => {
    respond = () => json({ uuid: "doc-1" });
    const result = await call<{ success: boolean; fileUuid?: string }>("CLAUDE_UPLOAD_FILE", {
      projectUuid: PROJECT,
      fileName: "notes.md",
      mimeType: "text/markdown",
      fileBlob: textToBase64("# Notes\nCafé ☕"),
    });
    expect(result).toEqual({ success: true, fileUuid: "doc-1" });
    expect(calls[0]!.url).toBe(`/api/organizations/${ORG}/projects/${PROJECT}/docs`);
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      file_name: "notes.md",
      content: "# Notes\nCafé ☕",
    });
  });

  it("recognizes text files by extension when the MIME type is generic", async () => {
    respond = () => json({ uuid: "doc-2" });
    await call("CLAUDE_UPLOAD_FILE", {
      projectUuid: PROJECT,
      fileName: "data.csv",
      mimeType: "application/octet-stream",
      fileBlob: textToBase64("a,b\n1,2"),
    });
    expect(calls[0]!.url).toMatch(/\/docs$/);
  });

  it("uploads binary files as multipart data to /upload", async () => {
    respond = () => json({ file_uuid: "file-9" });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const result = await call<{ success: boolean; fileUuid?: string }>("CLAUDE_UPLOAD_FILE", {
      projectUuid: PROJECT,
      fileName: "report.pdf",
      mimeType: "application/pdf",
      fileBlob: bytesToBase64(bytes),
    });
    expect(result).toEqual({ success: true, fileUuid: "file-9" });
    const upload = calls[0]!;
    expect(upload.url).toBe(`/api/organizations/${ORG}/projects/${PROJECT}/upload`);
    expect(upload.method).toBe("POST");
    // the browser must set the multipart boundary itself
    expect(upload.headers["Content-Type"]).toBeUndefined();
    expect(upload.body).toBeInstanceOf(FormData);
    const file = (upload.body as FormData).get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("report.pdf");
    expect((file as Blob).type).toBe("application/pdf");
    expect(new Uint8Array(await (file as Blob).arrayBuffer())).toEqual(bytes);
  });

  it("falls back to a binary upload when a 'text' file is not valid UTF-8", async () => {
    respond = () => json({ uuid: "file-10" });
    await call("CLAUDE_UPLOAD_FILE", {
      projectUuid: PROJECT,
      fileName: "legacy.txt",
      mimeType: "text/plain",
      fileBlob: bytesToBase64(new Uint8Array([0x66, 0xff, 0xfe, 0x6f])),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/upload$/);
  });

  it("explains a 413 response", async () => {
    respond = () => json({ error: "too large" }, 413);
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_UPLOAD_FILE", {
      projectUuid: PROJECT,
      fileName: "huge.zip",
      mimeType: "application/zip",
      fileBlob: bytesToBase64(new Uint8Array([1, 2, 3])),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("file too large for Claude");
  });

  it("rejects an invalid project ID", async () => {
    const result = await call<{ success: boolean }>("CLAUDE_UPLOAD_FILE", {
      projectUuid: "not-a-uuid",
      fileName: "a.txt",
      mimeType: "text/plain",
      fileBlob: textToBase64("a"),
    });
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("CLAUDE_CREATE_DOC", () => {
  it("creates a knowledge doc with the given name and content", async () => {
    respond = () => json({ uuid: "doc-7" });
    const result = await call<{ success: boolean; uuid?: string }>("CLAUDE_CREATE_DOC", {
      projectUuid: PROJECT,
      fileName: "Project memory (from ChatGPT).md",
      content: "# Project memory\n- Prefers metric units",
    });
    expect(result).toEqual({ success: true, uuid: "doc-7" });
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      file_name: "Project memory (from ChatGPT).md",
      content: "# Project memory\n- Prefers metric units",
    });
  });

  it("reports API failures instead of throwing", async () => {
    respond = () => json({}, 500);
    const result = await call<{ success: boolean; error?: string }>("CLAUDE_CREATE_DOC", {
      projectUuid: PROJECT,
      fileName: "a.md",
      content: "x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });
});

describe("CLAUDE_VERIFY_PROJECT", () => {
  it("counts docs and files together", async () => {
    respond = () =>
      json({ name: "Trips", prompt_template: "  Plan.  ", docs_count: 2, files_count: 1 });
    const result = await call<Record<string, unknown>>("CLAUDE_VERIFY_PROJECT", {
      projectUuid: PROJECT,
    });
    expect(result).toEqual({
      success: true,
      name: "Trips",
      hasInstructions: true,
      instructionsLength: 9,
      filesCount: 3,
    });
  });

  it("treats blank instructions as missing", async () => {
    respond = () => json({ name: "Trips", prompt_template: "   " });
    const result = await call<{ hasInstructions: boolean; filesCount: number }>(
      "CLAUDE_VERIFY_PROJECT",
      { projectUuid: PROJECT },
    );
    expect(result.hasInstructions).toBe(false);
    expect(result.filesCount).toBe(0);
  });
});

describe("CLAUDE_FIND_PROJECTS", () => {
  it("matches names case-insensitively across pages", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Project ${i}`,
    }));
    const page2 = [{ uuid: "00000000-0000-4000-8000-999999999999", name: "Trip Planner " }];
    respond = (c) => {
      const offset = Number(new URL(c.url, "https://claude.ai").searchParams.get("offset"));
      return json(offset === 0 ? page1 : offset === 100 ? page2 : []);
    };
    const result = await call<{ found: string[]; notFound: string[] }>("CLAUDE_FIND_PROJECTS", {
      names: ["trip planner", "Project 42", "Missing"],
    });
    expect(result.found).toEqual(["trip planner", "Project 42"]);
    expect(result.notFound).toEqual(["Missing"]);
    expect(calls.map((c) => c.url)).toEqual([
      `/api/organizations/${ORG}/projects?limit=100&offset=0`,
      `/api/organizations/${ORG}/projects?limit=100&offset=100`,
    ]);
  });

  it("stops paging when a page repeats (API ignores offset)", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Project ${i}`,
    }));
    respond = () => json(page);
    const result = await call<{ found: string[] }>("CLAUDE_FIND_PROJECTS", {
      names: ["Project 1"],
    });
    expect(result.found).toEqual(["Project 1"]);
    expect(calls).toHaveLength(2);
  });

  it("returns every name as not found when signed out", async () => {
    cookieJar.cookie = "";
    const result = await call<{ found: string[]; notFound: string[]; error?: string }>(
      "CLAUDE_FIND_PROJECTS",
      { names: ["A", "B"] },
    );
    expect(result).toEqual({ found: [], notFound: ["A", "B"], error: "Not logged in to Claude" });
  });
});

describe("PING", () => {
  it("answers", async () => {
    await expect(call("PING", undefined)).resolves.toEqual({ pong: true });
  });
});
