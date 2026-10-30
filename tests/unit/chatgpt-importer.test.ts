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

import {
  base64ByteLength,
  CHATGPT_FILE_MAX_BYTES,
  createProject,
  findProjectsNamed,
  readProcessEvents,
  uploadProjectFile,
} from "@/content-scripts/chatgpt/importer";
import {
  ChatGPTApiError,
  chatgptRequestText,
  clearAccessToken,
  readValidationError,
} from "@/content-scripts/chatgpt/api";
import { textToBase64 } from "@/shared/encoding";

// ─── Fixtures (redacted) ────────────────────────────────────

const GIZMO_ID = "g-p-" + "a".repeat(32);
const OTHER_GIZMO_ID = "g-p-" + "b".repeat(32);
const FILE_ID = "file_0123456789abcdef0123456789abcdef";
const UPLOAD_URL = "https://sdmntprwestus.oaiusercontent.com/files/x/raw?sig=REDACTED";
const TOKEN = "test-token";

function createdBody(instructions: string, id = GIZMO_ID): unknown {
  return { resource: { gizmo: { id, instructions }, files: [] } };
}

const RESERVED = { status: "success", upload_url: UPLOAD_URL, file_id: FILE_ID };

const PROCESS_STREAM = [
  { event: "file.processing.started", message: "Started processing file" },
  { event: "file.processing.file_ready", message: "Ready to download notes.md" },
  { event: "file.indexing.completed", message: "Indexed" },
  { event: "file.processing.completed", message: "Succeeded processing file notes.md" },
]
  .map((e) => JSON.stringify(e))
  .join("\n");

const ATTACHED = {
  resource: {
    gizmo: { id: GIZMO_ID },
    files: [{ file_id: "file_earlier" }, { file_id: FILE_ID, name: "notes.md" }],
  },
};

// ─── Fetch harness ──────────────────────────────────────────

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

type Responder = (call: Call) => Response | Promise<Response>;

let calls: Call[];
let routes: Array<[match: (c: Call) => boolean, respond: Responder]>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function route(match: string | ((c: Call) => boolean), respond: Responder): void {
  const test = typeof match === "string" ? (c: Call) => c.url === match : match;
  routes.unshift([test, respond]);
}

/** Calls other than the session read. */
function apiCalls(): Call[] {
  return calls.filter((c) => c.url !== "/api/auth/session");
}

function bodyOf(call: Call | undefined): unknown {
  return JSON.parse(String(call?.body));
}

