import { useState, useEffect, useCallback, useMemo } from "react";
import type { PortsmithManifest } from "@/core/schema/types";
import type { ImportStep } from "@/core/adapters/claude-adapter";
import {
  generateInstructions,
  generateMemoryInstructions,
} from "@/core/adapters/claude-adapter";
import { loadManifest } from "@/core/storage/indexed-db";
import { useMigrationStore } from "../store/migration-store";
import StepCard from "./StepCard";

// ─── Persistence helpers ────────────────────────────────────

const STORAGE_KEY = "portsmith_guided_progress";

async function loadProgress(): Promise<Set<string>> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const arr = result[STORAGE_KEY] as string[] | undefined;
    return new Set(arr ?? []);
  } catch {
    return new Set();
  }
}

async function saveProgress(ids: Set<string>): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [...ids] });
  } catch {
    // Not in extension context
  }
}

async function clearProgress(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // Not in extension context
  }
}

// ─── Section type ───────────────────────────────────────────

interface StepSection {
  label: string;
  workspaceId?: string;
  steps: ImportStep[];
}

// ─── Component ──────────────────────────────────────────────

export default function GuidedMigration(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore(
    (s) => s.selectedWorkspaceIds,
  );
  const goToStep = useMigrationStore((s) => s.goToStep);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [currentIdx, setCurrentIdx] = useState(0);

  // Load manifest and persisted progress
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!manifestId) {
        setLoading(false);
        return;
      }
      const [record, progress] = await Promise.all([
        loadManifest(manifestId),
        loadProgress(),
      ]);
      if (cancelled) return;
      if (record) setManifest(record.data);
      setCompletedIds(progress);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [manifestId]);

  // Build flat list of all steps grouped by section
  const sections: StepSection[] = useMemo(() => {
    if (!manifest) return [];

    const result: StepSection[] = [];

    // Workspace sections
    const selected = manifest.workspaces.filter((ws) =>
      selectedWorkspaceIds.includes(ws.id),
    );
    for (const ws of selected) {
      const inst = generateInstructions(ws);
      result.push({
        label: inst.workspaceName,
        workspaceId: inst.workspaceId,
        steps: inst.steps,
      });
    }

    // Memory section
    const memorySteps = generateMemoryInstructions(manifest.memory);
    if (memorySteps.length > 0) {
      result.push({ label: "Memory", steps: memorySteps });
    }

    return result;
  }, [manifest, selectedWorkspaceIds]);

  // Flat step list for navigation
  const allSteps = useMemo(
    () => sections.flatMap((s) => s.steps),
    [sections],
  );

  // Toggle step completion
  const toggleStep = useCallback(
    (stepId: string) => {
      setCompletedIds((prev) => {
        const next = new Set(prev);
        if (next.has(stepId)) {
          next.delete(stepId);
        } else {
          next.add(stepId);
        }
        void saveProgress(next);
        return next;
      });
    },
    [],
  );

  // Navigation
  const goNext = useCallback(() => {
    setCurrentIdx((i) => Math.min(i + 1, allSteps.length - 1));
  }, [allSteps.length]);

  const goPrev = useCallback(() => {
    setCurrentIdx((i) => Math.max(i - 1, 0));
  }, []);

  // Finish migration
  const finishMigration = useCallback(() => {
    void clearProgress();
    goToStep("complete");
  }, [goToStep]);

  // Derive current section label
  const currentSectionLabel = useMemo(() => {
    let count = 0;
    for (const section of sections) {
      count += section.steps.length;
      if (currentIdx < count) return section.label;
    }
    return "";
  }, [sections, currentIdx]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading instructions...</p>
      </div>
    );
  }

  if (allSteps.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-sm text-gray-500">No steps to display.</p>
      </div>
    );
  }

  const currentStep = allSteps[currentIdx]!;

  const totalDone = allSteps.filter((s) => completedIds.has(s.id)).length;
  const allDone = totalDone === allSteps.length;
  const progressPct = Math.round((totalDone / allSteps.length) * 100);

  return (
    <div className="flex flex-col gap-3">
      {/* Progress header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Guided Migration
          </h2>
          <span className="text-xs text-gray-500">
            {totalDone}/{allSteps.length} done
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-green-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Current section label */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          {currentSectionLabel}
        </span>
        <span className="text-[11px] text-gray-400">
          Step {currentIdx + 1} of {allSteps.length}
        </span>
      </div>

      {/* Current step */}
      <StepCard
        step={currentStep}
        stepNumber={currentIdx + 1}
        done={completedIds.has(currentStep.id)}
        onToggleDone={() => toggleStep(currentStep.id)}
      />

      {/* Navigation */}
      <div className="flex justify-between pt-1">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentIdx === 0}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            currentIdx === 0
              ? "invisible"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          Back
        </button>

        {currentIdx < allSteps.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Next Step
          </button>
        ) : (
          <button
            type="button"
            onClick={finishMigration}
            disabled={!allDone}
            className={`rounded-lg px-6 py-2 text-sm font-medium text-white ${
              allDone
                ? "bg-green-600 hover:bg-green-700"
                : "cursor-not-allowed bg-green-300"
            }`}
          >
            Complete Migration
          </button>
        )}
      </div>
    </div>
  );
}
