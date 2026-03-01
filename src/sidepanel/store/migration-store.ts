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
      return state.targetPlatform !== null;
    case "extraction_method":
      return state.extractionMethod !== null;
    case "extracting":
      return state.manifestId !== null;
    case "review":
    case "editing":
      return state.selectedWorkspaceIds.length > 0;
    case "mode_selection":
      return state.deliveryMode !== null;
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

  nextStep: () => {
    const { phase } = get();

    // Setup sub-phase navigation
    if (phase === "idle" || phase === "source_selection") {
      set({ phase: "target_selection" });
      return;
    }
    if (phase === "target_selection") {
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
    set({ sourcePlatform: platform });
  },

  setTargetPlatform: (platform) => {
    set({ targetPlatform: platform });
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

  reset: () => {
    set({
      ...createInitialState(),
      editingWorkspaceId: null,
      pendingResume: null,
      resumeChecked: true,
      migrationStartedAt: null,
    });
    clearMigrationHistory().catch(console.error);
  },

  checkForResume: async () => {
    const data = await resume();
    set({ pendingResume: data, resumeChecked: true });
  },

  acceptResume: () => {
    const { pendingResume } = get();
    if (pendingResume) {
      set({ ...pendingResume.state, pendingResume: null });
    }
  },

  declineResume: async () => {
    set({ pendingResume: null });
    await clearMigrationHistory();
  },
}));

// Auto-checkpoint on every phase change (except idle)
useMigrationStore.subscribe((state, prevState) => {
  // Track migration start time
  if (state.phase === "migrating" && prevState.phase !== "migrating") {
    useMigrationStore.setState({ migrationStartedAt: Date.now() });
  }

  if (state.phase !== prevState.phase && state.phase !== "idle") {
    const step = phaseToStep(state.phase);
    checkpoint(snapshotFromState(state), 0, step).catch(console.error);
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
