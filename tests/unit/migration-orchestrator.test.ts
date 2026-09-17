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
  };
});

vi.mock("@/shared/messaging", () => ({
  onMessage: vi.fn(() => () => undefined),
  safeSendTabMessage: vi.fn(async (tabId: number, name: string, payload: unknown) => {
    h.tabMessages.push({ tabId, name, payload });
    return h.tabResponder(name, payload);
  }),
}));

vi.mock("@/core/storage/indexed-db", () => ({
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
      if (step.status === "pending") h.answers.push(answer);
    }
  }),
}));

const chromeMock = {
  tabs: {
    query: vi.fn(async ({ url }: { url: string }) =>
      url.includes("claude.ai") ? [{ id: 11 }] : url.includes("gemini") ? [{ id: 22 }] : [],
    ),
    get: vi.fn(async (id: number) => ({
      id,
      url: id === 11 ? "https://claude.ai/projects" : "https://gemini.google.com/app",
      discarded: false,
    })),
    create: vi.fn(async () => ({ id: 99 })),
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
    return { success: true };
  };
}

beforeEach(() => {
  h.manifests.clear();
  h.checkpoints.length = 0;
  h.tabMessages.length = 0;
  h.autofillCalls.length = 0;
  h.answers.length = 0;
  h.tabResponder = geminiTab();
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
    await first.start("m1", "autofill", ["a", "b"], "claude");
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
    await o.start("m1", "autofill", ["a"], "claude");
    await waitFor(() => o.getStatus().pendingConfirmStepId !== null);
    o.confirmStep(false);
    await waitFor(() => o.getStatus().phase === "complete");
    expect(h.answers).toEqual([false]);
    expect(o.getStatus().completedWorkspaceIds).toEqual([]);
    expect(o.getStatus().manualWorkspaces).toEqual([
      { id: "a", name: "Workspace a", reason: "Skipped" },
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

describe("MigrationOrchestrator: ChatGPT target", () => {
  it("always uses the guided ChatGPT flow", async () => {
    putManifest("m1", [ws("a")], {
      source: { platform: "claude", exportMethod: "api", exportedAt: "2026-09-01T00:00:00.000Z" },
    });
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "chatgpt");
    await waitFor(() => o.getStatus().guidedInstructions !== null);
    const status = o.getStatus();
    expect(status.mode).toBe("guided");
    expect(status.targetPlatform).toBe("chatgpt");
    const text = JSON.stringify(status.guidedInstructions);
    expect(text).toContain("New project");
    expect(text).not.toMatch(/claude\.ai/);
    expect(h.autofillCalls).toEqual([]);

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

  it("offers the manual route when Gemini rejects the request", async () => {
    putManifest("m1", [ws("a"), ws("b")]);
    h.tabResponder = geminiTab([], () => ({ success: false, error: "HTTP 400" }));
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a", "b"], "gemini");

    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    const step = o.getStatus().currentSteps.find((s) => s.id === "a-create");
    expect(step?.fallback?.copyBlocks.map((b) => b.content)).toContain("Instructions for a");
    expect(step?.confirmLabel).toBe("It's in Gemini now");
    o.confirmStep(true);

    await waitFor(() => o.getStatus().pendingConfirmStepId === "b-create");
    o.confirmStep(false);

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
    await o.start("m1", "autofill", ["a"], "gemini");
    await waitFor(() => o.getStatus().pendingConfirmStepId === "a-create");
    expect(o.getStatus().currentSteps[0]?.confirmLabel).toBe("It's in Gemini now");
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
  it("asks before creating a Gem whose name is taken", async () => {
    putManifest("m1", [ws("a")]);
    h.tabResponder = geminiTab([{ id: "old", name: "workspace A" }]);
    const o = new MigrationOrchestrator();
    await o.start("m1", "autofill", ["a"], "gemini");
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
