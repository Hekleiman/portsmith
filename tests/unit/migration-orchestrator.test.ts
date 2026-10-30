import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  CheckpointRecord,
  ManifestRecord,
  MigrationStateSnapshot,
} from "@/core/storage/indexed-db";

// ─── Mocks ──────────────────────────────────────────────────

const h = vi.hoisted(() => {
  type Step = {
    id: string;
    title: string;
    status: string;
    projectCreated?: boolean;
    instructionsDelivery?: string;
    verified?: boolean;
    followUp?: string;
    filesDelivered?: number;
    fallback?: { id: string; title: string; description: string; copyBlocks: unknown[] };
    projectMemoryAdded?: boolean;
  };
  return {
    manifests: new Map<string, unknown>(),
    checkpoints: [] as Array<{ state: MigrationStateSnapshot; workspaceIndex: number }>,
    tabMessages: [] as Array<{ tabId: number; name: string; payload: unknown }>,
    tabResponder: (_name: string, _payload: unknown): unknown => ({ success: true }),
    autofillCalls: [] as string[],
    /** Per-workspace script for the fake autofill generator. */
    autofillScript: (_wsId: string): Step[] => [],
    answers: [] as Array<boolean | undefined>,
    files: new Map<string, { blob: string; mimeType: string }>(),
    savedMemory: [] as string[],
    chatgptTabs: [{ id: 33 }] as Array<{ id: number }>,
  };
});

vi.mock("@/shared/messaging", () => {
  const send = async (tabId: number, name: string, payload: unknown): Promise<unknown> => {
    h.tabMessages.push({ tabId, name, payload });
    return h.tabResponder(name, payload);
  };
  return {
    onMessage: vi.fn(() => () => undefined),
    safeSendTabMessage: vi.fn(send),
    sendTabMessage: vi.fn(send),
  };
});

vi.mock("@/core/storage/gemini-saved-memory", () => ({
  loadSavedMemoryIds: vi.fn(async () => h.savedMemory),
  saveSavedMemoryIds: vi.fn(async (_m: string, _a: string | null, ids: string[]) => {
    h.savedMemory = [...ids];
  }),
}));

vi.mock("@/core/storage/indexed-db", () => ({
  loadFile: vi.fn(async (id: string) => h.files.get(id)),
  loadManifest: vi.fn(async (id: string) => h.manifests.get(id)),
  saveCheckpoint: vi.fn(async (state: MigrationStateSnapshot, workspaceIndex: number) => {
    h.checkpoints.push({ state: structuredClone(state), workspaceIndex });
    return `ckpt-${h.checkpoints.length}`;
  }),
  loadLatestCheckpoint: vi.fn(async (): Promise<CheckpointRecord | undefined> => {
    const last = h.checkpoints[h.checkpoints.length - 1];
    if (!last) return undefined;
    return {
      id: "ckpt",
      migrationState: last.state,
      timestamp: new Date().toISOString(),
      workspaceIndex: last.workspaceIndex,
      stepIndex: 0,
    };
  }),
  clearCheckpoints: vi.fn(async () => {
    h.checkpoints.length = 0;
  }),
}));

vi.mock("@/core/adapters/claude-autofill", () => ({
  autofillWorkspace: vi.fn(async function* (workspace: Workspace) {
    h.autofillCalls.push(workspace.id);
    for (const step of h.autofillScript(workspace.id)) {
      const answer: boolean | undefined = yield step;
      if (step.status === "pending" || step.status === "navigate_failed") h.answers.push(answer);
    }
  }),
}));

const defaultQuery = async ({ url }: { url: string }) =>
  url.includes("claude.ai")
    ? [{ id: 11 }]
    : url.includes("gemini")
      ? [{ id: 22 }]
      : url.includes("chatgpt")
        ? h.chatgptTabs
        : [];
const defaultGet = async (id: number) => ({
  id,
  url:
    id === 11
      ? "https://claude.ai/projects"
      : id === 33 || id === 77
        ? "https://chatgpt.com/"
        : "https://gemini.google.com/app",
  discarded: false,
});
const chromeMock = {
  tabs: {
    query: vi.fn(defaultQuery),
    get: vi.fn(defaultGet),
    create: vi.fn(async ({ url }: { url: string }) => ({
      id: url.includes("chatgpt") ? 77 : 99,
    })),
    onRemoved: { addListener: vi.fn() },
  },
};
vi.stubGlobal("chrome", chromeMock);

import { MigrationOrchestrator, geminiAccountPath } from "@/background/migration-orchestrator";

// ─── Fixtures ───────────────────────────────────────────────

