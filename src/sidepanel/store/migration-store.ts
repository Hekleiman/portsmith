import { create } from "zustand";
import type {
  MigrationPhase,
  MigrationStateSnapshot,
  ExtractionMethod,
  DeliveryMode,
} from "@/core/storage/migration-state";
import {
  checkpoint,
  resume,
  clearMigrationHistory,
  createInitialState,
} from "@/core/storage/migration-state";
import { sendMessage } from "@/shared/messaging";
import {
  getPreference,
  setPreference,
} from "@/core/storage/preferences";
import { supportedModesForTarget } from "@/core/platforms";

// ─── Phase / Step mapping ────────────────────────────────────

const PHASE_ORDER: MigrationPhase[] = [
  "idle",
  "source_selection",
  "target_selection",
  "extraction_method",
  "extracting",
  "review",
  "editing",
  "mode_selection",
  "migrating",
  "verification",
  "complete",
];

/** Entry phase for each of the 6 wizard steps. */
const STEP_ENTRY_PHASES: MigrationPhase[] = [
  "idle", //              0 – Source
  "extracting", //        1 – Extract
  "review", //            2 – Review
  "mode_selection", //    3 – Mode
  "migrating", //         4 – Migrate
  "complete", //          5 – Complete
];

export const STEP_LABELS = [
  "Source",
  "Extract",
  "Review",
  "Mode",
  "Migrate",
  "Complete",
] as const;

export const TOTAL_STEPS = STEP_LABELS.length;

/** Map any migration phase to its wizard step index (0–5). */
export function phaseToStep(phase: MigrationPhase): number {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  for (let s = STEP_ENTRY_PHASES.length - 1; s >= 0; s--) {
    const entryPhase = STEP_ENTRY_PHASES[s];
    if (entryPhase !== undefined && phaseIdx >= PHASE_ORDER.indexOf(entryPhase))
      return s;
  }
  return 0;
}

// ─── Store types ─────────────────────────────────────────────

interface ResumeData {
  state: MigrationStateSnapshot;
  workspaceIndex: number;
  stepIndex: number;
}

/** Phases worth offering to resume after the panel was closed. */
const RESUMABLE_PHASES: MigrationPhase[] = [
  "review",
  "editing",
  "mode_selection",
  "migrating",
  "verification",
];

/** Phases whose checkpoints the side panel writes (the service worker owns "migrating"). */
const PANEL_CHECKPOINT_PHASES: MigrationPhase[] = [
  "target_selection",
  "extraction_method",
  "extracting",
  "review",
  "editing",
  "mode_selection",
];

/** Ask the service worker to drop any run it still holds. */
function cancelOrchestrator(): void {
  try {
    if (typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function") {
      void sendMessage("MIGRATION_CANCEL").catch(() => {
        // Service worker not running: nothing to cancel
      });
    }
  } catch {
    // Not in an extension context (tests)
  }
}

interface MigrationState {
  phase: MigrationPhase;
  sourcePlatform: string | null;
  targetPlatform: string | null;
  extractionMethod: ExtractionMethod | null;
  deliveryMode: DeliveryMode | null;
  manifestId: string | null;
  editingWorkspaceId: string | null;
  selectedWorkspaceIds: string[];
  completedWorkspaceIds: string[];
  errors: string[];
  pendingResume: ResumeData | null;
  resumeChecked: boolean;
  migrationStartedAt: number | null;
  /** True when the Migrate page should resume the service worker's run */
  resumedMigration: boolean;
  /**
   * Manifest whose workspaces were already pre-selected on the Review page.
   * After that, an empty selection is the user's (or a stopped run's)
   * choice and must not snap back to "everything".
   */
  reviewedManifestId: string | null;
}

interface MigrationActions {
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (phase: MigrationPhase) => void;
  setSourcePlatform: (platform: string) => void;
  setTargetPlatform: (platform: string) => void;
  setExtractionMethod: (method: ExtractionMethod) => void;
  setManifestId: (id: string) => void;
  setSelectedWorkspaceIds: (ids: string[]) => void;
  toggleWorkspace: (id: string) => void;
  setEditingWorkspaceId: (id: string | null) => void;
  setDeliveryMode: (mode: DeliveryMode) => void;
  setReviewedManifestId: (id: string | null) => void;
  reset: () => void;
  checkForResume: () => Promise<void>;
  acceptResume: () => void;
  declineResume: () => Promise<void>;
}

