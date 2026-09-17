import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Workspace } from "@/core/schema/types";

// ─── Mocks ──────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  sent: [] as Array<{ name: string; payload: unknown }>,
  respond: (_name: string, _payload: unknown): unknown => undefined,
  files: new Map<string, { blob: string; mimeType: string; originalName: string }>(),
  tabUrl: "https://claude.ai/projects",
}));

vi.mock("@/shared/messaging", () => {
  const send = vi.fn(async (_tabId: number, name: string, payload?: unknown) => {
    h.sent.push({ name, payload });
    const result = h.respond(name, payload);
    if (result instanceof Error) throw result;
    return result;
  });
  return { safeSendTabMessage: send, sendTabMessage: send };
});

vi.mock("@/core/storage/indexed-db", () => ({
  loadFile: vi.fn(async (id: string) => h.files.get(id)),
}));

const listeners = new Set<(tabId: number, info: { status?: string }) => void>();
vi.stubGlobal("chrome", {
  tabs: {
    get: vi.fn(async (id: number) => ({ id, url: h.tabUrl })),
    update: vi.fn(async (id: number) => {
      setTimeout(() => {
        for (const l of [...listeners]) l(id, { status: "complete" });
      }, 0);
      return { id, windowId: 1 };
    }),
    onUpdated: {
      addListener: vi.fn((l: (tabId: number, info: { status?: string }) => void) => listeners.add(l)),
      removeListener: vi.fn((l: (tabId: number, info: { status?: string }) => void) => listeners.delete(l)),
    },
  },
  windows: { update: vi.fn(async () => ({})) },
});

import {
  autofillWorkspace,
  CLAUDE_PROJECT_FILE_LIMIT_BYTES,
  type AutofillStepResult,
} from "@/core/adapters/claude-autofill";
import { textToBase64 } from "@/shared/encoding";

// ─── Fixtures ───────────────────────────────────────────────

const NEW = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w",
    sourceId: "w",
    name: "Trips",
    description: "Plans trips",
    instructions: { raw: "Plan trips." },
    knowledgeFiles: [],
    category: "personal",
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 0.9, warnings: [], manualStepsRequired: [] },
    ...overrides,
  };
}

interface ClaudeState {
  projects: Array<{ name: string; uuid: string; createdAt: string }>;
  create: (name: string) => unknown;
}

function claude(state: Partial<ClaudeState> = {}) {
  const projects = state.projects ?? [];
  const create =
    state.create ??
    ((name: string) => {
      projects.push({ name, uuid: NEW, createdAt: new Date().toISOString() });
      return { success: true, uuid: NEW };
    });
  return (name: string, payload: unknown): unknown => {
    const p = payload as Record<string, unknown> | undefined;
    switch (name) {
      case "PING":
        return { pong: true };
      case "CLAUDE_FIND_PROJECTS": {
        const wanted = (p!.names as string[]).map((n) => n.toLowerCase());
        const matches = projects.filter((x) => wanted.includes(x.name.toLowerCase()));
        return { found: matches.map((m) => m.name), notFound: [], matches: [...matches].reverse() };
      }
      case "CLAUDE_CREATE_PROJECT":
        return create(p!.name as string);
      case "CLAUDE_VERIFY_PROJECT":
        return { success: true, name: "Trips", hasInstructions: true, instructionsLength: 11, filesCount: 1 };
      default:
        return { success: true };
    }
  };
}

type Answer = (step: AutofillStepResult) => boolean | undefined;

async function drive(gen: AsyncGenerator<AutofillStepResult, void, boolean | undefined>, answer: Answer = () => true) {
  const steps: AutofillStepResult[] = [];
  let input: boolean | undefined;
  for (;;) {
    const { value, done } = await gen.next(input);
    if (done || !value) break;
    steps.push(value);
    input = value.status === "pending" || value.status === "navigate_failed" ? answer(value) : undefined;
  }
  return steps;
}

const names = () => h.sent.map((m) => m.name).filter((n) => n !== "PING");