function ws(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    sourceId: id,
    name: `Workspace ${id}`,
    description: "",
    instructions: { raw: `Instructions for ${id}` },
    knowledgeFiles: [],
    category: "other",
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

function putManifest(
  id: string,
  workspaces: Workspace[],
  extra: Partial<PortsmithManifest> = {},
): void {
  const data: PortsmithManifest = {
    version: "1.0.0",
    exportedAt: "2026-09-01T00:00:00.000Z",
    source: { platform: "chatgpt", exportMethod: "dom_extraction", exportedAt: "2026-09-01T00:00:00.000Z" },
    user: {
      expertise: [],
      communicationStyle: { formality: "casual", verbosity: "concise", preferences: [] },
      interests: [],
    },
    workspaces,
    memory: [],
    globalInstructions: "",
    metadata: { generatedBy: "test" },
    ...extra,
  };
  const record: ManifestRecord = { id, data, createdAt: "", updatedAt: "" };
  h.manifests.set(id, record);
}

async function waitFor(check: () => boolean, label = "condition"): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Gemini runs end with the optional chat history step, even without memory. */
async function finishGeminiRun(o: MigrationOrchestrator): Promise<void> {
  await waitFor(() => o.getStatus().phase === "memory", "memory");
  expect(o.getStatus().memorySteps.map((st) => st.id)).toEqual(["memory-chat-history"]);
  expect(o.markMemoryDone()).toBe(true);
  expect(o.getStatus().phase).toBe("complete");
}

const created = (id: string) => [
  { id: `${id}-navigate`, title: "Claude is ready", status: "success" },
  { id: `${id}-create-api`, title: "Project created", status: "success", projectCreated: true },
  { id: `${id}-instructions-api`, title: "Instructions set", status: "success", instructionsDelivery: "autofilled" },
  { id: `${id}-verify`, title: "Project checked", status: "success", verified: true },
];

/** Gemini tab: lists `gems`, and creates new ones unless told otherwise. */
function geminiTab(
  gems: Array<{ id: string; name: string }> = [],
  create: (name: string) => unknown = (name) => {
    const id = `gem-${gems.length + 1}`;
    gems.push({ id, name });
    return { success: true, gemId: id };
  },
) {
  return (name: string, payload: unknown): unknown => {
    if (name === "GEMINI_EXTRACT_GEMS") {
      return {
        success: true,
        gems: gems.map((g) => ({ ...g, description: "", instructions: "", predefined: false })),
        warnings: [],
      };
    }
    if (name === "GEMINI_CREATE_GEM") return create((payload as { name: string }).name);
    if (name === "GEMINI_LIST_MEMORIES") return { success: true, texts: [] };
    if (name === "GEMINI_SAVE_MEMORIES") {
      const texts = (payload as { texts: string[] }).texts;
      return { results: texts.map((text, i) => ({ text, success: true, id: `mem-${i}` })) };
    }
    if (name === "GEMINI_UPLOAD_KNOWLEDGE_FILE") {
      return { success: true, handle: `$h-${(payload as { fileName: string }).fileName}` };
    }
    return { success: true };
  };
}

beforeEach(() => {
  h.manifests.clear();
  h.checkpoints.length = 0;
  h.tabMessages.length = 0;
  h.autofillCalls.length = 0;
  h.answers.length = 0;
  h.files.clear();
  h.savedMemory = [];
  h.chatgptTabs = [{ id: 33 }];
  h.tabResponder = geminiTab();
  // Some tests swap these out; every test starts from the defaults.
  chromeMock.tabs.query.mockImplementation(defaultQuery as never);
  chromeMock.tabs.get.mockImplementation(defaultGet as never);
  h.autofillScript = created;
  vi.clearAllMocks();
});

const token = (o: MigrationOrchestrator): string => o.getStatus().pendingConfirmToken!;

// ─── Tests ──────────────────────────────────────────────────

describe("MigrationOrchestrator: starting", () => {
  it("ignores a second start while the first is starting or running", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    const o = new MigrationOrchestrator();
    const [first, second] = await Promise.all([
      o.start("m1", "autofill", ["a", "b"], "claude"),
      o.start("m1", "autofill", ["a", "b"], "claude"),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
    await waitFor(() => o.getStatus().phase === "complete", "complete");
    expect(h.autofillCalls).toEqual(["a", "b"]);
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a", "b"]);
    expect(o.getStatus().verifiedWorkspaceIds).toEqual(["a", "b"]);
  });

  it("dedupes workspace IDs", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.autofillCalls).toEqual(["a"]);
  });

  it("fails cleanly when the manifest is missing", async () => {
    const o = new MigrationOrchestrator();
    await expect(o.start("nope", "autofill", ["a"], "claude")).resolves.toBe(false);
    expect(o.getStatus().phase).toBe("idle");
  });
});

describe("MigrationOrchestrator: cancel", () => {
  it("stops a run that is waiting for the user and never continues it", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "Create?", status: "pending" },
      { id: `${id}-create-api`, title: "Project created", status: "success", projectCreated: true },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a", "b"], "claude");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create-api", "pending step");

    expect(o.cancel()).toBe(true);
    expect(o.getStatus().phase).toBe("idle");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.autofillCalls).toEqual(["a"]);
    expect(o.getStatus().completedWorkspaceIds).toEqual([]);
    expect(h.checkpoints).toHaveLength(0);

    // a fresh run can start afterwards
    h.autofillScript = created;
    await expect(o.start("m1", "autofill", ["b"], "claude")).resolves.toBe(true);
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().completedWorkspaceIds).toEqual(["b"]);
  });
});

describe("MigrationOrchestrator: resume after a restart", () => {
  it("continues from the checkpoint without redoing finished work", async () => {
    putManifest("m1", [ws("a"), ws("b"), ws("c")]);
    h.checkpoints.push({
      workspaceIndex: 1,
      state: {
        phase: "migrating",
        sourcePlatform: "chatgpt",
        targetPlatform: "claude",
        extractionMethod: null,
        deliveryMode: "autofill",
        manifestId: "m1",
        selectedWorkspaceIds: ["a", "b", "c"],
        completedWorkspaceIds: ["a"],
        errors: [],
        instructionsDelivery: { a: "autofilled" },
        verifiedWorkspaceIds: ["a"],
        createdWorkspaceIds: ["a"],
      },
    });
    const o = new MigrationOrchestrator();
    const [r1, r2] = await Promise.all([o.resume(), o.resume()]);
    expect([r1, r2].sort()).toEqual([false, true]);
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.autofillCalls).toEqual(["b", "c"]);
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a", "b", "c"]);
    expect(o.getStatus().instructionsDelivery.a).toBe("autofilled");
  });

  it("never re-creates a project that was created before the restart", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    // Run 1 stops while waiting for the user, after "a" was created
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "Project created", status: "success", projectCreated: true },
      { id: `${id}-files`, title: "Upload by hand", status: "pending" },
    ];
    const first = new MigrationOrchestrator();
    await first.start("m1", "hybrid", ["a", "b"], "claude");
    await waitFor(() => first.getStatus().pendingConfirmStepId === "a-files");
    const saved = h.checkpoints[h.checkpoints.length - 1]!;
    expect(saved.state.createdWorkspaceIds).toEqual(["a"]);
    expect(saved.workspaceIndex).toBe(0);

    // The service worker restarts: a new orchestrator resumes
    h.autofillScript = created;
    const second = new MigrationOrchestrator();
    await expect(second.resume()).resolves.toBe(true);
    await waitFor(() => second.getStatus().phase === "complete");
    expect(h.autofillCalls).toEqual(["a", "b"]); // "a" only from the first run
    const status = second.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["b"]);
    expect(status.manualWorkspaces).toEqual([
      expect.objectContaining({ id: "a", reason: expect.stringContaining("stopped before it finished") }),
    ]);
  });

  it("does not resume a finished run", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    const restarted = new MigrationOrchestrator();
    await expect(restarted.resume()).resolves.toBe(false);
  });
});

