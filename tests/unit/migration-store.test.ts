import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTests } from "@/core/storage/indexed-db";
import { checkpoint, createInitialState } from "@/core/storage/migration-state";
import {
  useMigrationStore,
  phaseToStep,
  STEP_LABELS,
  TOTAL_STEPS,
} from "@/sidepanel/store/migration-store";

// Mock chrome.storage.local for preference persistence
let prefStore: Record<string, unknown> = {};
const runtimeSendMessage = vi.fn(
  (_msg: unknown, cb?: (r: unknown) => void) => {
    cb?.({ __portsmith: true, ok: true, data: { success: true } });
  },
);
vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: runtimeSendMessage,
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of keyArray) {
          if (k in prefStore) result[k] = prefStore[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(prefStore, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArray) {
          delete prefStore[k];
        }
      }),
    },
  },
});

beforeEach(async () => {
  prefStore = {};
  runtimeSendMessage.mockClear();
  await _resetForTests();
  useMigrationStore.setState({
    phase: "idle",
    sourcePlatform: null,
    targetPlatform: null,
    extractionMethod: null,
    deliveryMode: null,
    manifestId: null,
    selectedWorkspaceIds: [],
    completedWorkspaceIds: [],
    errors: [],
    pendingResume: null,
    resumeChecked: false,
    resumedMigration: false,
  });
});

describe("phaseToStep", () => {
  it("maps setup phases to step 0 (Source)", () => {
    expect(phaseToStep("idle")).toBe(0);
    expect(phaseToStep("source_selection")).toBe(0);
    expect(phaseToStep("target_selection")).toBe(0);
    expect(phaseToStep("extraction_method")).toBe(0);
  });

  it("maps extraction phases to step 1 (Extract)", () => {
    expect(phaseToStep("extracting")).toBe(1);
  });

  it("maps review phases to step 2 (Review)", () => {
    expect(phaseToStep("review")).toBe(2);
    expect(phaseToStep("editing")).toBe(2);
  });

  it("maps mode_selection to step 3 (Mode)", () => {
    expect(phaseToStep("mode_selection")).toBe(3);
  });

  it("maps migration phases to step 4 (Migrate)", () => {
    expect(phaseToStep("migrating")).toBe(4);
    expect(phaseToStep("verification")).toBe(4);
  });

  it("maps complete to step 5 (Complete)", () => {
    expect(phaseToStep("complete")).toBe(5);
  });
});

describe("STEP_LABELS", () => {
  it("has 6 labels", () => {
    expect(STEP_LABELS).toHaveLength(6);
    expect(TOTAL_STEPS).toBe(6);
  });
});

describe("navigation", () => {
  it("starts at idle (step 0)", () => {
    const { phase } = useMigrationStore.getState();
    expect(phase).toBe("idle");
    expect(phaseToStep(phase)).toBe(0);
  });

  it("nextStep navigates through setup sub-phases then wizard steps", () => {
    const store = useMigrationStore.getState();

    store.nextStep(); // idle → target_selection
    expect(useMigrationStore.getState().phase).toBe("target_selection");

    store.nextStep(); // target_selection → extraction_method
    expect(useMigrationStore.getState().phase).toBe("extraction_method");

    store.nextStep(); // extraction_method → extracting (step 1)
    expect(useMigrationStore.getState().phase).toBe("extracting");

    store.nextStep(); // step 1 → step 2
    expect(useMigrationStore.getState().phase).toBe("review");

    store.nextStep(); // step 2 → step 3
    expect(useMigrationStore.getState().phase).toBe("mode_selection");

    store.nextStep(); // step 3 → step 4
    expect(useMigrationStore.getState().phase).toBe("migrating");

    store.nextStep(); // step 4 → step 5
    expect(useMigrationStore.getState().phase).toBe("complete");
  });

  it("nextStep does nothing at the last step", () => {
    useMigrationStore.setState({ phase: "complete" });
    useMigrationStore.getState().nextStep();
    expect(useMigrationStore.getState().phase).toBe("complete");
  });

  it("prevStep navigates back through setup sub-phases", () => {
    useMigrationStore.setState({ phase: "extraction_method" });
    useMigrationStore.getState().prevStep();
    expect(useMigrationStore.getState().phase).toBe("target_selection");

    useMigrationStore.getState().prevStep();
    expect(useMigrationStore.getState().phase).toBe("idle");
  });

  it("prevStep from extracting goes back to extraction_method", () => {
    useMigrationStore.setState({ phase: "extracting" });
    useMigrationStore.getState().prevStep();
    expect(useMigrationStore.getState().phase).toBe("extraction_method");
  });

  it("prevStep goes backwards between wizard steps", () => {
    useMigrationStore.setState({ phase: "review" });
    useMigrationStore.getState().prevStep();
    expect(useMigrationStore.getState().phase).toBe("extracting");
  });

  it("prevStep does nothing at idle", () => {
    useMigrationStore.getState().prevStep();
    expect(useMigrationStore.getState().phase).toBe("idle");
  });

  it("goToStep sets an arbitrary phase", () => {
    useMigrationStore.getState().goToStep("mode_selection");
    expect(useMigrationStore.getState().phase).toBe("mode_selection");
  });

  it("reset returns to idle and clears resume", () => {
    useMigrationStore.setState({
      phase: "migrating",
      sourcePlatform: "chatgpt",
      pendingResume: {
        state: {
          phase: "review",
          sourcePlatform: "chatgpt",
          targetPlatform: "claude",
          extractionMethod: null,
          deliveryMode: null,
          manifestId: null,
          selectedWorkspaceIds: [],
          completedWorkspaceIds: [],
          errors: [],
        },
        workspaceIndex: 0,
        stepIndex: 2,
      },
    });
    useMigrationStore.getState().reset();

    const state = useMigrationStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.sourcePlatform).toBeNull();
    expect(state.pendingResume).toBeNull();
  });
});