beforeEach(() => {
  h.sent.length = 0;
  h.files.clear();
  h.tabUrl = "https://claude.ai/projects";
  h.respond = claude();
  listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────

describe("autofillWorkspace", () => {
  it("creates the project, sets instructions, adds memory and files, then checks it", async () => {
    h.files.set("f1", { blob: textToBase64("# notes"), mimeType: "text/markdown", originalName: "notes.md" });
    const steps = await drive(
      autofillWorkspace(
        ws({
          knowledgeFiles: [
            { id: "k1", originalName: "notes.md", mimeType: "text/markdown", sizeBytes: 7, source: "exported", contentRef: "f1", compatible: true },
          ],
          projectMemory: { source: "manual", capturedAt: "x", entries: [{ id: "1", title: "Goals", content: "Ship" }] },
        }),
        7,
        { sourceLabel: "ChatGPT" },
      ),
    );
    expect(names()).toEqual([
      "CLAUDE_FIND_PROJECTS",
      "CLAUDE_CREATE_PROJECT",
      "CLAUDE_SET_INSTRUCTIONS",
      "CLAUDE_CREATE_DOC",
      "CLAUDE_UPLOAD_FILE",
      "CLAUDE_VERIFY_PROJECT",
    ]);
    const final = new Map(steps.map((s) => [s.id, s]));
    expect(final.get("w-create-api")?.projectCreated).toBe(true);
    expect(final.get("w-instructions-api")?.instructionsDelivery).toBe("autofilled");
    expect(final.get("w-memory-doc")?.projectMemoryAdded).toBe(true);
    expect(final.get("w-upload-files")?.filesDelivered).toBe(1);
    expect(final.get("w-verify")?.verified).toBe(true);
    expect(steps.some((s) => s.status === "pending")).toBe(false);
  });

  it("asks before creating a second project with the same name", async () => {
    h.respond = claude({ projects: [{ name: "trips", uuid: OLD, createdAt: "2026-01-01T00:00:00Z" }] });
    const questions: string[] = [];
    const steps = await drive(autofillWorkspace(ws(), 7), (step) => {
      questions.push(step.title);
      return false;
    });
    expect(questions).toEqual(['A project named "Trips" is already in Claude. Create another one?']);
    expect(names()).toEqual(["CLAUDE_FIND_PROJECTS"]);
    expect(steps[steps.length - 1]).toMatchObject({ id: "w-create-api", status: "skipped" });
  });

  it("creates another one when the user says so", async () => {
    h.respond = claude({ projects: [{ name: "Trips", uuid: OLD, createdAt: "2026-01-01T00:00:00Z" }] });
    await drive(autofillWorkspace(ws(), 7), () => true);
    expect(names()).toContain("CLAUDE_CREATE_PROJECT");
    const put = h.sent.find((m) => m.name === "CLAUDE_SET_INSTRUCTIONS");
    expect((put?.payload as { projectUuid: string }).projectUuid).toBe(NEW);
  });

  it("continues with the project when a timed-out request created it anyway", async () => {
    const projects: ClaudeState["projects"] = [];
    h.respond = claude({
      projects,
      create: (name) => {
        projects.push({ name, uuid: NEW, createdAt: new Date().toISOString() });
        return new Error("[CLAUDE_CREATE_PROJECT] Timed out after 90000ms");
      },
    });
    const steps = await drive(autofillWorkspace(ws(), 7), () => {
      throw new Error("should not ask");
    });
    expect(names().filter((n) => n === "CLAUDE_CREATE_PROJECT")).toHaveLength(1);
    const put = h.sent.find((m) => m.name === "CLAUDE_SET_INSTRUCTIONS");
    expect((put?.payload as { projectUuid: string }).projectUuid).toBe(NEW);
    expect(steps.find((s) => s.id === "w-create-api" && s.projectCreated)).toBeDefined();
  });

  it("hands over a manual card when nothing was created", async () => {
    h.respond = claude({ create: () => ({ success: false, error: "HTTP 403" }) });
    const cards: AutofillStepResult[] = [];
    const steps = await drive(autofillWorkspace(ws(), 7), (step) => {
      cards.push(step);
      return true;
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.confirmLabel).toBe("It's in Claude now");
    expect(cards[0]?.fallback?.description).toContain("Check your Claude projects first");
    expect(steps[steps.length - 1]).toMatchObject({
      status: "success",
      projectCreated: true,
      instructionsDelivery: "manual",
      followUp: "Created by hand: check that it has the instructions",
    });
    expect(names()).not.toContain("CLAUDE_SET_INSTRUCTIONS");
  });

  it("never takes over a same-named project when the first lookup failed", async () => {
    // Another workspace with the same name was created a minute ago
    const projects = [{ name: "Trips", uuid: OLD, createdAt: new Date(Date.now() - 60_000).toISOString() }];
    const base = claude({ projects, create: () => ({ success: false, error: "HTTP 429" }) });
    let lookups = 0;
    h.respond = (name, payload) => {
      if (name === "CLAUDE_FIND_PROJECTS" && lookups++ === 0) {
        return { found: [], notFound: ["Trips"], error: "HTTP 429" };
      }
      return base(name, payload);
    };
    const cards: AutofillStepResult[] = [];
    await drive(autofillWorkspace(ws(), 7), (step) => {
      cards.push(step);
      return false;
    });
    expect(cards.map((c) => c.confirmLabel)).toEqual(["It's in Claude now"]);
    expect(names()).not.toContain("CLAUDE_SET_INSTRUCTIONS");
    expect(names()).not.toContain("CLAUDE_UPLOAD_FILE");
  });

  it("does not guess when two new projects appear", async () => {
    const projects: ClaudeState["projects"] = [];
    h.respond = claude({
      projects,
      create: (name) => {
        projects.push({ name, uuid: NEW, createdAt: "2026-09-16T00:00:01Z" });
        projects.push({ name, uuid: OLD, createdAt: "2026-09-16T00:00:02Z" });
        return new Error("Timed out");
      },
    });
    const cards: AutofillStepResult[] = [];
    await drive(autofillWorkspace(ws(), 7), (step) => {
      cards.push(step);
      return false;
    });
    expect(cards).toHaveLength(1);
    expect(names()).not.toContain("CLAUDE_SET_INSTRUCTIONS");
  });

  it("offers files Claude can't take as downloads, without the uploaded ones", async () => {
    h.files.set("f1", { blob: textToBase64("a,b"), mimeType: "text/csv", originalName: "data.csv" });
    const cards: AutofillStepResult[] = [];
    await drive(
      autofillWorkspace(
        ws({
          knowledgeFiles: [
            { id: "k1", originalName: "data.csv", mimeType: "text/csv", sizeBytes: 3, source: "exported", contentRef: "f1", compatible: true },
            { id: "k2", originalName: "photo.png", mimeType: "image/png", sizeBytes: 4, source: "exported", contentRef: "f2", compatible: false, conversionNeeded: "Not a project file" },
            { id: "k3", originalName: "big.pdf", mimeType: "application/pdf", sizeBytes: CLAUDE_PROJECT_FILE_LIMIT_BYTES + 1, source: "exported", contentRef: "f3", compatible: true },
            { id: "k4", originalName: "lost.docx", mimeType: "application/octet-stream", sizeBytes: 0, source: "referenced", compatible: false },
          ],
        }),
        7,
      ),
      (step) => {
        cards.push(step);
        return true;
      },
    );
    expect(h.sent.filter((m) => m.name === "CLAUDE_UPLOAD_FILE")).toHaveLength(1);
    const card = cards.find((c) => c.id === "w-files")!;
    expect(card.fallback?.downloads?.map((d) => d.fileName)).toEqual(["photo.png", "big.pdf"]);
    expect(card.fallback?.fileNames).toEqual(["lost.docx"]);
    expect(card.fallback?.description).toContain("30 MB");
    expect(card.fallback?.description).not.toContain("data.csv");
  });

  it("offers Retry only while another attempt is left", async () => {
    vi.useFakeTimers();
    h.respond = (name) => (name === "PING" ? new Error("no listener") : { success: true });
    const gen = autofillWorkspace(ws(), 7);
    const steps: AutofillStepResult[] = [];
    let input: boolean | undefined;
    for (;;) {
      const next = gen.next(input);
      await vi.advanceTimersByTimeAsync(10_000);
      const { value, done } = await next;
      if (done || !value) break;
      steps.push(value);
      input = value.status === "navigate_failed" ? true : undefined;
    }
    expect(steps.filter((s) => s.status === "navigate_failed")).toHaveLength(2);
    expect(steps[steps.length - 1]).toMatchObject({ id: "w-navigate", status: "failed" });
    expect(names()).toEqual([]);
  });
});