describe("MigrationOrchestrator: outcomes", () => {
  it("reports a workspace that was never created as manual, not completed", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "Couldn't create", status: "pending" },
      { id: `${id}-create-api`, title: "Not created", status: "skipped" },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "claude");
    await waitFor(() => o.getStatus().pendingConfirmStepId !== null);
    o.confirmStep(false);
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.answers).toEqual([false]);
    expect(o.getStatus().completedWorkspaceIds).toEqual([]);
    expect(o.getStatus().manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "Skipped" },
    ]);
  });

  it("never waits in automatic mode: failed steps become cards for the end", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    const card = (id: string) => ({ id, title: "Paste the project instructions", description: "Claude didn't accept them (HTTP 500).", copyBlocks: [] });
    h.autofillScript = (id) =>
      id === "a"
        ? [
            { id: "a-navigate", title: "Refresh the Claude tab", status: "navigate_failed" },
            { id: "a-create-api", title: "Project created", status: "success", projectCreated: true },
            { id: "a-instructions-api", title: "Add the instructions by hand", status: "pending", fallback: card("a-instructions-api") },
            { id: "a-instructions-api", title: "Instructions skipped", status: "skipped" },
          ]
        : [
            {
              id: "b-create-api",
              title: "Couldn't create the project automatically",
              status: "pending",
              fallback: { id: "b-manual-create", title: "Create", description: "Claude didn't confirm the new project (HTTP 429). Check first.\n1. Open", copyBlocks: [] },
            },
            { id: "b-create-api", title: "Not created", status: "skipped" },
          ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.answers).toEqual([true, false, false]);
    const status = o.getStatus();
    expect(status.pendingConfirmStepId).toBeNull();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.followUps.a).toEqual(["Instructions skipped"]);
    expect(status.leftoverSteps.a?.map((c) => c.id)).toEqual(["a-instructions-api"]);
    expect(status.leftoverSteps.b).toBeUndefined();
    expect(status.manualWorkspaces).toEqual([
      { id: "b", name: "Workspace b", reason: "Claude didn't confirm the new project (HTTP 429). Check first." },
    ]);
    expect(h.checkpoints[h.checkpoints.length - 1]!.state.leftoverSteps?.a).toHaveLength(1);
  });

  it("skips a taken Claude project name without asking in automatic mode", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "A project named this is already in Claude. Create another one?", status: "pending" },
      { id: `${id}-create-api`, title: "Skipped: a project with this name is already in Claude", status: "skipped" },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.answers).toEqual([false]);
    expect(o.getStatus().manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "A project with this name is already in Claude" },
    ]);
  });

  it("reports a failed last step as a failure", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      { id: `${id}-navigate`, title: "Claude isn't reachable", status: "failed" },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().failedWorkspaces).toEqual([
      { id: "a", name: "Workspace a", error: "Claude isn't reachable" },
    ]);
  });

  it("moves to the memory step when there is memory to import", async () => {
    putManifest("m1", [ws("a")], {
      memory: [
        {
          id: "m",
          fact: "Lives in Lisbon",
          category: "identity",
          confidence: 1,
          source: "explicit",
          workspaceIds: [],
          migration: { fitsConstraints: true, priority: 9 },
        },
      ],
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "memory");
    expect(o.getStatus().memorySteps.length).toBeGreaterThan(0);
    expect(o.markMemoryDone()).toBe(true);
    expect(o.getStatus().phase).toBe("complete");
  });
});

describe("MigrationOrchestrator: ChatGPT guided", () => {
  it("uses the guided ChatGPT flow in guided mode", async () => {
    putManifest("m1", [ws("a")], {
      source: { platform: "claude", exportMethod: "api", exportedAt: "2026-09-01T00:00:00.000Z" },
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "guided", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().guidedInstructions !== null);
    const status = o.getStatus();
    expect(status.mode).toBe("guided");
    expect(status.targetPlatform).toBe("chatgpt");
    const text = JSON.stringify(status.guidedInstructions);
    expect(text).toContain('click the + next to \\"Projects\\"');
    expect(text).not.toMatch(/claude\.ai/);
    expect(h.tabMessages).toEqual([]);

    expect(o.markWorkspaceDone("a")).toBe(true);
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().instructionsDelivery.a).toBe("manual");
  });
});

describe("MigrationOrchestrator: Gemini target", () => {
  it("sends the instructions edited for Gemini", async () => {
    putManifest("m1", [
      ws("a", {
        instructions: {
          raw: "Original",
          translated: { claude: "Claude version", gemini: "Gemini version" },
        },
      }),
    ]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const create = h.tabMessages.find((m) => m.name === "GEMINI_CREATE_GEM");
    expect(create?.payload).toEqual(expect.objectContaining({ instructions: "Gemini version" }));
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a"]);
    expect(o.getStatus().instructionsDelivery.a).toBe("autofilled");
    expect(h.checkpoints.some((c) => c.state.createdWorkspaceIds?.includes("a"))).toBe(true);
  });

  it("keeps going when Gemini rejects a Gem, and lists it at the end", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    h.tabResponder = geminiTab([], (name) =>
      name === "Workspace a" ? { success: false, error: "HTTP 400" } : { success: true, gemId: "gem-b" },
    );
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "gemini");
    await finishGeminiRun(o);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["b"]);
    expect(status.manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "Not created in Gemini (HTTP 400)" },
    ]);
  });

  it("offers the manual route in hybrid mode when Gemini rejects the request", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    h.tabResponder = geminiTab([], () => ({ success: false, error: "HTTP 400" }));
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a", "b"], "gemini");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    o.confirmStep(true, token(o));

    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    const step = o.getStatus().currentSteps.find((s) => s.id === "a-create");
    expect(step?.fallback?.copyBlocks.map((b) => b.content)).toContain("Instructions for a");
    expect(step?.confirmLabel).toBe("It's in Gemini now");
    o.confirmStep(true);

    await waitFor(() => o.getStatus().pendingConfirmStepId === "b-create");
    o.confirmStep(true, token(o));
    await waitFor(
      () =>
        o.getStatus().pendingConfirmStepId === "b-create" &&
        o.getStatus().currentSteps[0]?.confirmLabel === "It's in Gemini now",
    );
    o.confirmStep(false, token(o));

    await finishGeminiRun(o);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.instructionsDelivery.a).toBe("manual");
    expect(status.manualWorkspaces).toEqual([
      { id: "b", name: "Workspace b", reason: "Not created in Gemini (HTTP 400)" },
    ]);
  });

  it("asks before each Gem in hybrid mode and respects a skip", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "gemini");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    expect(o.getStatus().currentSteps[0]?.confirmLabel).toBe("Create Gem");
    o.confirmStep(false);
    await finishGeminiRun(o);
    expect(h.tabMessages.some((m) => m.name === "GEMINI_CREATE_GEM")).toBe(false);
    expect(o.getStatus().manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "Skipped" },
    ]);
  });
});

describe("MigrationOrchestrator: answering the right question", () => {
  it("ignores an answer meant for an earlier question", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "Create?", status: "pending" },
      { id: `${id}-create-api`, title: "Couldn't create. It's in Claude now?", status: "pending" },
      { id: `${id}-create-api`, title: "Not created", status: "skipped" },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "claude");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create-api");
    const first = token(o);
    expect(o.confirmStep(true, first)).toBe(true);

    // Same step ID, new question: a second click with the old token does nothing
    await waitFor(() => o.getStatus().pendingConfirmToken !== null && token(o) !== first);
    expect(o.confirmStep(true, first)).toBe(false);
    expect(o.confirmStep(false, token(o))).toBe(true);

    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.answers).toEqual([true, false]);
    expect(o.getStatus().completedWorkspaceIds).toEqual([]);
  });

  it("lets a cancel win while the manifest is still loading", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    const starting = o.start("m1", "autofill", ["a"], "claude");
    o.cancel();
    await expect(starting).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.autofillCalls).toEqual([]);
    expect(o.getStatus().phase).toBe("idle");
  });
});