describe("selection setters", () => {
  it("setSourcePlatform updates sourcePlatform", () => {
    useMigrationStore.getState().setSourcePlatform("chatgpt");
    expect(useMigrationStore.getState().sourcePlatform).toBe("chatgpt");
  });

  it("setTargetPlatform updates targetPlatform", () => {
    useMigrationStore.getState().setTargetPlatform("claude");
    expect(useMigrationStore.getState().targetPlatform).toBe("claude");
  });

  it("setExtractionMethod updates extractionMethod", () => {
    useMigrationStore.getState().setExtractionMethod("both");
    expect(useMigrationStore.getState().extractionMethod).toBe("both");
  });
});

describe("checkpoint persistence", () => {
  it("auto-checkpoints on phase change", async () => {
    useMigrationStore.getState().goToStep("review");

    // Wait for async checkpoint
    await new Promise((r) => setTimeout(r, 50));

    // Check for resume should find the checkpoint
    useMigrationStore.setState({ resumeChecked: false });
    await useMigrationStore.getState().checkForResume();

    const { pendingResume } = useMigrationStore.getState();
    expect(pendingResume).not.toBeNull();
    expect(pendingResume?.state.phase).toBe("review");
  });

  it("does not offer to resume trivial setup phases", async () => {
    useMigrationStore.getState().nextStep(); // idle → target_selection
    await new Promise((r) => setTimeout(r, 50));

    useMigrationStore.setState({ resumeChecked: false });
    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume).toBeNull();
    expect(useMigrationStore.getState().resumeChecked).toBe(true);
  });

  it("does not write its own checkpoint when entering the migration", async () => {
    // The service worker owns checkpoints while migrating. A panel-written
    // checkpoint at workspace index 0 used to make resumed runs start over.
    await checkpoint(
      { ...createInitialState(), phase: "migrating", manifestId: "m1", deliveryMode: "autofill", selectedWorkspaceIds: ["a", "b"], completedWorkspaceIds: ["a"] },
      1,
      4,
    );
    useMigrationStore.getState().goToStep("migrating");
    await new Promise((r) => setTimeout(r, 50));

    useMigrationStore.setState({ phase: "idle", resumeChecked: false });
    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume?.workspaceIndex).toBe(1);
    expect(
      useMigrationStore.getState().pendingResume?.state.completedWorkspaceIds,
    ).toEqual(["a"]);
  });

  it("does not checkpoint on idle", async () => {
    // Start at idle, reset (which sets idle) — should not create checkpoint
    useMigrationStore.getState().reset();
    await new Promise((r) => setTimeout(r, 50));

    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume).toBeNull();
  });
});

