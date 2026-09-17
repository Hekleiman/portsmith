import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────

const { handlers, stored, progress } = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => unknown>(),
  stored: [] as Array<{ fileId: string; blob: string; fileName: string }>,
  progress: [] as string[],
}));

vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (payload: unknown) => unknown) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
  sendMessage: vi.fn(async (name: string, payload: Record<string, unknown>) => {
    if (name === "STORE_DOWNLOADED_FILE") {
      stored.push(payload as (typeof stored)[number]);
      return { success: true, contentRef: `file-${payload.fileId as string}` };
    }
    if (name === "EXTRACT_PROGRESS") {
      progress.push(payload.step as string);
    }
    return undefined;
  }),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STARTER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ARCHIVED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

vi.stubGlobal("document", { cookie: `foo=1; lastActiveOrg=${ORG}; bar=2` });

import { extractProjects, toMemoryEntry } from "@/content-scripts/claude/extractor";
import { getOrgId } from "@/content-scripts/claude/api";

// ─── Fake Claude API ────────────────────────────────────────

interface Route {
  status?: number;
  body: unknown;
}

let routes: (url: string, init?: RequestInit) => Route | undefined;
const calls: Array<{ url: string; method: string; body?: string }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listItem(uuid: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  // The list endpoint no longer includes prompt_template (verified Sep 2026)
  return {
    uuid,
    name,
    description: "",
    created_at: "2026-01-01T00:00:00.000000Z",
    updated_at: "2026-09-01T00:00:00.000000Z",
    is_starter_project: false,
    archived_at: null,
    docs_count: null,
    files_count: null,
    ...extra,
  };
}

function defaultRoutes(url: string, init?: RequestInit): Route | undefined {
  const method = init?.method ?? "GET";
  if (url.startsWith(`/api/organizations/${ORG}/projects?`)) {
    const offset = Number(new URL(url, "https://claude.ai").searchParams.get("offset"));
    if (offset > 0) return { body: [] };
    return {
      body: [
        listItem(P1, "Trip planner", { description: "Plans trips" }),
        listItem(P2, "Code helper"),
        listItem(STARTER, "How to use Claude", { is_starter_project: true }),
        listItem(ARCHIVED, "Old", { archived_at: "2026-02-01T00:00:00Z" }),
      ],
    };
  }
  if (url === `/api/organizations/${ORG}/projects/${P1}`) {
    return { body: { ...listItem(P1, "Trip planner", { description: "Plans trips" }), prompt_template: "Plan great trips.", docs_count: 1, files_count: 1 } };
  }
  if (url === `/api/organizations/${ORG}/projects/${P2}`) {
    return { body: { ...listItem(P2, "Code helper"), prompt_template: "Write clean code.", docs_count: 0, files_count: 0 } };
  }
  if (url === `/api/organizations/${ORG}/projects/${P1}/docs`) {
    return { body: [{ uuid: "doc-1", file_name: "itinerary.md", content: "# Day 1\nRome" }] };
  }
  if (url === `/api/organizations/${ORG}/projects/${P1}/files`) {
    return { body: [{ file_uuid: "file-1", file_name: "map.png", file_kind: "image" }] };
  }
  if (url === `/api/organizations/${ORG}/memory/settings`) {
    return { body: { memory_mode: "melange", melange_available: true } };
  }
  if (url === `/api/organizations/${ORG}/melange/list` && method === "POST") {
    return {
      body: {
        data: [
          { path: "/profile.md" },
          { path: `/projects/${P1}/decisions.md` },
          { path: `/projects/${P1}/notes/budget.md` },
          { path: `/projects/${STARTER}/x.md` },
        ],
      },
    };
  }
  if (url === `/api/organizations/${ORG}/melange/read` && method === "POST") {
    const path = JSON.parse(String(init?.body)).path as string;
    if (path.endsWith("decisions.md")) {
      return {
        body: {
          path,
          updated_at: "2026-09-10T00:00:00Z",
          content: "---\nname: Decisions\n---\nWe fly to Rome.",
          parsed: { name: "Decisions", description: "Trip decisions", body: "We fly to Rome." },
        },
      };
    }
    return {
      body: {
        path,
        display_name: "Budget",
        content: "---\nname: x\n---\nKeep it under $3k.",
      },
    };
  }
  return undefined;
}

beforeEach(() => {
  stored.length = 0;
  progress.length = 0;
  calls.length = 0;
  routes = defaultRoutes;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const route = routes(url, init);
      if (!route) return json({ error: "not found" }, 404);
      return json(route.body, route.status ?? 200);
    }),
  );
});

// ─── Tests ──────────────────────────────────────────────────

describe("getOrgId", () => {
  it("reads a UUID from the lastActiveOrg cookie", () => {
    expect(getOrgId()).toBe(ORG);
  });

  it("rejects values that are not UUIDs", () => {
    expect(getOrgId("lastActiveOrg=../../evil")).toBeNull();
    expect(getOrgId("other=1")).toBeNull();
  });
});