describe("MigrationOrchestrator: follow-ups", () => {
  it("records skipped steps, delivered files and project memory", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      { id: `${id}-create-api`, title: "Project created", status: "success", projectCreated: true },
      { id: `${id}-memory-doc`, title: "Project memory added (2 notes)", status: "success", projectMemoryAdded: true },
      { id: `${id}-upload-files`, title: "Uploaded 1 of 2 file(s)", status: "skipped", filesDelivered: 1 },
      { id: `${id}-verify`, title: "Check the project: instructions are missing", status: "fallback", verified: false },
      { id: `${id}-open-project`, title: "Open your new project from Claude", status: "skipped" },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.verifiedWorkspaceIds).toEqual([]);
    expect(status.followUps).toEqual({
      a: ["Uploaded 1 of 2 file(s)", "Check the project: instructions are missing"],
    });
    expect(status.filesDelivered).toEqual({ a: 1 });
    expect(status.projectMemoryWorkspaceIds).toEqual(["a"]);
    const saved = h.checkpoints[h.checkpoints.length - 1]!.state;
    expect(saved.followUps).toEqual(status.followUps);
  });

  it("keeps notes from steps that finished by hand", async () => {
    putManifest("m1", [ws("a")]);
    h.autofillScript = (id) => [
      {
        id: `${id}-create-api`,
        title: "Created by hand",
        status: "success",
        projectCreated: true,
        followUp: "Created by hand: check that it has the instructions",
      },
    ];
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().followUps).toEqual({
      a: ["Created by hand: check that it has the instructions"],
    });
    expect(o.getStatus().filesDelivered).toEqual({});
  });

  it("does not count files for a Gem created by hand", async () => {
    putManifest("m1", [
      ws("a", {
        knowledgeFiles: [
          { id: "k", originalName: "a.md", mimeType: "text/markdown", sizeBytes: 1, source: "exported", contentRef: "f", compatible: true },
        ],
      }),
    ]);
    h.tabResponder = geminiTab([], () => ({ success: false, error: "HTTP 500" }));
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "gemini");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().currentSteps[0]?.confirmLabel === "It's in Gemini now");
    o.confirmStep(true, token(o));
    await finishGeminiRun(o);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.filesDelivered).toEqual({});
    expect(status.followUps.a?.[0]).toBe(
      "Created by hand: check that it has the instructions and 1 file",
    );
  });

  it("keeps a guided workspace's unticked steps as follow-ups", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "guided", ["a"], "gemini");
    await waitFor(() => o.getStatus().guidedInstructions !== null);
    const save = o.getStatus().guidedInstructions!.steps.find((st) => st.id === "a-name")!;
    expect(o.markWorkspaceDone("a", [save.id])).toBe(true);
    await finishGeminiRun(o);
    expect(o.getStatus().followUps.a).toEqual([`Not marked done: ${save.title}`]);
  });

  it("records whether the memory steps were finished", async () => {
    putManifest("m1", [ws("a")], {
      globalInstructions: "Be brief.",
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().phase === "memory");
    expect(o.getStatus().memoryImported).toBeNull();
    o.markMemoryDone(false);
    expect(o.getStatus().memoryImported).toBe(false);
    expect(h.checkpoints[h.checkpoints.length - 1]!.state.memoryImported).toBe(false);
  });
});

describe("MigrationOrchestrator: Gemini duplicates", () => {
  it("skips a taken name without asking in automatic mode", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = geminiTab([{ id: "old", name: "workspace A" }]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    expect(h.tabMessages.some((m) => m.name === "GEMINI_CREATE_GEM")).toBe(false);
    expect(o.getStatus().manualWorkspaces[0]?.reason).toContain("already in Gemini");
  });

  it("asks before creating a Gem whose name is taken in hybrid mode", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = geminiTab([{ id: "old", name: "workspace A" }]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "gemini");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    expect(o.getStatus().currentSteps[0]?.title).toContain("already in Gemini");
    o.confirmStep(false, token(o));
    await finishGeminiRun(o);
    expect(h.tabMessages.some((m) => m.name === "GEMINI_CREATE_GEM")).toBe(false);
    expect(o.getStatus().manualWorkspaces[0]?.reason).toContain("already in Gemini");
  });

  it("treats an unclear failure as success when the Gem shows up", async () => {
    putManifest("m1", [ws("a")]);
    const gems: Array<{ id: string; name: string }> = [];
    h.tabResponder = geminiTab(gems, (name) => {
      gems.push({ id: "gem-new", name });
      return { success: false, error: "Timed out", maybeCreated: true };
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.pendingConfirmStepId).toBeNull();
    expect(h.tabMessages.filter((m) => m.name === "GEMINI_CREATE_GEM")).toHaveLength(1);
  });
});

// ─── Gem knowledge ──────────────────────────────────────────

function withKnowledge(id: string, files: string[], memory = false): Workspace {
  for (const name of files) h.files.set(`file-${name}`, { blob: "eA==", mimeType: "text/plain" });
  return ws(id, {
    description: `About ${id}`,
    knowledgeFiles: files.map((name, i) => ({
      id: `kf-${i}`,
      originalName: name,
      mimeType: "text/plain",
      sizeBytes: 1,
      source: "exported" as const,
      contentRef: `file-${name}`,
      compatible: true,
    })),
    ...(memory
      ? {
          projectMemory: {
            source: "claude_memory" as const,
            capturedAt: "2026-09-01T00:00:00.000Z",
            entries: [{ id: "e1", title: "Stack", content: "Uses Vite" }],
          },
        }
      : {}),
  });
}

