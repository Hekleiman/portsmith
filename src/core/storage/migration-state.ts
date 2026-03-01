import {
  type MigrationPhase,
  type MigrationStateSnapshot,
  type ExtractionMethod,
  type DeliveryMode,
  saveCheckpoint,
  loadLatestCheckpoint,
  clearCheckpoints,
} from "./indexed-db";

export type { MigrationPhase, MigrationStateSnapshot, ExtractionMethod, DeliveryMode };

// ─── Factory ─────────────────────────────────────────────────

export function createInitialState(): MigrationStateSnapshot {
  return {
    phase: "idle",
    sourcePlatform: null,
    targetPlatform: null,
    extractionMethod: null,
    deliveryMode: null,
    manifestId: null,
    selectedWorkspaceIds: [],
    completedWorkspaceIds: [],
    errors: [],
  };
}

// ─── Checkpoint persistence ──────────────────────────────────

export async function checkpoint(
  state: MigrationStateSnapshot,
  workspaceIndex: number,
  stepIndex: number,
): Promise<string> {
  return saveCheckpoint(state, workspaceIndex, stepIndex);
}

export async function resume(): Promise<{
  state: MigrationStateSnapshot;
  workspaceIndex: number;
  stepIndex: number;
} | null> {
  const record = await loadLatestCheckpoint();
  if (!record) return null;
  return {
    state: record.migrationState,
    workspaceIndex: record.workspaceIndex,
    stepIndex: record.stepIndex,
  };
}

export async function clearMigrationHistory(): Promise<void> {
  await clearCheckpoints();
}
