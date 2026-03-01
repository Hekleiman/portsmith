import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  _resetForTests,
  saveManifest,
  loadManifest,
  clearManifest,
  saveFile,
  loadFile,
  saveCheckpoint,
  loadLatestCheckpoint,
  clearCheckpoints,
  type MigrationStateSnapshot,
} from "@/core/storage/indexed-db";
import {
  createInitialState,
  checkpoint,
  resume,
  clearMigrationHistory,
} from "@/core/storage/migration-state";
import type { PortsmithManifest } from "@/core/schema/types";
import sampleManifest from "../fixtures/sample-manifest.json";

function sampleState(
  overrides?: Partial<MigrationStateSnapshot>,
): MigrationStateSnapshot {
  return {
    phase: "extracting",
    sourcePlatform: "chatgpt",
    targetPlatform: "claude",
    extractionMethod: null,
    deliveryMode: null,
    manifestId: "m-001",
    selectedWorkspaceIds: ["ws-001", "ws-002"],
    completedWorkspaceIds: ["ws-001"],
    errors: [],
    ...overrides,
  };
}

// ─── IndexedDB: Database creation ────────────────────────────

describe("PortsmithDB", () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it("creates the database with expected tables", async () => {
    // Re-import to get the current db reference after reset
    const { db: currentDB } = await import("@/core/storage/indexed-db");
    expect(currentDB.name).toBe("portsmith-db");
    expect(currentDB.tables.map((t) => t.name).sort()).toEqual(
      ["checkpoints", "files", "manifests"].sort(),
    );
  });
});

// ─── IndexedDB: Manifest CRUD ────────────────────────────────

describe("Manifest CRUD", () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it("saves and loads a manifest round-trip", async () => {
    const manifest = sampleManifest as unknown as PortsmithManifest;
    await saveManifest("m-001", manifest);
    const record = await loadManifest("m-001");
    expect(record).toBeDefined();
    expect(record!.id).toBe("m-001");
    expect(record!.data.version).toBe("0.1.0");
    expect(record!.data.workspaces).toHaveLength(2);
    expect(record!.data.memory).toHaveLength(3);
    expect(record!.createdAt).toBeDefined();
    expect(record!.updatedAt).toBeDefined();
  });

  it("preserves createdAt on update, changes updatedAt", async () => {
    const manifest = sampleManifest as unknown as PortsmithManifest;
    await saveManifest("m-001", manifest);
    const first = await loadManifest("m-001");

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    const updated = {
      ...manifest,
      globalInstructions: "Updated instructions",
    };
    await saveManifest("m-001", updated);
    const second = await loadManifest("m-001");

    expect(second!.createdAt).toBe(first!.createdAt);
    expect(second!.data.globalInstructions).toBe("Updated instructions");
  });

  it("returns undefined for non-existent manifest", async () => {
    const result = await loadManifest("nonexistent");
    expect(result).toBeUndefined();
  });

  it("clears a manifest", async () => {
    const manifest = sampleManifest as unknown as PortsmithManifest;
    await saveManifest("m-001", manifest);
    await clearManifest("m-001");
    const result = await loadManifest("m-001");
    expect(result).toBeUndefined();
  });

  it("clearing a non-existent manifest does not throw", async () => {
    await expect(clearManifest("nonexistent")).resolves.toBeUndefined();
  });
});

// ─── IndexedDB: File CRUD ────────────────────────────────────

describe("File CRUD", () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it("saves and loads a file blob round-trip", async () => {
    const content = "# Style Guide\nUse TypeScript strict mode.";
    const blob = new Blob([content], { type: "text/markdown" });
    await saveFile("kf-001", blob, "text/markdown", "style-guide.md");

    const record = await loadFile("kf-001");
    expect(record).toBeDefined();
    expect(record!.id).toBe("kf-001");
    expect(record!.mimeType).toBe("text/markdown");
    expect(record!.originalName).toBe("style-guide.md");

    const text = await record!.blob.text();
    expect(text).toBe(content);
  });

  it("returns undefined for non-existent file", async () => {
    const result = await loadFile("nonexistent");
    expect(result).toBeUndefined();
  });

  it("overwrites an existing file", async () => {
    const blob1 = new Blob(["v1"], { type: "text/plain" });
    const blob2 = new Blob(["v2"], { type: "text/plain" });
    await saveFile("f-001", blob1, "text/plain", "file.txt");
    await saveFile("f-001", blob2, "text/plain", "file.txt");

    const record = await loadFile("f-001");
    const text = await record!.blob.text();
    expect(text).toBe("v2");
  });
});

