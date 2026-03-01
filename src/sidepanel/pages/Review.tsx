import { useState, useEffect, useCallback } from "react";
import { useMigrationStore } from "../store/migration-store";
import { loadManifest } from "@/core/storage/indexed-db";
import type { PortsmithManifest } from "@/core/schema/types";
import WorkspaceCard from "../components/WorkspaceCard";
import MemoryList from "../components/MemoryList";

export default function Review(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedIds = useMigrationStore((s) => s.selectedWorkspaceIds);
  const setSelectedWorkspaceIds = useMigrationStore(
    (s) => s.setSelectedWorkspaceIds,
  );
  const toggleWorkspace = useMigrationStore((s) => s.toggleWorkspace);
  const setEditingWorkspaceId = useMigrationStore(
    (s) => s.setEditingWorkspaceId,
  );
  const goToStep = useMigrationStore((s) => s.goToStep);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load manifest from IndexedDB
  useEffect(() => {
    if (!manifestId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    loadManifest(manifestId)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setError("Manifest not found. Please go back and re-extract.");
          setLoading(false);
          return;
        }
        setManifest(record.data);

        // Initialize selection with all workspace IDs if not already set
        // (preserve existing selection on resume)
        if (selectedIds.length === 0 && record.data.workspaces.length > 0) {
          setSelectedWorkspaceIds(record.data.workspaces.map((w) => w.id));
        }

        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Only run on mount / manifestId change — not when selectedIds changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestId, setSelectedWorkspaceIds]);

  const handleEdit = useCallback(
    (workspaceId: string) => {
      setEditingWorkspaceId(workspaceId);
      goToStep("editing");
    },
    [setEditingWorkspaceId, goToStep],
  );

  // ─── Loading ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading manifest...</p>
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  // ─── Empty manifest ──────────────────────────────────────

  if (!manifest || manifest.workspaces.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <svg
            className="h-6 w-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-2.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          No Workspaces Found
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          The extraction didn't find any Custom GPTs to migrate. Try using a
          different extraction method.
        </p>
      </div>
    );
  }

  // ─── Stats ───────────────────────────────────────────────

  const totalFiles = manifest.workspaces.reduce(
    (sum, w) => sum + w.knowledgeFiles.length,
    0,
  );

  const allWarnings = manifest.workspaces.flatMap((w) =>
    w.migration.warnings.map((msg) => ({ workspace: w.name, msg })),
  );

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-semibold text-gray-900">
        Review Extracted Data
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Toggle workspaces to include or exclude from migration.
      </p>

      {/* Summary stats */}
      <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
        <p className="text-sm text-gray-600">
          Found{" "}
          <span className="font-medium text-gray-900">
            {manifest.workspaces.length} workspace
            {manifest.workspaces.length !== 1 ? "s" : ""}
          </span>
          , {" "}
          <span className="font-medium text-gray-900">
            {manifest.memory.length} memory item
            {manifest.memory.length !== 1 ? "s" : ""}
          </span>
          , {" "}
          <span className="font-medium text-gray-900">
            {totalFiles} file{totalFiles !== 1 ? "s" : ""}
          </span>
        </p>
      </div>

      {/* Workspaces */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-700">Workspaces</h3>
        <div className="mt-2 space-y-2">
          {manifest.workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              accepted={selectedIds.includes(ws.id)}
              onToggle={() => toggleWorkspace(ws.id)}
              onEdit={() => handleEdit(ws.id)}
            />
          ))}
        </div>
      </section>

      {/* Memory items */}
      {manifest.memory.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Memory Items ({manifest.memory.length})
          </h3>
          <div className="mt-2">
            <MemoryList items={manifest.memory} />
          </div>
        </section>
      )}

      {/* Global instructions */}
      {manifest.globalInstructions.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Custom Instructions
          </h3>
          <div className="mt-2 rounded-lg border border-gray-200 p-3">
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-gray-600">
              {manifest.globalInstructions}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">
              {manifest.globalInstructions.length} characters
            </p>
          </div>
        </section>
      )}

      {/* Aggregated warnings */}
      {allWarnings.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Warnings ({allWarnings.length})
          </h3>
          <div className="mt-2 space-y-1.5">
            {allWarnings.map((w, i) => (
              <div
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <p className="text-xs font-medium text-amber-800">
                  {w.workspace}
                </p>
                <p className="text-xs text-amber-700">{w.msg}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Bottom spacing for scroll */}
      <div className="pb-2" />
    </div>
  );
}