export type MigrationStore = MigrationState & MigrationActions;

// ─── Helpers ─────────────────────────────────────────────────

function snapshotFromState(state: MigrationState): MigrationStateSnapshot {
  return {
    phase: state.phase,
    sourcePlatform: state.sourcePlatform,
    targetPlatform: state.targetPlatform,
    extractionMethod: state.extractionMethod,
    deliveryMode: state.deliveryMode,
    manifestId: state.manifestId,
    selectedWorkspaceIds: state.selectedWorkspaceIds,
    completedWorkspaceIds: state.completedWorkspaceIds,
    errors: state.errors,
  };
}

/** Whether the user can proceed from the current phase. */
export function canProceed(state: MigrationState): boolean {
  switch (state.phase) {
    case "idle":
    case "source_selection":
      return state.sourcePlatform !== null;
    case "target_selection":
      return (
        state.targetPlatform !== null &&
        state.targetPlatform !== state.sourcePlatform
      );
    case "extraction_method":
      return state.extractionMethod !== null;
    case "extracting":
      return state.manifestId !== null;
    case "review":
    case "editing":
      return state.selectedWorkspaceIds.length > 0;
    case "mode_selection":
      return state.deliveryMode !== null && state.selectedWorkspaceIds.length > 0;
    default:
      return true;
  }
}

// ─── Store ───────────────────────────────────────────────────

