import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTests } from "@/core/storage/indexed-db";
import {
  useMigrationStore,
  phaseToStep,
  STEP_LABELS,
  TOTAL_STEPS,
} from "@/sidepanel/store/migration-store";

beforeEach(async () => {
  await _resetForTests();
  useMigrationStore.setState({
    phase: "idle",
    sourcePlatform: null,
    targetPlatform: null,
    extractionMethod: null,
    manifestId: null,
    selectedWorkspaceIds: [],
    completedWorkspaceIds: [],
    errors: [],
    pendingResume: null,
    resumeChecked: false,
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
    useMigrationStore.getState().nextStep(); // idle → target_selection

    // Wait for async checkpoint
    await new Promise((r) => setTimeout(r, 50));

    // Check for resume should find the checkpoint
    useMigrationStore.setState({ resumeChecked: false });
    await useMigrationStore.getState().checkForResume();

    const { pendingResume } = useMigrationStore.getState();
    expect(pendingResume).not.toBeNull();
    expect(pendingResume?.state.phase).toBe("target_selection");
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

  it("declineResume clears checkpoint", async () => {
    useMigrationStore.getState().goToStep("migrating");
    await new Promise((r) => setTimeout(r, 50));

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