beforeEach(() => {
  clearAccessToken();
  calls = [];
  routes = [];
  route("/api/auth/session", () => json({ accessToken: TOKEN }));

  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body: init.body,
      credentials: init.credentials,
    };
    calls.push(call);
    const hit = routes.find(([match]) => match(call));
    if (!hit) throw new Error(`Unrouted fetch: ${call.method} ${url}`);
    return hit[1](call);
  });
  vi.stubGlobal("document", { cookie: "oai-did=device-abc" });
  vi.stubGlobal("navigator", { language: "en-US" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

// ─── readValidationError ────────────────────────────────────

describe("readValidationError", () => {
  function error422(field: string, max: number): ChatGPTApiError {
    const body = JSON.stringify({
      detail: [
        {
          type: "string_too_long",
          loc: ["body", field],
          msg: `String should have at most ${max} characters`,
          ctx: { max_length: max },
        },
      ],
    });
    return new ChatGPTApiError(422, "HTTP 422", body);
  }

  it("turns a too-long name into a sentence", () => {
    expect(readValidationError(error422("name", 50))).toBe(
      "ChatGPT allows at most 50 characters in a project name",
    );
  });

  it("turns too-long instructions into a sentence", () => {
    expect(readValidationError(error422("instructions", 8000))).toBe(
      "ChatGPT allows at most 8000 characters in project instructions",
    );
  });

  it("returns null for anything that isn't a 422 detail list", () => {
    expect(readValidationError(new ChatGPTApiError(500, "HTTP 500", "{}"))).toBeNull();
    expect(readValidationError(new ChatGPTApiError(422, "HTTP 422", "not json"))).toBeNull();
  });
});

// ─── chatgptRequestText ─────────────────────────────────────

describe("chatgptRequestText", () => {
  it("returns the raw body and keeps the 401 refresh", async () => {
    let first = true;
    route("/x", () => {
      if (first) {
        first = false;
        return new Response("", { status: 401 });
      }
      return new Response('{"a":1}\n{"b":2}\n', { status: 200 });
    });
    expect(await chatgptRequestText("/x", { method: "POST", body: "{}" })).toBe(
      '{"a":1}\n{"b":2}\n',
    );
    expect(calls.filter((c) => c.url === "/api/auth/session")).toHaveLength(2);
  });
});

// ─── createProject ──────────────────────────────────────────

describe("createProject", () => {
  const config = { name: "Research", instructions: "Be brief." };

  it("sends exactly the create body and returns the new project ID", async () => {
    route("/backend-api/projects", () => json(createdBody(config.instructions)));

    const result = await createProject(config);
    expect(result).toEqual({ success: true, gizmoId: GIZMO_ID });

    const [call] = apiCalls();
    expect(call?.method).toBe("POST");
    expect(call?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call?.body).toBe(
      '{"emoji":null,"instructions":"Be brief.","memory_scope":"unset","name":"Research","theme":null}',
    );
  });

  it("returns a readable sentence on 422, without maybeCreated", async () => {
    route("/backend-api/projects", () =>
      json(
        {
          detail: [
            {
              type: "string_too_long",
              loc: ["body", "instructions"],
              msg: "String should have at most 8000 characters",
              ctx: { max_length: 8000 },
            },
          ],
        },
        422,
      ),
    );

    const result = await createProject(config);
    expect(result).toEqual({
      success: false,
      error: "ChatGPT allows at most 8000 characters in project instructions",
    });
  });

  it("returns maybeCreated on a 500", async () => {
    route("/backend-api/projects", () => json({ detail: "boom" }, 500));
    const result = await createProject(config);
    expect(result.success).toBe(false);
    expect(result.maybeCreated).toBe(true);
    expect(result.error).not.toContain("boom");
  });

  it("returns maybeCreated when fetch throws", async () => {
    route("/backend-api/projects", () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await createProject(config);
    expect(result.success).toBe(false);
    expect(result.maybeCreated).toBe(true);
  });

  it("reports an echoed-instructions mismatch with the project ID set", async () => {
    route("/backend-api/projects", () => json(createdBody("Be brief")));
    const result = await createProject(config);
    expect(result.success).toBe(false);
    expect(result.gizmoId).toBe(GIZMO_ID);
    expect(result.instructionsMismatch).toBe(true);
  });

  it("returns maybeCreated when the reply has no valid project ID", async () => {
    route("/backend-api/projects", () => json(createdBody(config.instructions, "g-abc")));
    const result = await createProject(config);
    expect(result).toMatchObject({ success: false, maybeCreated: true });
  });

  it("refuses an over-limit name or instructions before any request", async () => {
    const longName = await createProject({ name: "a".repeat(51), instructions: "" });
    const longText = await createProject({ name: "ok", instructions: "a".repeat(8001) });
    expect(longName.success).toBe(false);
    expect(longName.error).toContain("50");
    expect(longText.success).toBe(false);
    expect(longText.error).toContain("8000");
    expect(calls).toHaveLength(0);
  });

  it("accepts 8000 code points with one emoji (JS length 8001)", async () => {
    const instructions = "a".repeat(7999) + "😀";
    route("/backend-api/projects", () => json(createdBody(instructions)));
    expect(await createProject({ name: "x", instructions })).toEqual({
      success: true,
      gizmoId: GIZMO_ID,
    });
  });
});

// ─── uploadProjectFile ──────────────────────────────────────

describe("uploadProjectFile", () => {
  const content = "# Notes\nhello";
  const request = {
    gizmoId: GIZMO_ID,
    fileName: "notes.md",
    mimeType: "text/markdown",
    base64: textToBase64(content),
  };
  const size = new TextEncoder().encode(content).byteLength;

  function routeAll(overrides: { process?: string; attach?: unknown } = {}): void {
    route("/backend-api/files", () => json(RESERVED));
    route(UPLOAD_URL, () => new Response(null, { status: 201 }));
    route(
      "/backend-api/files/process_upload_stream",
      () =>
        new Response(overrides.process ?? PROCESS_STREAM, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
    route(`/backend-api/projects/${GIZMO_ID}/files`, () => json(overrides.attach ?? ATTACHED));
  }

  it("makes the four calls in order with the contract's bodies", async () => {
    routeAll();
    const result = await uploadProjectFile(request);
    expect(result).toEqual({ success: true, fileId: FILE_ID });

    const api = apiCalls();
    expect(api.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /backend-api/files",
      `PUT ${UPLOAD_URL}`,
      "POST /backend-api/files/process_upload_stream",
      `POST /backend-api/projects/${GIZMO_ID}/files`,
    ]);

    expect(bodyOf(api[0])).toEqual({
      file_name: "notes.md",
      file_size: size,
      gizmo_id: GIZMO_ID,
      mime_type: "text/markdown",
      reset_rate_limits: false,
      supports_direct_azure_multipart: true,
      timezone_offset_min: new Date().getTimezoneOffset(),
      use_case: "gizmo",
    });

    const put = api[1] as Call;
    expect(put.headers).toEqual({
      "Content-Type": "text/markdown",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-version": "2020-04-08",
      "x-ms-blob-content-type": "text/markdown",
    });
    expect(new TextDecoder().decode(put.body as Uint8Array)).toBe(content);

    expect(bodyOf(api[2])).toEqual({
      entry_surface: "project_sources",
      file_id: FILE_ID,
      file_name: "notes.md",
      gizmo_id: GIZMO_ID,
      index_for_retrieval: true,
      mime_type: "text/markdown",
      use_case: "gizmo",
    });

    const attach = bodyOf(api[3]) as { files: Array<Record<string, unknown>> };
    expect(attach.files).toHaveLength(1);
    expect(attach.files[0]).toEqual({
      file_id: FILE_ID,
      last_modified: expect.any(Number),
      location: "fs",
      name: "notes.md",
      size,
      type: "text/markdown",
    });
  });

  it("never sends the bearer token or cookies with the PUT", async () => {
    routeAll();
    await uploadProjectFile(request);
    const put = apiCalls().find((c) => c.method === "PUT") as Call;
    expect(Object.keys(put.headers).map((k) => k.toLowerCase())).not.toContain(
      "authorization",
    );
    expect(JSON.stringify(put.headers)).not.toContain(TOKEN);
    expect(put.credentials).toBe("omit");
  });

  it("fails at process, and skips attach, when the stream never completes", async () => {
    routeAll({
      process: PROCESS_STREAM.split("\n").slice(0, 3).join("\n"),
    });
    const result = await uploadProjectFile(request);
    expect(result).toMatchObject({ success: false, step: "process", fileId: FILE_ID });
    expect(apiCalls().some((c) => c.url.endsWith(`/projects/${GIZMO_ID}/files`))).toBe(false);
  });

  it("fails at attach when the project's file list lacks the new file", async () => {
    routeAll({
      attach: { resource: { gizmo: { id: GIZMO_ID }, files: [{ file_id: "file_earlier" }] } },
    });
    const result = await uploadProjectFile(request);
    expect(result).toMatchObject({ success: false, step: "attach", fileId: FILE_ID });
  });

  it("fails at upload without echoing the upload URL", async () => {
    routeAll();
    route(UPLOAD_URL, () => new Response("<Error>AuthenticationFailed</Error>", { status: 403 }));
    const result = await uploadProjectFile(request);
    expect(result).toMatchObject({ success: false, step: "upload" });
    expect(result.error).not.toContain("oaiusercontent");
    expect(result.error).not.toContain("sig=");
  });

  it("fails at reserve with a readable message when the file is too large", async () => {
    routeAll();
    route("/backend-api/files", () => json({ detail: { code: "file_too_large" } }, 400));
    const result = await uploadProjectFile(request);
    expect(result).toMatchObject({ success: false, step: "reserve" });
    expect(result.error).toContain("512 MB");
    expect(apiCalls()).toHaveLength(1);
  });

  it("measures base64 in bytes without decoding, for the 512 MiB check", () => {
    // A base64 string for 512 MiB is longer than V8's maximum string
    // length, so the refusal is checked through the size math instead.
    for (const n of [0, 1, 2, 3, 4, 5, 1000]) {
      const base64 = textToBase64("x".repeat(n));
      expect(base64ByteLength(base64)).toBe(n);
    }
    expect(CHATGPT_FILE_MAX_BYTES).toBe(536_870_912);
  });

  it("refuses an ID that isn't a project", async () => {
    const result = await uploadProjectFile({ ...request, gizmoId: "g-abcdefghi" });
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ─── readProcessEvents ──────────────────────────────────────

describe("readProcessEvents", () => {
  it("reads event names from newline-delimited JSON", () => {
    expect(readProcessEvents(PROCESS_STREAM)).toEqual([
      "file.processing.started",
      "file.processing.file_ready",
      "file.indexing.completed",
      "file.processing.completed",
    ]);
  });

  it("tolerates data: prefixes, blank lines and junk", () => {
    const text = 'data: {"type":"file.processing.completed"}\n\nnot json\n';
    expect(readProcessEvents(text)).toEqual(["file.processing.completed"]);
  });
});

// ─── findProjectsNamed and handlers ─────────────────────────

describe("findProjectsNamed", () => {
  function sidebar(items: Array<{ id: string; name: string }>): unknown {
    return {
      items: items.map(({ id, name }) => ({ gizmo: { id, display: { name } } })),
      cursor: null,
    };
  }

  it("matches names case- and space-insensitively", async () => {
    route(
      (c) => c.url.startsWith("/backend-api/gizmos/snorlax/sidebar"),
      () =>
        json(
          sidebar([
            { id: GIZMO_ID, name: "My  Research" },
            { id: OTHER_GIZMO_ID, name: "Other" },
          ]),
        ),
    );
    expect(await findProjectsNamed("my research")).toEqual([GIZMO_ID]);
  });

  it("returns null when listing fails", async () => {
    route(
      (c) => c.url.startsWith("/backend-api/gizmos/snorlax/sidebar"),
      () => json({}, 500),
    );
    expect(await findProjectsNamed("x")).toBeNull();
  });

  it("registers the three message handlers", async () => {
    expect([...handlers.keys()].sort()).toEqual([
      "CHATGPT_CREATE_PROJECT",
      "CHATGPT_FIND_PROJECTS",
      "CHATGPT_UPLOAD_PROJECT_FILE",
    ]);

    route(
      (c) => c.url.startsWith("/backend-api/gizmos/snorlax/sidebar"),
      () => json({}, 500),
    );
    const find = handlers.get("CHATGPT_FIND_PROJECTS") as (p: unknown) => Promise<unknown>;
    expect(await find({ name: "x" })).toEqual({
      success: false,
      error: "Couldn't list your ChatGPT projects",
    });
  });
});
