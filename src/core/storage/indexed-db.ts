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
  blob: Blob;
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

// Mutable so tests can reset. Use `db` directly everywhere.
// eslint-disable-next-line import/no-mutable-exports
export let db = new PortsmithDB();

/** Reset the database for test isolation. NOT for production use. */
export async function _resetForTests(): Promise<void> {
  db.close();
  await db.delete();
  db = new PortsmithDB();
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
  blob: Blob,
  mimeType: string,
  originalName: string,
): Promise<void> {
  await db.files.put({ id, blob, mimeType, originalName });
}

export async function loadFile(id: string): Promise<FileRecord | undefined> {
  return db.files.get(id);
}

// ─── Checkpoint CRUD ────────────────────────────────────────

export async function saveCheckpoint(
  state: MigrationStateSnapshot,
  workspaceIndex: number,
  stepIndex: number,
): Promise<string> {
  const id = `ckpt-${Date.now()}`;
  await db.checkpoints.put({
    id,
    migrationState: state,
    timestamp: new Date().toISOString(),
    workspaceIndex,
    stepIndex,
  });
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
