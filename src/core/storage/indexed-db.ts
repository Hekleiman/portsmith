import Dexie, { type EntityTable } from "dexie";
import type { PortsmithManifest } from "@/core/schema/types";

// ─── Record Types ────────────────────────────────────────────

export interface ManifestRecord {
  id: string;
  data: PortsmithManifest;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  /** Base64-encoded file content. String (not Blob) for message serialization. */
  blob: string;
  mimeType: string;
  originalName: string;
}

export interface CheckpointRecord {
  id: string;
  migrationState: MigrationStateSnapshot;
  timestamp: string;
  workspaceIndex: number;
  stepIndex: number;
}

/** Snapshot of migration state persisted in a checkpoint. */
export interface MigrationStateSnapshot {
  phase: MigrationPhase;
  sourcePlatform: string | null;
  targetPlatform: string | null;
  extractionMethod: ExtractionMethod | null;
  deliveryMode: DeliveryMode | null;
  manifestId: string | null;
  selectedWorkspaceIds: string[];
  completedWorkspaceIds: string[];
  errors: string[];
  /** Per-workspace tracking of how instructions were delivered */
  instructionsDelivery?: Record<
    string,
    "autofilled" | "clipboard" | "manual" | "none" | "pending"
  >;
  /** Results so far, so a resumed run can report them accurately */
  failedWorkspaces?: Array<{ id: string; name: string; error: string }>;
  manualWorkspaces?: Array<{ id: string; name: string; reason: string }>;
  verifiedWorkspaceIds?: string[];
  /**
   * Workspaces that already exist on the target. A resumed run never
   * creates these again, even if the previous run stopped part way through.
   */
  createdWorkspaceIds?: string[];
  /** Things that still need the user, per workspace */
  followUps?: Record<string, string[]>;
  /** Knowledge files that reached the target, per workspace */
  filesDelivered?: Record<string, number>;
  /** Workspaces whose project memory reached the target */
  projectMemoryWorkspaceIds?: string[];
  /** Knowledge to add by hand after the run, per workspace */
  knowledgeLeftovers?: Record<
    string,
    { link: string; fileNames: string[]; projectMemory: boolean }
  >;
  /** Memory items (and "custom-instructions") already saved to the target */
  savedMemoryIds?: string[];
  /** Whether the user finished the memory import steps */
  memoryImported?: boolean;
}

export type MigrationPhase =
  | "idle"
  | "source_selection"
  | "target_selection"
  | "extraction_method"
  | "extracting"
  | "review"
  | "editing"
  | "mode_selection"
  | "migrating"
  | "verification"
  | "complete";

export type ExtractionMethod = "upload" | "browser" | "both";

export type DeliveryMode = "autofill" | "guided" | "hybrid";

// ─── Database ────────────────────────────────────────────────

export class PortsmithDB extends Dexie {
  manifests!: EntityTable<ManifestRecord, "id">;
  files!: EntityTable<FileRecord, "id">;
  checkpoints!: EntityTable<CheckpointRecord, "id">;

  constructor() {
    super("portsmith-db");
    this.version(1).stores({
      manifests: "id, createdAt, updatedAt",
      files: "id",
      checkpoints: "id, timestamp, workspaceIndex",
    });
  }
}

export const db = new PortsmithDB();

/**
 * Empty every table (test isolation). Runs as a read-write transaction, so
 * it queues behind writes that are still in flight instead of aborting
 * them the way closing and deleting the database did.
 */
export async function _resetForTests(): Promise<void> {
  await clearAllData();
}

/** Delete everything PortSmith stored in IndexedDB. */
export async function clearAllData(): Promise<void> {
  await db.transaction("rw", db.manifests, db.files, db.checkpoints, async () => {
    await Promise.all([
      db.manifests.clear(),
      db.files.clear(),
      db.checkpoints.clear(),
    ]);
  });
}

export interface StorageSummary {
  manifests: number;
  files: number;
  checkpoints: number;
  /** Rough size of stored file contents, in bytes */
  fileBytes: number;
}

export async function getStorageSummary(): Promise<StorageSummary> {
  const [manifests, checkpoints] = await Promise.all([
    db.manifests.count(),
    db.checkpoints.count(),
  ]);
  // Walk the files one at a time instead of loading every blob at once.
  let files = 0;
  let fileBytes = 0;
  await db.files.each((f) => {
    files++;
    fileBytes += Math.floor((f.blob.length * 3) / 4);
  });
  return { manifests, files, checkpoints, fileBytes };
}

// ─── Manifest CRUD ───────────────────────────────────────────

export async function saveManifest(
  id: string,
  data: PortsmithManifest,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.manifests.get(id);
  await db.manifests.put({
    id,
    data,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function loadManifest(
  id: string,
): Promise<ManifestRecord | undefined> {
  return db.manifests.get(id);
}

export async function clearManifest(id: string): Promise<void> {
  await db.manifests.delete(id);
}

// ─── File CRUD ───────────────────────────────────────────────

export async function saveFile(
  id: string,
  blob: string,
  mimeType: string,
  originalName: string,
): Promise<void> {
  await db.files.put({ id, blob, mimeType, originalName });
}

export async function loadFile(id: string): Promise<FileRecord | undefined> {
  return db.files.get(id);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.files.bulkDelete(ids);
}

/**
 * Delete a manifest and the file contents it references, e.g. once a
 * migration is finished and the user no longer needs the extracted copy.
 */
export async function deleteManifestAndFiles(id: string): Promise<void> {
  const record = await db.manifests.get(id);
  const refs =
    record?.data.workspaces.flatMap((w) =>
      w.knowledgeFiles
        .map((f) => f.contentRef)
        .filter((r): r is string => typeof r === "string"),
    ) ?? [];
  await db.transaction("rw", db.manifests, db.files, async () => {
    await db.manifests.delete(id);
    if (refs.length > 0) await db.files.bulkDelete(refs);
  });
}

// ─── Checkpoint CRUD ────────────────────────────────────────

const MAX_CHECKPOINTS = 20;
let checkpointSeq = 0;

export async function saveCheckpoint(
  state: MigrationStateSnapshot,
  workspaceIndex: number,
  stepIndex: number,
): Promise<string> {
  // Unique even when two contexts write within the same millisecond.
  const id = `ckpt-${Date.now()}-${(checkpointSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db.checkpoints.put({
    id,
    migrationState: state,
    timestamp: new Date().toISOString(),
    workspaceIndex,
    stepIndex,
  });

  // Keep the table small: only recent checkpoints are ever read.
  const count = await db.checkpoints.count();
  if (count > MAX_CHECKPOINTS) {
    const stale = await db.checkpoints
      .orderBy("timestamp")
      .limit(count - MAX_CHECKPOINTS)
      .primaryKeys();
    await db.checkpoints.bulkDelete(stale);
  }
  return id;
}

export async function loadLatestCheckpoint(): Promise<
  CheckpointRecord | undefined
> {
  return db.checkpoints.orderBy("timestamp").last();
}

export async function clearCheckpoints(): Promise<void> {
  await db.checkpoints.clear();
}