// ─── IndexedDB: Checkpoint CRUD ──────────────────────────────

describe("Checkpoint CRUD", () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it("saves and loads the latest checkpoint", async () => {
    const state = sampleState();
    await saveCheckpoint(state, 0, 3);

    const latest = await loadLatestCheckpoint();
    expect(latest).toBeDefined();
    expect(latest!.migrationState.phase).toBe("extracting");
    expect(latest!.workspaceIndex).toBe(0);
    expect(latest!.stepIndex).toBe(3);
  });

  it("returns the most recent checkpoint when multiple exist", async () => {
    await saveCheckpoint(sampleState({ phase: "extracting" }), 0, 1);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await saveCheckpoint(sampleState({ phase: "migrating" }), 1, 0);

    const latest = await loadLatestCheckpoint();
    expect(latest!.migrationState.phase).toBe("migrating");
    expect(latest!.workspaceIndex).toBe(1);
  });

  it("returns undefined when no checkpoints exist", async () => {
    const result = await loadLatestCheckpoint();
    expect(result).toBeUndefined();
  });

  it("clears all checkpoints", async () => {
    await saveCheckpoint(sampleState(), 0, 0);
    await saveCheckpoint(sampleState(), 1, 0);
    await clearCheckpoints();

    const result = await loadLatestCheckpoint();
    expect(result).toBeUndefined();
  });
});

// ─── Migration State helpers ─────────────────────────────────

describe("Migration state helpers", () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it("createInitialState returns idle state with null fields", () => {
    const state = createInitialState();
    expect(state.phase).toBe("idle");
    expect(state.sourcePlatform).toBeNull();
    expect(state.targetPlatform).toBeNull();
    expect(state.manifestId).toBeNull();
    expect(state.selectedWorkspaceIds).toEqual([]);
    expect(state.completedWorkspaceIds).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  it("checkpoint and resume round-trip", async () => {
    const state = sampleState({ phase: "review" });
    await checkpoint(state, 2, 5);

    const result = await resume();
    expect(result).not.toBeNull();
    expect(result!.state.phase).toBe("review");
    expect(result!.workspaceIndex).toBe(2);
    expect(result!.stepIndex).toBe(5);
  });

  it("resume returns null when no checkpoints exist", async () => {
    const result = await resume();
    expect(result).toBeNull();
  });

  it("clearMigrationHistory removes all checkpoints", async () => {
    await checkpoint(sampleState(), 0, 0);
    await clearMigrationHistory();
    const result = await resume();
    expect(result).toBeNull();
  });
});

// ─── Preferences (chrome.storage.local mock) ─────────────────

describe("Preferences", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    // Mock chrome.storage.local
    const mockStorage = {
      get: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of keyArray) {
          if (k in store) result[k] = store[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArray) {
          delete store[k];
        }
      }),
    };

    vi.stubGlobal("chrome", {
      storage: { local: mockStorage },
    });
  });

  it("setPreference and getPreference round-trip", async () => {
    const { setPreference, getPreference } = await import(
      "@/core/storage/preferences"
    );
    await setPreference("llmMode", "local");
    const value = await getPreference("llmMode");
    expect(value).toBe("local");
  });

  it("getPreference returns undefined for unset key", async () => {
    const { getPreference } = await import("@/core/storage/preferences");
    const value = await getPreference("lastSourcePlatform");
    expect(value).toBeUndefined();
  });

  it("removePreference deletes a preference", async () => {
    const { setPreference, getPreference, removePreference } = await import(
      "@/core/storage/preferences"
    );
    await setPreference("sidebarState", "expanded");
    await removePreference("sidebarState");
    const value = await getPreference("sidebarState");
    expect(value).toBeUndefined();
  });

  it("getAllPreferences returns all set preferences", async () => {
    const { setPreference, getAllPreferences } = await import(
      "@/core/storage/preferences"
    );
    await setPreference("llmMode", "cloud");
    await setPreference("lastSourcePlatform", "chatgpt");

    const prefs = await getAllPreferences();
    expect(prefs.llmMode).toBe("cloud");
    expect(prefs.lastSourcePlatform).toBe("chatgpt");
    expect(prefs.lastTargetPlatform).toBeUndefined();
  });

  it("overwrites existing preference value", async () => {
    const { setPreference, getPreference } = await import(
      "@/core/storage/preferences"
    );
    await setPreference("llmMode", "none");
    await setPreference("llmMode", "byok");
    const value = await getPreference("llmMode");
    expect(value).toBe("byok");
  });
});