describe("MigrationOrchestrator: Gem knowledge", () => {
  it("adds the files and project memory to the new Gem without asking", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt", "two.txt"], true)]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);

    const uploads = h.tabMessages.filter((m) => m.name === "GEMINI_UPLOAD_KNOWLEDGE_FILE");
    expect(uploads.map((m) => (m.payload as { fileName: string }).fileName)).toEqual([
      "project-memory-from-chatgpt.md",
      "one.txt",
      "two.txt",
    ]);
    const update = h.tabMessages.find((m) => m.name === "GEMINI_UPDATE_GEM");
    expect(update?.payload).toEqual({
      gemId: "gem-1",
      name: "Workspace a",
      description: "About a",
      instructions: "Instructions for a",
      knowledgeHandles: ["$h-project-memory-from-chatgpt.md", "$h-one.txt", "$h-two.txt"],
    });
    const status = o.getStatus();
    expect(status.filesDelivered.a).toBe(2);
    expect(status.projectMemoryWorkspaceIds).toEqual(["a"]);
    expect(status.followUps.a).toBeUndefined();
    expect(status.knowledgeLeftovers).toEqual({});
    expect(h.answers).toEqual([]);
  });

  it("saves what uploaded and leaves the rest for the end", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt", "big.pdf"]), ws("b")]);
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_UPLOAD_KNOWLEDGE_FILE" && (payload as { fileName: string }).fileName === "big.pdf"
        ? { success: false, error: "File upload failed: HTTP 413" }
        : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "gemini");
    await finishGeminiRun(o);

    const update = h.tabMessages.find((m) => m.name === "GEMINI_UPDATE_GEM");
    expect((update?.payload as { knowledgeHandles: string[] }).knowledgeHandles).toEqual(["$h-one.txt"]);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a", "b"]);
    expect(status.filesDelivered.a).toBe(1);
    expect(status.knowledgeLeftovers.a).toEqual({
      link: "https://gemini.google.com/u/0/gems/edit/gem-1",
      fileNames: ["big.pdf"],
      projectMemory: false,
    });
    expect(status.followUps.a).toEqual([
      "Add 1 file to the Gem by hand (big.pdf: File upload failed: HTTP 413)",
    ]);
    const last = h.checkpoints[h.checkpoints.length - 1]!.state;
    expect(last.knowledgeLeftovers?.a?.fileNames).toEqual(["big.pdf"]);
  });

  it("lists everything when saving the Gem fails", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt"], true)]);
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_UPDATE_GEM" ? { success: false, error: "HTTP 500" } : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const status = o.getStatus();
    expect(status.filesDelivered.a).toBeUndefined();
    expect(status.projectMemoryWorkspaceIds).toEqual([]);
    expect(status.knowledgeLeftovers.a).toEqual(
      expect.objectContaining({ fileNames: ["one.txt"], projectMemory: true }),
    );
    expect(status.currentSteps).toEqual([]);
  });

  it("sends nothing extra for a Gem without files", async () => {
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    expect(h.tabMessages.map((m) => m.name)).not.toContain("GEMINI_UPDATE_GEM");
    expect(h.tabMessages.map((m) => m.name)).not.toContain("GEMINI_UPLOAD_KNOWLEDGE_FILE");
  });
});

// ─── Gemini memories ────────────────────────────────────────

function memories(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    fact: `Fact  number ${i}`,
    category: "preference" as const,
    confidence: 1,
    source: "explicit" as const,
    workspaceIds: [],
    migration: { fitsConstraints: true, priority: 3 },
  }));
}

describe("MigrationOrchestrator: Gemini memories", () => {
  it("saves memories and custom instructions without a paste step", async () => {
    putManifest("m1", [ws("a")], { memory: memories(12), globalInstructions: "Be brief." });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);

    const calls = h.tabMessages.filter((m) => m.name === "GEMINI_SAVE_MEMORIES");
    expect(calls.map((c) => (c.payload as { texts: string[] }).texts.length)).toEqual([5, 5, 3]);
    expect((calls[0]!.payload as { texts: string[] }).texts.slice(0, 2)).toEqual([
      "Be brief.",
      "Fact number 0",
    ]);
    const status = o.getStatus();
    expect(status.memoryAutoSaved).toEqual({ saved: 13, total: 13 });
    expect(status.memoryImported).toBe(true);
  });

  it("leaves only the memories Gemini refused for copy and paste", async () => {
    putManifest("m1", [ws("a")], { memory: memories(3) });
    const base = geminiTab();
    h.tabResponder = (name, payload) => {
      if (name !== "GEMINI_SAVE_MEMORIES") return base(name, payload);
      const texts = (payload as { texts: string[] }).texts;
      return {
        results: texts.map((text) =>
          text.endsWith("1") ? { text, success: false, error: "HTTP 400" } : { text, success: true, id: "x" },
        ),
      };
    };
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await waitFor(() => o.getStatus().phase === "memory", "memory");
    const status = o.getStatus();
    expect(status.memoryAutoSaved).toEqual({ saved: 2, total: 3, reasons: ["1× HTTP 400"] });
    expect(status.memoryImported).toBeNull();
    const paste = status.memorySteps.find((st) => st.id === "memory-paste");
    expect(paste?.title).toBe("Add the 1 memory Gemini didn't take");
    expect(paste?.description).toContain("Gemini's reason: 1× HTTP 400");
    expect(paste?.description).toContain("What's missing:");
    expect(paste?.description).toContain("Fact number 1");
    expect(paste?.actions?.[0]?.label).toBe("Copy, then open Gemini's import page");
    expect(paste?.copyBlocks[0]?.content).toContain("Fact number 1");
    expect(paste?.copyBlocks[0]?.content).not.toContain("Fact number 0");
    expect(h.checkpoints[h.checkpoints.length - 1]!.state.savedMemoryIds).toEqual(["m0", "m2"]);
  });

  it("doesn't save again what a resumed run already saved", async () => {
    putManifest("m1", [ws("a")], { memory: memories(3) });
    h.checkpoints.push({
      state: {
        phase: "migrating",
        sourcePlatform: "chatgpt",
        targetPlatform: "gemini",
        extractionMethod: null,
        deliveryMode: "autofill",
        manifestId: "m1",
        selectedWorkspaceIds: ["a"],
        completedWorkspaceIds: ["a"],
        createdWorkspaceIds: ["a"],
        errors: [],
        savedMemoryIds: ["m0", "m1"],
      },
      workspaceIndex: 1,
    });
    const o = new MigrationOrchestrator();
    expect(await o.resume()).toBe(true);
    await finishGeminiRun(o);
    const texts = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);
    expect(texts).toEqual(["Fact number 2"]);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 3, total: 3 });
  });

  it("saves a fact that appears twice only once", async () => {
    const [a, b] = memories(2);
    putManifest("m1", [ws("a")], { memory: [a!, { ...b!, fact: "fact number 0." }] });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const texts = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);
    expect(texts).toEqual(["Fact number 0"]);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 2, total: 2 });
  });

  it("doesn't send again what an earlier run saved, even after Gemini rewrites it", async () => {
    putManifest("m1", [ws("a")], { memory: memories(3) });
    h.savedMemory = ["m0", "m2"];
    // Gemini's list comes back rewritten, so text matching can't help here.
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_LIST_MEMORIES"
        ? { success: true, texts: ["I think fact number 0 is right.", "Fact number 2, restated."] }
        : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const texts = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);
    expect(texts).toEqual(["Fact number 1"]);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 3, total: 3 });
    expect(h.savedMemory.sort()).toEqual(["m0", "m1", "m2"]);
  });

  it("opens Gemini's saved-info page when memories are left over", async () => {
    putManifest("m1", [ws("a")], { memory: memories(1) });
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_SAVE_MEMORIES"
        ? { results: [{ text: "x", success: false, error: "HTTP 400" }] }
        : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await waitFor(() => o.getStatus().phase === "memory", "memory");
    const created = chromeMock.tabs.create.mock.calls as unknown as Array<[{ url?: string }]>;
    expect(created.some((c) => c[0]?.url === "https://gemini.google.com/saved-info")).toBe(true);
  });

  it("skips memories Gemini already has", async () => {
    putManifest("m1", [ws("a")], { memory: memories(3) });
    // A store with something in it: the one-time backfill is for accounts
    // that predate the store, and would otherwise mark all three as saved.
    h.savedMemory = ["m1"];
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_LIST_MEMORIES"
        ? { success: true, texts: ["fact number 1.", "Something else"] }
        : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    const texts = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);
    expect(texts).toEqual(["Fact number 0", "Fact number 2"]);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 3, total: 3 });
  });

  it("still saves when the list can't be read, and leaves over-long text for pasting", async () => {
    const long = { ...memories(1)[0]!, id: "long", fact: "x".repeat(10_001) };
    putManifest("m1", [ws("a")], { memory: [...memories(1), long] });
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_LIST_MEMORIES" ? { success: false, error: "HTTP 500" } : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await waitFor(() => o.getStatus().phase === "memory", "memory");
    const texts = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);
    expect(texts).toEqual(["Fact number 0"]);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 1, total: 2 });
    expect(o.getStatus().memorySteps.map((st) => st.id)).toContain("memory-paste");
  });

  it("keeps the copy-and-paste steps in guided mode", async () => {
    putManifest("m1", [ws("a")], { memory: memories(2) });
    const o = new MigrationOrchestrator();
    await o.start("m1", "guided", ["a"], "gemini");
    await waitFor(() => o.getStatus().guidedInstructions !== null);
    o.markWorkspaceDone("a");
    await waitFor(() => o.getStatus().phase === "memory", "memory");
    expect(h.tabMessages.some((m) => m.name === "GEMINI_SAVE_MEMORIES")).toBe(false);
    expect(o.getStatus().memorySteps.map((st) => st.id)).toContain("memory-paste");
  });
});