describe("resume flow", () => {
  it("acceptResume restores state", async () => {
    // Simulate a checkpoint from a previous session
    useMigrationStore.getState().goToStep("review");
    useMigrationStore.setState({ sourcePlatform: "chatgpt" });
    await new Promise((r) => setTimeout(r, 50));

    // Simulate fresh session
    useMigrationStore.setState({
      ...useMigrationStore.getState(),
      phase: "idle",
      sourcePlatform: null,
      resumeChecked: false,
    });

    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume).not.toBeNull();

    useMigrationStore.getState().acceptResume();
    expect(useMigrationStore.getState().phase).toBe("review");
    expect(useMigrationStore.getState().pendingResume).toBeNull();
  });

  it("acceptResume of a running migration flags it for the Migrate page", async () => {
    await checkpoint(
      { ...createInitialState(), phase: "migrating", manifestId: "m1", deliveryMode: "guided", selectedWorkspaceIds: ["a"] },
      0,
      4,
    );
    await useMigrationStore.getState().checkForResume();
    useMigrationStore.getState().acceptResume();
    expect(useMigrationStore.getState().phase).toBe("migrating");
    expect(useMigrationStore.getState().resumedMigration).toBe(true);
  });

  it("declineResume clears checkpoint", async () => {
    await checkpoint(
      { ...createInitialState(), phase: "migrating", manifestId: "m1", deliveryMode: "autofill" },
      0,
      4,
    );

    useMigrationStore.setState({ phase: "idle", resumeChecked: false });
    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume).not.toBeNull();

    await useMigrationStore.getState().declineResume();
    expect(useMigrationStore.getState().pendingResume).toBeNull();

    // Verify checkpoint is cleared
    useMigrationStore.setState({ resumeChecked: false });
    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().pendingResume).toBeNull();
  });
});

describe("platform selection guards", () => {
  it("clears the target when the source is set to the same platform", () => {
    useMigrationStore.setState({ targetPlatform: "claude" });
    useMigrationStore.getState().setSourcePlatform("claude");
    expect(useMigrationStore.getState().sourcePlatform).toBe("claude");
    expect(useMigrationStore.getState().targetPlatform).toBeNull();
  });

  it("refuses a target equal to the source", () => {
    useMigrationStore.getState().setSourcePlatform("gemini");
    useMigrationStore.getState().setTargetPlatform("gemini");
    expect(useMigrationStore.getState().targetPlatform).toBeNull();
  });

  it("cannot proceed from target selection with source == target", async () => {
    const { canProceed } = await import("@/sidepanel/store/migration-store");
    const state = {
      ...useMigrationStore.getState(),
      phase: "target_selection" as const,
      sourcePlatform: "claude",
      targetPlatform: "claude",
    };
    expect(canProceed(state)).toBe(false);
  });

  it("cannot start a run with nothing selected", async () => {
    const { canProceed } = await import("@/sidepanel/store/migration-store");
    const base = { ...useMigrationStore.getState(), phase: "mode_selection" as const, deliveryMode: "autofill" as const };
    expect(canProceed({ ...base, selectedWorkspaceIds: [] })).toBe(false);
    expect(canProceed({ ...base, selectedWorkspaceIds: ["ws-1"] })).toBe(true);
  });

  it("remembers which manifest was already reviewed until reset", () => {
    useMigrationStore.getState().setReviewedManifestId("m-1");
    expect(useMigrationStore.getState().reviewedManifestId).toBe("m-1");
    useMigrationStore.getState().reset();
    expect(useMigrationStore.getState().reviewedManifestId).toBeNull();
  });

  it("changing the source drops the previous extraction", () => {
    useMigrationStore.setState({
      sourcePlatform: "chatgpt",
      manifestId: "manifest-old",
      selectedWorkspaceIds: ["ws-1", "ws-2"],
      extractionMethod: "browser",
    });
    useMigrationStore.getState().setSourcePlatform("gemini");
    const s = useMigrationStore.getState();
    expect(s.manifestId).toBeNull();
    expect(s.selectedWorkspaceIds).toEqual([]);
    expect(s.extractionMethod).toBeNull();
  });

  it("switches to guided mode when ChatGPT becomes the target", () => {
    useMigrationStore.setState({ sourcePlatform: "claude", deliveryMode: "autofill" });
    useMigrationStore.getState().setTargetPlatform("chatgpt");
    expect(useMigrationStore.getState().deliveryMode).toBe("guided");
  });

  it("ignores a saved target that equals the saved source", async () => {
    prefStore = {
      "pref:lastSourcePlatform": "claude",
      "pref:lastTargetPlatform": "claude",
    };
    await useMigrationStore.getState().checkForResume();
    expect(useMigrationStore.getState().sourcePlatform).toBe("claude");
    expect(useMigrationStore.getState().targetPlatform).toBeNull();
  });
});

describe("reset", () => {
  it("also cancels any run held by the service worker", () => {
    useMigrationStore.getState().reset();
    const types = runtimeSendMessage.mock.calls.map(
      (c) => (c[0] as { type?: string }).type,
    );
    expect(types).toContain("MIGRATION_CANCEL");
  });
});