describe("extractProjects (Claude)", () => {
  it("reads instructions from each project's detail endpoint", async () => {
    const result = await extractProjects({ includeMemory: false, includeKnowledge: false });
    expect(result.success).toBe(true);
    const byName = Object.fromEntries(result.projects.map((p) => [p.name, p]));
    expect(byName["Trip planner"]?.instructions).toBe("Plan great trips.");
    expect(byName["Code helper"]?.instructions).toBe("Write clean code.");
    expect(byName["Trip planner"]?.description).toBe("Plans trips");
  });

  it("skips Claude's example project and archived projects, with warnings", async () => {
    const result = await extractProjects({ includeMemory: false, includeKnowledge: false });
    expect(result.projects.map((p) => p.id).sort()).toEqual([P1, P2].sort());
    const messages = result.warnings.map((w) => w.message).join(" | ");
    expect(messages).toContain("example project");
    expect(messages).toContain("archived");
  });

  it("pages through the project list", async () => {
    await extractProjects({ includeMemory: false, includeKnowledge: false });
    const listCalls = calls.filter((c) => c.url.includes("/projects?"));
    expect(listCalls[0]?.url).toContain("limit=100&offset=0");
    // the first page is short, so no second request is needed
    expect(listCalls).toHaveLength(1);
  });

  it("copies knowledge docs and lists binary files", async () => {
    const result = await extractProjects({ includeMemory: false, includeKnowledge: true });
    const trip = result.projects.find((p) => p.id === P1)!;
    expect(trip.docs).toEqual([
      expect.objectContaining({ uuid: "doc-1", fileName: "itinerary.md", contentRef: "file-claude-doc-doc-1" }),
    ]);
    expect(trip.files).toEqual([{ uuid: "file-1", fileName: "map.png", kind: "image" }]);
    expect(stored).toHaveLength(1);
    expect(atob(stored[0]!.blob)).toBe("# Day 1\nRome");
    // no docs/files requests for a project whose counts are zero
    expect(calls.some((c) => c.url.endsWith(`${P2}/docs`))).toBe(false);
  });

  it("attaches project memory notes to the right project only", async () => {
    const result = await extractProjects({ includeMemory: true, includeKnowledge: false });
    const trip = result.projects.find((p) => p.id === P1)!;
    const code = result.projects.find((p) => p.id === P2)!;
    expect(trip.memorySource).toBe("entries");
    expect(trip.memory).toEqual([
      expect.objectContaining({ title: "Decisions", summary: "Trip decisions", body: "We fly to Rome." }),
      expect.objectContaining({ title: "Budget", body: "Keep it under $3k." }),
    ]);
    expect(code.memory).toBeUndefined();
    // memory of skipped projects is never read
    const reads = calls.filter((c) => c.url.endsWith("/melange/read")).map((c) => c.body);
    expect(reads.join()).not.toContain(STARTER);
  });

  it("falls back to the older per-project memory summary", async () => {
    routes = (url, init) => {
      if (url.endsWith("/memory/settings")) return { body: { memory_mode: "saffron" } };
      if (url === `/api/organizations/${ORG}/memory?project_uuid=${P2}`) {
        return { body: { memory: "Prefers TypeScript.", updated_at: "2026-08-01T00:00:00Z" } };
      }
      if (url.includes("/memory?project_uuid=")) return { body: { memory: "" } };
      return defaultRoutes(url, init);
    };
    const result = await extractProjects({ includeMemory: true, includeKnowledge: false });
    const code = result.projects.find((p) => p.id === P2)!;
    expect(code.memorySource).toBe("summary");
    expect(code.memory?.[0]?.body).toBe("Prefers TypeScript.");
    expect(result.projects.find((p) => p.id === P1)!.memory).toBeUndefined();
  });

  it("keeps going with a warning when memory settings can't be read", async () => {
    routes = (url, init) =>
      url.endsWith("/memory/settings") ? { status: 403, body: {} } : defaultRoutes(url, init);
    const result = await extractProjects({ includeMemory: true, includeKnowledge: false });
    expect(result.success).toBe(true);
    expect(result.projects).toHaveLength(2);
    expect(result.warnings.some((w) => w.context === "memory")).toBe(true);
  });

  it("reports an expired session", async () => {
    routes = (url) => (url.includes("/projects?") ? { status: 401, body: {} } : undefined);
    const result = await extractProjects();
    expect(result.success).toBe(false);
    expect(result.warnings[0]?.context).toBe("auth");
  });

  it("keeps a project (with a warning) when its details fail", async () => {
    routes = (url, init) =>
      url === `/api/organizations/${ORG}/projects/${P2}` ? { status: 500, body: {} } : defaultRoutes(url, init);
    const result = await extractProjects({ includeMemory: false, includeKnowledge: false });
    expect(result.projects.find((p) => p.id === P2)?.instructions).toBe("");
    expect(result.warnings.some((w) => w.message.includes("Code helper"))).toBe(true);
  });

  it("reports progress to the side panel", async () => {
    await extractProjects();
    expect(progress[0]).toBe("Listing your projects");
    expect(progress[progress.length - 1]).toBe("Done");
  });

  it("registers the extraction handler with default options", async () => {
    const handler = handlers.get("CLAUDE_EXTRACT_PROJECTS")!;
    const result = (await handler(undefined)) as Awaited<ReturnType<typeof extractProjects>>;
    expect(result.projects).toHaveLength(2);
  });
});

describe("toMemoryEntry", () => {
  it("uses the file name when there is no parsed title", () => {
    const entry = toMemoryEntry("/projects/x/open_questions.md", { content: "Body" });
    expect(entry).toEqual(expect.objectContaining({ title: "Open questions", body: "Body" }));
  });

  it("drops empty notes", () => {
    expect(toMemoryEntry("/projects/x/a.md", { content: "---\nname: a\n---\n" })).toBeNull();
  });
});