describe("MigrationOrchestrator: Gemini accounts", () => {
  const TABS: Record<number, string> = {
    30: "https://gemini.google.com/app",
    31: "https://gemini.google.com/u/1/gems/view",
    32: "https://gemini.google.com/u/1/app",
  };

  function openTabs(ids: number[], activeId: number | null): void {
    chromeMock.tabs.query.mockImplementation((async (q: { url: string; active?: boolean }) => {
      if (!q.url.includes("gemini")) return [];
      const list = q.active ? ids.filter((id) => id === activeId) : ids;
      return list.map((id) => ({ id, url: TABS[id] }));
    }) as never);
    chromeMock.tabs.get.mockImplementation((async (id: number) => ({ id, url: TABS[id], discarded: false })) as never);
  }

  it("reads the account from a Gemini URL", () => {
    expect(geminiAccountPath("https://gemini.google.com/app")).toBe("/u/0/");
    expect(geminiAccountPath("https://gemini.google.com/u/1/app")).toBe("/u/1/");
    expect(geminiAccountPath("https://gemini.google.com/u/3")).toBe("/u/3/");
    expect(geminiAccountPath("https://gemini.google.com/u/2?hl=en")).toBe("/u/2/");
    expect(geminiAccountPath(undefined)).toBe("/u/0/");
  });

  it("warns when tabs belong to different accounts and stays with the chosen one", async () => {
    openTabs([30, 31], 31);
    putManifest("m1", [ws("a"), ws("b")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "gemini");

    const warning = o.getStatus().duplicateTabWarning ?? "";
    expect(warning).toContain("2 Google accounts (/u/0/, /u/1/)");
    expect(warning).toContain("gemini.google.com/u/1/");
    expect(warning).not.toContain("\u2014");

    // The user switches to the default-account tab mid-run: PortSmith stays put.
    openTabs([30, 31], 30);
    await finishGeminiRun(o);
    const geminiTabs = new Set(h.tabMessages.filter((m) => m.name.startsWith("GEMINI_")).map((m) => m.tabId));
    expect([...geminiTabs]).toEqual([31]);
    expect(h.tabMessages.filter((m) => m.name === "GEMINI_CREATE_GEM")).toHaveLength(2);
  });

  it("falls back to another tab of the same account only", async () => {
    openTabs([30, 31], 31);
    const respond = h.tabResponder;
    let closed = false;
    h.tabResponder = (name, payload) => {
      // The pinned /u/1/ tab closes after the first Gem is created.
      if (name === "GEMINI_CREATE_GEM" && !closed) {
        closed = true;
        openTabs([30, 32], 30);
        chromeMock.tabs.get.mockImplementation((async (id: number) => {
          if (id === 31) throw new Error("No tab with id 31");
          return { id, url: TABS[id], discarded: false };
        }) as never);
      }
      return respond(name, payload);
    };
    putManifest("m1", [ws("a"), ws("b")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "gemini");
    await finishGeminiRun(o);

    const creates = h.tabMessages.filter((m) => m.name === "GEMINI_CREATE_GEM");
    expect(creates.map((m) => m.tabId)).toEqual([31, 32]);
  });

  it("keeps the old notice when the tabs share one account", async () => {
    openTabs([31, 32], 31);
    putManifest("m1", [ws("a")]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    expect(o.getStatus().duplicateTabWarning).toBe(
      "2 Gemini tabs are open. PortSmith uses one of them; close the extras if you run into problems.",
    );
    await finishGeminiRun(o);
    expect(new Set(h.tabMessages.filter((m) => m.name.startsWith("GEMINI_")).map((m) => m.tabId))).toEqual(new Set([31]));
  });
});

describe("MigrationOrchestrator: Gemini saved-memory store", () => {
  /** One memory that fits the create limit, one well over it. */
  function mixedMemories() {
    return [
      { ...memories(1)[0]!, id: "short", fact: "I prefer short answers." },
      {
        ...memories(1)[0]!,
        id: "long",
        fact: `${"I keep detailed notes about the migration project. ".repeat(40).trim()}`,
      },
    ];
  }

  it("sends everything it has no record of, and splits the over-limit memory", async () => {
    putManifest("m1", [ws("a")], { memory: mixedMemories() });
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_LIST_MEMORIES"
        ? { success: true, texts: ["Some entry a previous build saved."] }
        : base(name, payload);

    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);

    const sent = h.tabMessages
      .filter((m) => m.name === "GEMINI_SAVE_MEMORIES")
      .flatMap((m) => (m.payload as { texts: string[] }).texts);

    // Nothing is assumed saved: the short one is sent, the long one in pieces.
    expect(sent.some((t) => t.includes("I prefer short answers"))).toBe(true);
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.every((t) => t.length <= 1500)).toBe(true);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 2, total: 2 });
    expect(h.savedMemory.sort()).toEqual(["long", "short"]);
  });

  it("sends nothing on a second run, from its own record", async () => {
    putManifest("m1", [ws("a")], { memory: mixedMemories() });
    h.savedMemory = ["short", "long"];
    const base = geminiTab();
    h.tabResponder = (name, payload) =>
      name === "GEMINI_LIST_MEMORIES" ? { success: true, texts: [] } : base(name, payload);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
    await finishGeminiRun(o);
    expect(h.tabMessages.some((m) => m.name === "GEMINI_SAVE_MEMORIES")).toBe(false);
    expect(o.getStatus().memoryAutoSaved).toEqual({ saved: 2, total: 2 });
  });
});