export const useMigrationStore = create<MigrationStore>((set, get) => ({
  ...createInitialState(),
  editingWorkspaceId: null,
  pendingResume: null,
  resumeChecked: false,
  migrationStartedAt: null,
  resumedMigration: false,
  reviewedManifestId: null,

  nextStep: () => {
    const { phase } = get();

    // Setup sub-phase navigation
    if (phase === "idle" || phase === "source_selection") {
      set({ phase: "target_selection" });
      return;
    }
    if (phase === "target_selection") {
      // Claude and Gemini only support browser extraction (API) — skip method selection
      const source = get().sourcePlatform;
      if (source === "claude" || source === "gemini") {
        set({ phase: "extracting", extractionMethod: "browser" });
        return;
      }
      set({ phase: "extraction_method" });
      return;
    }
    if (phase === "extraction_method") {
      set({ phase: "extracting" });
      return;
    }

    // Default: advance by wizard step
    const step = phaseToStep(phase);
    const nextEntry = STEP_ENTRY_PHASES[step + 1];
    if (nextEntry !== undefined) {
      set({ phase: nextEntry });
    }
  },

  prevStep: () => {
    const { phase } = get();

    // Setup sub-phase navigation
    if (phase === "target_selection") {
      set({ phase: "idle" });
      return;
    }
    if (phase === "extraction_method") {
      set({ phase: "target_selection" });
      return;
    }
    if (phase === "extracting") {
      // Claude and Gemini skipped extraction_method — go back to target_selection
      const source = get().sourcePlatform;
      if (source === "claude" || source === "gemini") {
        set({ phase: "target_selection" });
        return;
      }
      set({ phase: "extraction_method" });
      return;
    }
    if (phase === "editing") {
      set({ phase: "review", editingWorkspaceId: null });
      return;
    }

    // Default: go back by wizard step
    const step = phaseToStep(phase);
    const prevEntry = STEP_ENTRY_PHASES[step - 1];
    if (prevEntry !== undefined) {
      set({ phase: prevEntry });
    }
  },

  goToStep: (phase) => {
    set({ phase });
  },

  setSourcePlatform: (platform) => {
    const { sourcePlatform, targetPlatform } = get();
    if (platform === sourcePlatform) return;
    set({
      sourcePlatform: platform,
      // A different source means earlier extraction results no longer apply.
      manifestId: null,
      selectedWorkspaceIds: [],
      editingWorkspaceId: null,
      extractionMethod: null,
      // Migrating a platform into itself is never what the user wants.
      ...(targetPlatform === platform ? { targetPlatform: null } : {}),
    });
    void setPreference("lastSourcePlatform", platform).catch(() => {});
  },

  setTargetPlatform: (platform) => {
    const { sourcePlatform, deliveryMode } = get();
    if (platform === sourcePlatform) return;
    const modes = supportedModesForTarget(platform);
    set({
      targetPlatform: platform,
      ...(deliveryMode && !modes.includes(deliveryMode)
        ? { deliveryMode: modes[0] ?? null }
        : {}),
    });
    void setPreference("lastTargetPlatform", platform).catch(() => {});
  },

  setExtractionMethod: (method) => {
    set({ extractionMethod: method });
  },

  setManifestId: (id) => {
    set({ manifestId: id });
  },

  setSelectedWorkspaceIds: (ids) => {
    set({ selectedWorkspaceIds: ids });
  },

  toggleWorkspace: (id) => {
    const { selectedWorkspaceIds } = get();
    const next = selectedWorkspaceIds.includes(id)
      ? selectedWorkspaceIds.filter((wid) => wid !== id)
      : [...selectedWorkspaceIds, id];
    set({ selectedWorkspaceIds: next });
  },

  setEditingWorkspaceId: (id) => {
    set({ editingWorkspaceId: id });
  },

  setDeliveryMode: (mode) => {
    set({ deliveryMode: mode });
  },

  setReviewedManifestId: (id) => {
    set({ reviewedManifestId: id });
  },

  reset: () => {
    set({
      ...createInitialState(),
      editingWorkspaceId: null,
      pendingResume: null,
      resumeChecked: true,
      migrationStartedAt: null,
      resumedMigration: false,
      reviewedManifestId: null,
    });
    cancelOrchestrator();
    clearMigrationHistory().catch(console.error);
  },

  checkForResume: async () => {
    try {
      const data = await resume();
      if (data && RESUMABLE_PHASES.includes(data.state.phase)) {
        set({ pendingResume: data, resumeChecked: true });
        return;
      }

      // Nothing worth resuming: load saved platforms for repeat migrations
      const [savedSource, savedTarget] = await Promise.all([
        getPreference("lastSourcePlatform"),
        getPreference("lastTargetPlatform"),
      ]);
      const source = savedSource ?? null;
      const target = savedTarget && savedTarget !== source ? savedTarget : null;
      set({
        pendingResume: null,
        resumeChecked: true,
        sourcePlatform: source,
        targetPlatform: target,
      });
    } catch (err) {
      console.warn("[PortSmith] Could not check for a previous migration:", err);
      set({ pendingResume: null, resumeChecked: true });
    }
  },

  acceptResume: () => {
    const { pendingResume } = get();
    if (!pendingResume) return;
    const snapshot = pendingResume.state;
    const migrating =
      snapshot.phase === "migrating" || snapshot.phase === "verification";
    set({
      ...snapshot,
      // The editor needs a workspace id that isn't persisted; reopen Review.
      phase: snapshot.phase === "editing" ? "review" : snapshot.phase,
      pendingResume: null,
      resumedMigration: migrating,
    });
  },

  declineResume: async () => {
    set({ pendingResume: null, resumedMigration: false });
    cancelOrchestrator();
    await clearMigrationHistory();
  },
}));

// Auto-checkpoint on phase changes. The service worker owns checkpoints
// while migrating (it knows which workspaces are done); writing one here
// with workspace index 0 used to make a resumed run start over.
useMigrationStore.subscribe((state, prevState) => {
  // Track migration start time
  if (state.phase === "migrating" && prevState.phase !== "migrating") {
    useMigrationStore.setState({ migrationStartedAt: Date.now() });
  }

  if (state.phase !== prevState.phase) {
    // "complete" is left alone: the service worker's final checkpoint keeps
    // the results for the summary page, and it is never offered for resume.
    if (state.phase === "mode_selection" && prevState.phase === "migrating") {
      useMigrationStore.setState({ resumedMigration: false });
    }
    if (PANEL_CHECKPOINT_PHASES.includes(state.phase)) {
      const step = phaseToStep(state.phase);
      checkpoint(snapshotFromState(state), 0, step).catch(console.error);
    }
    return;
  }
  // Persist workspace selection changes during review
  if (
    state.phase === "review" &&
    state.selectedWorkspaceIds !== prevState.selectedWorkspaceIds
  ) {
    checkpoint(snapshotFromState(state), 0, phaseToStep(state.phase)).catch(
      console.error,
    );
  }
});
