import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatGPTGptSummary } from "@/content-scripts/chatgpt/api";

// ─── Mocks ──────────────────────────────────────────────────

const { handlers, listGptSummariesMock, listProjectSummariesMock } = vi.hoisted(
  () => {
    // Set before the extractor is imported: its init() reads
    // window.location at module scope. Everything here is empty, so these
    // tests only pass if discovery never reads the DOM.
    vi.stubGlobal("document", {
      cookie: "",
      querySelector: () => null,
      querySelectorAll: () => [],
      evaluate: () => ({ snapshotLength: 0, snapshotItem: () => null }),
      body: { innerText: "" },
    });
    vi.stubGlobal("window", {
      location: { href: "https://chatgpt.com/", pathname: "/" },
    });
    vi.stubGlobal("navigator", { language: "en-US" });

    return {
      handlers: new Map<string, (payload: unknown) => unknown>(),
      listGptSummariesMock: vi.fn(),
      listProjectSummariesMock: vi.fn(async () => []),
    };
  },
);

vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (payload: unknown) => unknown) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock("@/content-scripts/chatgpt/api", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
  listProjectSummaries: listProjectSummariesMock,
  listGptSummaries: listGptSummariesMock,
}));

import {
  extractCustomGPTs,
  scanSidebar,
} from "@/content-scripts/chatgpt/extractor";

const GPT_A = "g-abc123XYZ";
const GPT_B = "g-def456UVW";

function gpt(over: Partial<ChatGPTGptSummary> = {}): ChatGPTGptSummary {
  return {
    gizmoId: GPT_A,
    name: "Resume Wizard",
    description: "Polishes resumes",
    instructions: "You are a resume expert.",
    conversationStarters: ["Review my resume"],
    knowledgeFileNames: ["style-guide.pdf"],
    ...over,
  };
}

beforeEach(() => {
  listGptSummariesMock.mockReset();
  listProjectSummariesMock.mockReset();
  listProjectSummariesMock.mockResolvedValue([]);
});

// ─── extractCustomGPTs ──────────────────────────────────────

describe("extractCustomGPTs", () => {
  it("returns full configs from the API, with an empty DOM", async () => {
    listGptSummariesMock.mockResolvedValue([gpt()]);

    const result = await extractCustomGPTs();

    expect(result.success).toBe(true);
    expect(result.gpts).toEqual([
      {
        id: GPT_A,
        name: "Resume Wizard",
        description: "Polishes resumes",
        instructions: "You are a resume expert.",
        conversationStarters: ["Review my resume"],
        knowledgeFileNames: ["style-guide.pdf"],
      },
    ]);
    // A complete GPT should not produce a warning at all.
    expect(result.warnings).toEqual([]);
  });

  it("works off a page that is not the GPT list", async () => {
    // detectPage() reads window.location, which is "/" here.
    listGptSummariesMock.mockResolvedValue([gpt()]);
    const result = await extractCustomGPTs();
    expect(result.gpts).toHaveLength(1);
    expect(
      result.warnings.map((w) => w.message).join(" ").toLowerCase(),
    ).not.toContain("navigate");
  });

  it("collapses duplicate gizmo IDs", async () => {
    listGptSummariesMock.mockResolvedValue([gpt(), gpt(), gpt({ gizmoId: GPT_B })]);
    const result = await extractCustomGPTs();
    expect(result.gpts.map((g) => g.id)).toEqual([GPT_A, GPT_B]);
  });

  it("names the missing fields instead of sending the user to an editor", async () => {
    listGptSummariesMock.mockResolvedValue([
      gpt({ instructions: "", conversationStarters: [] }),
    ]);

    const result = await extractCustomGPTs();
    const message = result.warnings[0]?.message ?? "";

    expect(message).toContain("instructions");
    expect(message).toContain("conversation starters");
    expect(message).not.toContain("description");
    expect(message.toLowerCase()).not.toContain("editor");
    expect(message.toLowerCase()).not.toContain("navigate");
    expect(message.toLowerCase()).not.toContain("open the gpt");
  });

  it("warns with the real cause on failure, without telling the user to navigate", async () => {
    listGptSummariesMock.mockRejectedValue(new Error("HTTP 429: slow down"));

    const result = await extractCustomGPTs();

    expect(result.success).toBe(false);
    expect(result.gpts).toEqual([]);
    const message = result.warnings[0]?.message ?? "";
    expect(message).toContain("HTTP 429");
    expect(message.toLowerCase()).not.toContain("navigate");
    expect(message.toLowerCase()).not.toContain("gpts/mine");
    expect(message.toLowerCase()).not.toContain("sidebar");
  });
});

// ─── scanSidebar ────────────────────────────────────────────

describe("scanSidebar GPTs", () => {
  it("finds GPTs with no GPT links in the DOM", async () => {
    listGptSummariesMock.mockResolvedValue([gpt()]);

    const scan = await scanSidebar();

    expect(scan.gpts).toEqual([
      { id: GPT_A, name: "Resume Wizard", url: `https://chatgpt.com/g/${GPT_A}` },
    ]);
  });

  it("returns no GPTs, rather than throwing, when the listing fails", async () => {
    listGptSummariesMock.mockRejectedValue(new Error("HTTP 401"));
    expect((await scanSidebar()).gpts).toEqual([]);
  });
});