// ─── ChatGPT target ─────────────────────────────────────────

/** ChatGPT tab: lists `projects`, and creates new ones unless told otherwise. */
function chatgptTab(
  projects: Array<{ id: string; name: string }> = [],
  options: {
    create?: (payload: { name: string; instructions: string }) => unknown;
    upload?: (fileName: string) => unknown;
  } = {},
) {
  const key = (n: string): string => n.trim().replace(/\s+/g, " ").toLowerCase();
  return (name: string, payload: unknown): unknown => {
    if (name === "PING") return { pong: true };
    if (name === "CHATGPT_FIND_PROJECTS") {
      const wanted = key((payload as { name: string }).name);
      return { success: true, gizmoIds: projects.filter((p) => key(p.name) === wanted).map((p) => p.id) };
    }
    if (name === "CHATGPT_CREATE_PROJECT") {
      const req = payload as { name: string; instructions: string };
      if (options.create) return options.create(req);
      const id = `g-p-${String(projects.length + 1).padStart(32, "0")}`;
      projects.push({ id, name: req.name });
      return { success: true, gizmoId: id };
    }
    if (name === "CHATGPT_UPLOAD_PROJECT_FILE") {
      const fileName = (payload as { fileName: string }).fileName;
      return options.upload?.(fileName) ?? { success: true, fileId: `file_${fileName}` };
    }
    return { success: true };
  };
}

const GIZMO_1 = `g-p-${"0".repeat(31)}1`;
const fromClaude = {
  source: { platform: "claude" as const, exportMethod: "api" as const, exportedAt: "2026-09-01T00:00:00.000Z" },
};
const sent = (name: string) => h.tabMessages.filter((m) => m.name === name);
const uploadedNames = () =>
  sent("CHATGPT_UPLOAD_PROJECT_FILE").map((m) => (m.payload as { fileName: string }).fileName);

