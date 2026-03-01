import { useState, useEffect, useCallback, useRef } from "react";
import { useMigrationStore } from "../store/migration-store";
import { loadManifest, saveManifest } from "@/core/storage/indexed-db";
import { safeParseWorkspace } from "@/core/schema/validate";
import type {
  PortsmithManifest,
  Workspace,
  MemoryItem,
} from "@/core/schema/types";
import InstructionDiff from "../components/InstructionDiff";
import FileList from "../components/FileList";
import CapabilityMap from "../components/CapabilityMap";

export default function WorkspaceEditor(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const editingWorkspaceId = useMigrationStore((s) => s.editingWorkspaceId);
  const prevStep = useMigrationStore((s) => s.prevStep);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [relatedMemory, setRelatedMemory] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable state
  const [translatedInstructions, setTranslatedInstructions] = useState("");
  const [excludedFileIds, setExcludedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Track initial translated value to detect changes
  const initialTranslatedRef = useRef("");

  // ─── Load workspace from manifest ─────────────────────────

  useEffect(() => {
    if (!manifestId || !editingWorkspaceId) {
      setError("No workspace selected for editing.");
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

        const ws = record.data.workspaces.find(
          (w) => w.id === editingWorkspaceId,
        );
        if (!ws) {
          setError("Workspace not found in manifest.");
          setLoading(false);
          return;
        }

        setManifest(record.data);
        setWorkspace(ws);

        const translated =
          ws.instructions.translated?.["claude"] ?? ws.instructions.raw;
        setTranslatedInstructions(translated);
        initialTranslatedRef.current = translated;

        // Filter memory items related to this workspace
        setRelatedMemory(
          record.data.memory.filter((m) =>
            m.workspaceIds.includes(editingWorkspaceId),
          ),
        );

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
  }, [manifestId, editingWorkspaceId]);

  // ─── Track dirty state ──────────────────────────────────────

  useEffect(() => {
    const instructionsChanged =
      translatedInstructions !== initialTranslatedRef.current;
    const filesChanged = excludedFileIds.size > 0;
    setDirty(instructionsChanged || filesChanged);
  }, [translatedInstructions, excludedFileIds]);

  // ─── Handlers ──────────────────────────────────────────────

  const handleTranslatedChange = useCallback((value: string) => {
    setTranslatedInstructions(value);
    setSaveSuccess(false);
  }, []);

  const handleFileToggle = useCallback((fileId: string) => {
    setExcludedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
    setSaveSuccess(false);
  }, []);

  const handleBack = useCallback(() => {
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard and go back?",
      );
      if (!confirmed) return;
    }
    prevStep();
  }, [dirty, prevStep]);

  const handleSave = useCallback(async () => {
    if (!manifest || !workspace || !manifestId) return;

    setSaving(true);
    setSaveError(null);

    // Build updated workspace
    const updatedWorkspace: Workspace = {
      ...workspace,
      instructions: {
        ...workspace.instructions,
        translated: {
          ...workspace.instructions.translated,
          claude: translatedInstructions,
        },
      },
      knowledgeFiles: workspace.knowledgeFiles.filter(
        (f) => !excludedFileIds.has(f.id),
      ),
    };

    // Validate against Zod schema
    const result = safeParseWorkspace(updatedWorkspace);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      setSaveError(`Validation failed: ${issues}`);
      setSaving(false);
      return;
    }

    // Replace workspace in manifest and save
    const updatedManifest: PortsmithManifest = {
      ...manifest,
      workspaces: manifest.workspaces.map((w) =>
        w.id === workspace.id ? result.data : w,
      ),
    };

    try {
      await saveManifest(manifestId, updatedManifest);
      setManifest(updatedManifest);
      setWorkspace(result.data);
      initialTranslatedRef.current = translatedInstructions;
      setExcludedFileIds(new Set());
      setDirty(false);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [manifest, workspace, manifestId, translatedInstructions, excludedFileIds]);

  // ─── Loading ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading workspace...</p>
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────

  if (error || !workspace) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {error ?? "Workspace not found."}
          </p>
        </div>
        <button
          onClick={prevStep}
          className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Back to Review
        </button>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col">
      {/* Header with back + save */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Review
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
            dirty && !saving
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-gray-200 text-gray-400"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Workspace name */}
      <h2 className="mt-3 text-lg font-semibold text-gray-900">
        {workspace.name}
      </h2>
      {workspace.description && (
        <p className="mt-0.5 text-sm text-gray-500">{workspace.description}</p>
      )}

      {/* Save feedback */}
      {saveError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{saveError}</p>
        </div>
      )}
      {saveSuccess && (
        <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <p className="text-xs text-green-700">Changes saved.</p>
        </div>
      )}

      {/* Instructions */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-700">Instructions</h3>
        <div className="mt-2">
          <InstructionDiff
            original={workspace.instructions.raw}
            translated={translatedInstructions}
            onTranslatedChange={handleTranslatedChange}
          />
        </div>
      </section>

      {/* Knowledge Files */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-700">
          Knowledge Files ({workspace.knowledgeFiles.length})
        </h3>
        <div className="mt-2">
          <FileList
            files={workspace.knowledgeFiles}
            excludedIds={excludedFileIds}
            onToggle={handleFileToggle}
          />
        </div>
      </section>

      {/* Capabilities */}
      {workspace.capabilities.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Capabilities ({workspace.capabilities.length})
          </h3>
          <div className="mt-2">
            <CapabilityMap capabilities={workspace.capabilities} />
          </div>
        </section>
      )}

      {/* Related memory */}
      {relatedMemory.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Related Memory ({relatedMemory.length})
          </h3>
          <div className="mt-2 space-y-1.5">
            {relatedMemory.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-gray-200 px-3 py-2"
              >
                <p className="text-sm text-gray-700">{item.fact}</p>
                <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {item.category}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Manual steps */}
      {workspace.migration.manualStepsRequired.length > 0 && (
        <section className="mt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Manual Steps Required
          </h3>
          <ul className="mt-2 space-y-1">
            {workspace.migration.manualStepsRequired.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-600">
                <span className="shrink-0 text-gray-400">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Bottom spacing */}
      <div className="pb-4" />
    </div>
  );
}