// ─── listGptSummaries parsing ───────────────────────────────
// The module is mocked above for the extractor tests, so pull in the real
// implementation here and drive it through a stubbed fetch.

const realApi =
  await vi.importActual<typeof import("@/content-scripts/chatgpt/api")>(
    "@/content-scripts/chatgpt/api",
  );

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** One `cuts[].list.items[]` entry, with the extra `resource` level. */
function item(gizmo: Record<string, unknown>, files: unknown = []): unknown {
  return { resource: { gizmo, files, tools: [] } };
}

function gizmo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GPT_A,
    gizmo_type: "gpt",
    instructions: "You are a resume expert.",
    display: {
      name: "Resume Wizard",
      description: "Polishes resumes",
      prompt_starters: ["Review my resume", "Rewrite my summary"],
    },
    ...over,
  };
}

function cut(id: string, items: unknown[], cursor: unknown = null): unknown {
  return { info: { id, title: id }, list: { items, cursor } };
}

/** Stubs fetch: the session call, then one body per /gizmos/mine call. */
function stubFetch(...bodies: unknown[]): void {
  let i = 0;
  vi.stubGlobal("fetch", (url: string) => {
    if (String(url).includes("/api/auth/session")) {
      return Promise.resolve(jsonResponse({ accessToken: "test-token" }));
    }
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return Promise.resolve(jsonResponse(body));
  });
}

describe("listGptSummaries", () => {
  beforeEach(() => {
    realApi.clearAccessToken();
  });

  it("reads the mine cut and ignores recent", async () => {
    stubFetch({
      cuts: [
        cut("recent", [item(gizmo({ id: GPT_B }))]),
        cut("mine", [item(gizmo())]),
      ],
    });

    const gpts = await realApi.listGptSummaries();

    expect(gpts.map((g) => g.gizmoId)).toEqual([GPT_A]);
    expect(gpts.map((g) => g.gizmoId)).not.toContain(GPT_B);
  });

  it("reads through the resource.gizmo nesting", async () => {
    stubFetch({ cuts: [cut("mine", [item(gizmo(), [{ name: "style-guide.pdf" }])])] });

    expect(await realApi.listGptSummaries()).toEqual([
      {
        gizmoId: GPT_A,
        name: "Resume Wizard",
        description: "Polishes resumes",
        instructions: "You are a resume expert.",
        conversationStarters: ["Review my resume", "Rewrite my summary"],
        knowledgeFileNames: ["style-guide.pdf"],
      },
    ]);
  });

  it("returns nothing when items are flat, without the resource level", async () => {
    stubFetch({ cuts: [cut("mine", [{ gizmo: gizmo() }])] });
    expect(await realApi.listGptSummaries()).toEqual([]);
  });

  it("skips malformed entries instead of throwing", async () => {
    stubFetch({
      cuts: [
        null,
        { info: null },
        { info: { id: "recent" }, list: null },
        "not an object",
        cut("mine", [
          null,
          { resource: null },
          { resource: { gizmo: null } },
          item({ id: GPT_A }), // no display
          item({ id: "not-a-gizmo", display: { name: "x" } }),
          item(gizmo({ id: "g-p-" + "a".repeat(32) })), // a project, not a GPT
          item(gizmo()),
        ]),
      ],
    });

    const gpts = await realApi.listGptSummaries();
    expect(gpts.map((g) => g.gizmoId)).toEqual([GPT_A]);
  });

  it("leaves absent fields empty rather than guessing", async () => {
    stubFetch({
      cuts: [cut("mine", [item({ id: GPT_A, display: { name: "Bare" } })])],
    });

    expect(await realApi.listGptSummaries()).toEqual([
      {
        gizmoId: GPT_A,
        name: "Bare",
        description: "",
        instructions: "",
        conversationStarters: [],
        knowledgeFileNames: [],
      },
    ]);
  });

  it("drops non-string prompt starters", async () => {
    stubFetch({
      cuts: [
        cut("mine", [
          item(gizmo({ display: { name: "X", prompt_starters: ["a", 7, null, "b"] } })),
        ]),
      ],
    });

    const gpts = await realApi.listGptSummaries();
    expect(gpts[0]?.conversationStarters).toEqual(["a", "b"]);
  });

  it("stops when a cursor page adds nothing new", async () => {
    // /gizmos/mine ignores unknown query params, so a cursor may be a no-op
    // and the same page can come back. The dedup guard must end the loop.
    stubFetch({ cuts: [cut("mine", [item(gizmo())], "page-2")] });

    const gpts = await realApi.listGptSummaries();
    expect(gpts).toHaveLength(1);
  });

  it("returns an empty list when the mine cut has no usable list", async () => {
    stubFetch({ cuts: [{ info: { id: "mine" }, list: null }] });
    expect(await realApi.listGptSummaries()).toEqual([]);
  });

  it("returns an empty list when there is no mine cut", async () => {
    stubFetch({ cuts: [cut("recent", [item(gizmo())])] });
    expect(await realApi.listGptSummaries()).toEqual([]);
  });
});