describe("MigrationOrchestrator: ChatGPT target", () => {
  it("creates the project and adds the memory document and files to its Sources", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt", "two.txt"], true)], fromClaude);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");

    expect(sent("CHATGPT_CREATE_PROJECT").map((m) => m.payload)).toEqual([
      { name: "Workspace a", instructions: "Instructions for a" },
    ]);
    expect(uploadedNames()).toEqual(["project-memory-from-claude.md", "one.txt", "two.txt"]);
    expect(sent("CHATGPT_UPLOAD_PROJECT_FILE").every((m) => (m.payload as { gizmoId: string }).gizmoId === GIZMO_1)).toBe(true);
    expect(h.tabMessages.every((m) => m.tabId === 33)).toBe(true);
    const status = o.getStatus();
    expect(status.mode).toBe("autofill");
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.instructionsDelivery.a).toBe("autofilled");
    expect(status.filesDelivered.a).toBe(2);
    expect(status.projectMemoryWorkspaceIds).toEqual(["a"]);
    expect(status.knowledgeLeftovers).toEqual({});
    // "About a" has nowhere to go in ChatGPT: a note and a card for it.
    expect(status.followUps.a).toEqual([expect.stringContaining("no description field")]);
    expect(status.leftoverSteps.a?.[0]?.copyBlocks).toEqual([{ label: "Description", content: "About a" }]);
    expect(h.answers).toEqual([]);
    expect(status.pendingConfirmStepId).toBeNull();
    expect(h.checkpoints.some((c) => c.state.createdWorkspaceIds?.includes("a"))).toBe(true);
  });

  it("opens a ChatGPT tab in the background and waits for it to answer", async () => {
    h.chatgptTabs = [];
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: "https://chatgpt.com/", active: false });
    expect(h.tabMessages[0]).toEqual(expect.objectContaining({ tabId: 77, name: "PING" }));
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a"]);
  });

  it("notes extra ChatGPT tabs like the other targets", async () => {
    h.chatgptTabs = [{ id: 33 }, { id: 34 }];
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    expect(o.getStatus().duplicateTabWarning).toContain("2 ChatGPT tabs are open");
  });

  it("asks before each project in hybrid mode and respects a skip", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    const step = o.getStatus().currentSteps[0];
    expect(step?.title).toBe('Create the project "Workspace a"?');
    expect(step?.confirmLabel).toBe("Create project");
    o.confirmStep(false, token(o));
    await waitFor(() => o.getStatus().phase === "complete");
    expect(sent("CHATGPT_CREATE_PROJECT")).toHaveLength(0);
    expect(o.getStatus().manualWorkspaces).toEqual([{ id: "a", name: "Workspace a", reason: "Skipped" }]);
  });

  it("skips a taken name without asking in automatic mode", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    h.tabResponder = chatgptTab([{ id: `g-p-${"f".repeat(32)}`, name: "workspace  A" }]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(sent("CHATGPT_CREATE_PROJECT").map((m) => (m.payload as { name: string }).name)).toEqual(["Workspace b"]);
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["b"]);
    expect(status.manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "A project with this name is already in ChatGPT" },
    ]);
    expect(h.answers).toEqual([]);
  });

  it("asks before creating a project whose name is taken in hybrid mode", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab([{ id: `g-p-${"f".repeat(32)}`, name: "Workspace a" }]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().currentSteps[0]?.confirmLabel === "Create another");
    expect(o.getStatus().currentSteps[0]?.title).toContain("already in ChatGPT");
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().phase === "complete");
    expect(sent("CHATGPT_CREATE_PROJECT")).toHaveLength(1);
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a"]);
  });

  it("checks for duplicates by the trimmed name and says it was trimmed", async () => {
    const long = "A project name that is much longer than fifty characters allows";
    putManifest("m1", [ws("a", { name: long })]);
    const trimmed = "A project name that is much longer than fifty…";
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(sent("CHATGPT_FIND_PROJECTS")[0]?.payload).toEqual({ name: trimmed });
    expect(sent("CHATGPT_CREATE_PROJECT")[0]?.payload).toEqual(expect.objectContaining({ name: trimmed }));
    expect(o.getStatus().followUps.a).toEqual([
      `ChatGPT allows 50 characters in a project name, so "${long}" was created as "${trimmed}"`,
    ]);
  });

  it("shortens long instructions and uploads the full text first", async () => {
    const paragraph = "Follow the house style. ".repeat(40).trim();
    const long = Array.from({ length: 12 }, () => paragraph).join("\n\n");
    expect(long.length).toBeGreaterThan(8000);
    const workspace = withKnowledge("a", ["one.txt"], true);
    putManifest("m1", [{ ...workspace, instructions: { raw: long } }], fromClaude);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");

    const create = sent("CHATGPT_CREATE_PROJECT")[0]?.payload as { instructions: string };
    expect([...create.instructions].length).toBeLessThanOrEqual(8000);
    expect(create.instructions).toContain("full-instructions-from-claude.md");
    expect(uploadedNames()).toEqual([
      "full-instructions-from-claude.md",
      "project-memory-from-claude.md",
      "one.txt",
    ]);
    const status = o.getStatus();
    expect(status.instructionsDelivery.a).toBe("autofilled");
    expect(status.followUps.a).toContain(
      "ChatGPT allows 8000 characters of instructions, so they were shortened at a paragraph break. The full text is in the project file full-instructions-from-claude.md",
    );
    expect(status.filesDelivered.a).toBe(1);
  });

  it("says the full instructions didn't arrive when their file fails", async () => {
    putManifest("m1", [ws("a", { instructions: { raw: "word ".repeat(2000) } })], fromClaude);
    h.tabResponder = chatgptTab([], {
      upload: (fileName) =>
        fileName.startsWith("full-instructions") ? { success: false, error: "HTTP 500", step: "process" } : undefined,
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    const status = o.getStatus();
    expect(status.followUps.a?.[0]).toContain("The full instructions did not reach the project");
    expect(status.knowledgeLeftovers.a).toEqual({
      link: `https://chatgpt.com/g/${GIZMO_1}/project?tab=sources`,
      fileNames: [],
      projectMemory: false,
      instructionsFile: "full-instructions-from-claude.md",
    });
  });

  it("lists a file that failed with the Sources link and keeps going", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt", "big.pdf"]), ws("b")]);
    h.tabResponder = chatgptTab([], {
      upload: (fileName) =>
        fileName === "big.pdf" ? { success: false, error: "ChatGPT answered HTTP 413", step: "upload" } : undefined,
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a", "b"]);
    expect(status.filesDelivered.a).toBe(1);
    expect(status.knowledgeLeftovers.a).toEqual({
      link: `https://chatgpt.com/g/${GIZMO_1}/project?tab=sources`,
      fileNames: ["big.pdf"],
      projectMemory: false,
    });
    expect(status.followUps.a).toContain(
      "Add 1 file to the project's Sources by hand (big.pdf: ChatGPT answered HTTP 413)",
    );
    expect(h.checkpoints[h.checkpoints.length - 1]!.state.knowledgeLeftovers?.a?.fileNames).toEqual(["big.pdf"]);
  });

  it("never sends a file too large for one message", async () => {
    const workspace = withKnowledge("a", ["small.txt", "huge.zip"]);
    workspace.knowledgeFiles[1]!.sizeBytes = 49 * 1024 * 1024;
    putManifest("m1", [workspace]);
    h.tabResponder = chatgptTab();
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(uploadedNames()).toEqual(["small.txt"]);
    const status = o.getStatus();
    expect(status.knowledgeLeftovers.a?.fileNames).toEqual(["huge.zip"]);
    expect(status.followUps.a).toContain(
      "Add 1 file to the project's Sources by hand (huge.zip: too large to pass through the extension (over 47 MB): add it by hand)",
    );
  });

  it("treats an unclear failure as success when the project shows up", async () => {
    putManifest("m1", [ws("a")]);
    const projects: Array<{ id: string; name: string }> = [];
    h.tabResponder = chatgptTab(projects, {
      create: (req) => {
        projects.push({ id: GIZMO_1, name: req.name });
        return { success: false, error: "Couldn't reach ChatGPT creating the project", maybeCreated: true };
      },
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().completedWorkspaceIds).toEqual(["a"]);
    expect(sent("CHATGPT_CREATE_PROJECT")).toHaveLength(1);
  });

  it("lists a rejected project at the end in automatic mode", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab([], {
      create: () => ({ success: false, error: "The project name is too long" }),
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    expect(o.getStatus().manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "Not created in ChatGPT (The project name is too long)" },
    ]);
  });

  it("offers the manual route in hybrid mode when ChatGPT rejects the request", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab([], { create: () => ({ success: false, error: "HTTP 422" }) });
    const o = new MigrationOrchestrator();
    await o.start("m1", "hybrid", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().currentSteps[0]?.confirmLabel === "It's in ChatGPT now");
    const step = o.getStatus().currentSteps[0];
    expect(step?.fallback?.description).toContain('click the + next to "Projects"');
    o.confirmStep(true, token(o));
    await waitFor(() => o.getStatus().phase === "complete");
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.instructionsDelivery.a).toBe("manual");
    expect(status.createdWorkspaceIds).toEqual(["a"]);
  });

  it("marks a project whose instructions came back different as created, to check", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = chatgptTab([], {
      create: () => ({ success: false, gizmoId: GIZMO_1, instructionsMismatch: true, error: "mismatch" }),
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().phase === "complete");
    const status = o.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["a"]);
    expect(status.createdWorkspaceIds).toEqual(["a"]);
    expect(status.instructionsDelivery.a).toBe("manual");
    expect(status.followUps.a?.[0]).toContain("saved different instructions");
  });

  it("never re-creates a project that was created before a restart", async () => {
    putManifest("m1", [withKnowledge("a", ["one.txt"]), ws("b")]);
    // Run 1 stops while uploading to "a", after "a" was created.
    let hang = true;
    const base = chatgptTab();
    h.tabResponder = (name, payload) =>
      hang && name === "CHATGPT_UPLOAD_PROJECT_FILE" ? new Promise(() => undefined) : base(name, payload);
    const first = new MigrationOrchestrator();
    await first.start("m1", "autofill", ["a", "b"], "chatgpt");
    await waitFor(() => sent("CHATGPT_UPLOAD_PROJECT_FILE").length === 1, "upload");
    const saved = h.checkpoints[h.checkpoints.length - 1]!;
    expect(saved.state.createdWorkspaceIds).toEqual(["a"]);
    expect(saved.workspaceIndex).toBe(0);

    // The service worker restarts: a new orchestrator resumes
    hang = false;
    const second = new MigrationOrchestrator();
    await expect(second.resume()).resolves.toBe(true);
    await waitFor(() => second.getStatus().phase === "complete");
    expect(sent("CHATGPT_CREATE_PROJECT").map((m) => (m.payload as { name: string }).name)).toEqual([
      "Workspace a",
      "Workspace b",
    ]);
    const status = second.getStatus();
    expect(status.completedWorkspaceIds).toEqual(["b"]);
    expect(status.manualWorkspaces).toEqual([
      expect.objectContaining({ id: "a", reason: expect.stringContaining("stopped before it finished") }),
    ]);
  });
});
