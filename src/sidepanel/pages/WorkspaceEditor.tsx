import { useState, useEffect, useCallback, useRef } from "react";
import { useMigrationStore } from "../store/migration-store";
import { loadManifest, saveManifest } from "@/core/storage/indexed-db";
import { safeParseWorkspace } from "@/core/schema/validate";
import type {
  PortsmithManifest,
  Workspace,
  MemoryItem,
} from "@/core/schema/types";
import {
  getInstructionsForTarget,
  platformLabel,
  withInstructionsForTarget,
} from "@/core/platforms";
import {
  buildManualProjectMemory,
  projectMemoryToEditableText,
} from "@/core/transform/project-memory";
import InstructionDiff from "../components/InstructionDiff";
import FileList from "../components/FileList";
import CapabilityMap from "../components/CapabilityMap";
import ProjectMemoryEditor from "../components/ProjectMemoryEditor";
import ConfirmButton from "../components/ConfirmButton";

export default function WorkspaceEditor(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const editingWorkspaceId = useMigrationStore((s) => s.editingWorkspaceId);
  const targetPlatform = useMigrationStore((s) => s.targetPlatform);
  const prevStep = useMigrationStore((s) => s.prevStep);
  const target = targetPlatform ?? "claude";

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [relatedMemory, setRelatedMemory] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable state
  const [translatedInstructions, setTranslatedInstructions] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [excludedFileIds, setExcludedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Initial values to detect changes
  const initialTranslatedRef = useRef("");
  const initialMemoryRef = useRef("");

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

        const translated = getInstructionsForTarget(ws, target);
        setTranslatedInstructions(translated);
        initialTranslatedRef.current = translated;

        const memory = projectMemoryToEditableText(ws.projectMemory);
        setMemoryText(memory);
        initialMemoryRef.current = memory;

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
  }, [manifestId, editingWorkspaceId, target]);

  const dirty =
    translatedInstructions !== initialTranslatedRef.current ||
    memoryText !== initialMemoryRef.current ||
    excludedFileIds.size > 0;

  // ─── Handlers ──────────────────────────────────────────────

  const handleTranslatedChange = useCallback((value: string) => {
    setTranslatedInstructions(value);
    setSaveSuccess(false);
  }, []);

  const handleMemoryChange = useCallback((value: string) => {
    setMemoryText(value);
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

  const handleSave = useCallback(async () => {
    if (!manifest || !workspace || !manifestId) return;

    setSaving(true);
    setSaveError(null);

    let updated: Workspace = withInstructionsForTarget(
      workspace,
      target,
      translatedInstructions,
    );
    updated = {
      ...updated,
      knowledgeFiles: workspace.knowledgeFiles.filter(
        (f) => !excludedFileIds.has(f.id),
      ),
    };

    if (memoryText !== initialMemoryRef.current) {
      const edited = buildManualProjectMemory(memoryText);
      if (edited && workspace.projectMemory && memoryText.trim()) {
        // Keep the original source label when the user only trimmed notes
        edited.source =
          workspace.projectMemory.source === "manual"
            ? "manual"
            : workspace.projectMemory.source;
      }
      updated = { ...updated, projectMemory: edited ?? undefined };
      if (!edited) delete updated.projectMemory;
    }

    // Validate against Zod schema
    const result = safeParseWorkspace(updated);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      setSaveError(`Couldn't save: ${issues}`);
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
      initialMemoryRef.current = memoryText;
      setExcludedFileIds(new Set());
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [manifest, workspace, manifestId, translatedInstructions, memoryText, excludedFileIds, target]);

  // ─── Loading ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-600" role="status">Loading workspace...</p>
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────

  if (error || !workspace || !manifest) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            {error ?? "Workspace not found."}
          </p>
        </div>
        <button
          type="button"
          onClick={prevStep}
          className="mt-4 text-sm font-medium text-blue-800 hover:text-blue-900"
        >
          Back to Review
        </button>
      </div>
    );
  }

  const sourcePlatform = manifest.source.platform;
  const sourceLabel = platformLabel(sourcePlatform);
  const targetLabel = platformLabel(target);

  const backIcon = (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col">
      {/* Header with back + save */}
      <div className="flex items-center justify-between gap-2">
        {dirty ? (
          <ConfirmButton
            label="← Review"
            question="Discard unsaved changes?"
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            onConfirm={prevStep}
            className="flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
          />
        ) : (
          <button
            type="button"
            onClick={prevStep}
            className="flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
          >
            {backIcon}
            Review
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
            dirty && !saving
              ? "bg-blue-700 text-white hover:bg-blue-800"
              : "cursor-not-allowed bg-gray-200 text-gray-500"
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
        <p className="mt-0.5 text-sm text-gray-600">{workspace.description}</p>
      )}

      {/* Save feedback */}
      {saveError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2" role="alert">
          <p className="text-xs text-red-800">{saveError}</p>
        </div>
      )}
      {saveSuccess && (
        <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2" role="status">
          <p className="text-xs text-green-800">Changes saved.</p>
        </div>
      )}

      {/* Instructions */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-800">Instructions</h3>
        <div className="mt-2">
          <InstructionDiff
            original={workspace.instructions.raw}
            translated={translatedInstructions}
            onTranslatedChange={handleTranslatedChange}
            sourceLabel={sourceLabel}
            targetLabel={targetLabel}
          />
        </div>
      </section>

      {/* Project memory */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-800">Project memory</h3>
        <div className="mt-2">
          <ProjectMemoryEditor
            workspaceName={workspace.name}
            sourcePlatform={sourcePlatform}
            sourceLabel={sourceLabel}
            targetLabel={targetLabel}
            original={workspace.projectMemory}
            value={memoryText}
            onChange={handleMemoryChange}
            sourceUrl={sourcePlatform === "chatgpt" ? "https://chatgpt.com/" : undefined}
          />
        </div>
      </section>

      {/* Knowledge Files */}
      <section className="mt-4">
        <h3 className="text-sm font-medium text-gray-800">
          Knowledge files ({workspace.knowledgeFiles.length})
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
          <h3 className="text-sm font-medium text-gray-800">
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
          <h3 className="text-sm font-medium text-gray-800">
            Related memory ({relatedMemory.length})
          </h3>
          <div className="mt-2 space-y-1.5">
            {relatedMemory.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-gray-200 px-3 py-2"
              >
                <p className="text-sm text-gray-800">{item.fact}</p>
                <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
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
          <h3 className="text-sm font-medium text-gray-800">
            Manual steps required
          </h3>
          <ul className="mt-2 space-y-1">
            {workspace.migration.manualStepsRequired.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="shrink-0 text-gray-600">{i + 1}.</span>
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
