import { useState, useEffect, useCallback, useRef } from "react";
import {
  sendMessage,
  type OrchestratorStatus,
  type AutofillStepStatus,
} from "@/shared/messaging";
import { useMigrationStore } from "../store/migration-store";
import StepCard from "../components/StepCard";
import CopyBlock from "../components/CopyBlock";

// ─── Status Hook ─────────────────────────────────────────────

function useOrchestratorStatus(pollMs = 500): OrchestratorStatus | null {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);

  useEffect(() => {
    let active = true;

    async function poll(): Promise<void> {
      try {
        const s = await sendMessage("MIGRATION_STATUS");
        if (active) setStatus(s);
      } catch {
        // Service worker not available
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollMs]);

  return status;
}

// ─── Step Row ───────────────────────────────────────────────

interface StepRowProps {
  title: string;
  status: AutofillStepStatus;
}

function StepRow({ title, status }: StepRowProps): React.JSX.Element {
  const icon: Record<AutofillStepStatus, string> = {
    pending: "\u25CB",
    running: "\u25CF",
    success: "\u2713",
    failed: "\u2717",
    fallback: "\u26A0",
    skipped: "\u2014",
    clipboard: "\u2398",
    navigate_failed: "\u2717",
  };

  const color: Record<AutofillStepStatus, string> = {
    pending: "text-gray-400",
    running: "text-blue-500 animate-pulse",
    success: "text-green-600",
    failed: "text-red-500",
    fallback: "text-amber-500",
    skipped: "text-gray-300",
    clipboard: "text-blue-500",
    navigate_failed: "text-red-500 animate-pulse",
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-4 text-center text-sm ${color[status]}`}>
        {icon[status]}
      </span>
      <span
        className={`text-xs ${
          status === "skipped" ? "text-gray-300 line-through" : "text-gray-700"
        }`}
      >
        {title}
      </span>
    </div>
  );
}

// ─── Overall Progress ──────────────────────────────────────

interface OverallProgressProps {
  status: OrchestratorStatus;
  overallPct: number;
}

function OverallProgress({
  status,
  overallPct,
}: OverallProgressProps): React.JSX.Element {
  const totalDone = status.completedWorkspaceIds.length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">
          Overall Progress
        </span>
        <span className="text-xs text-gray-400">
          {totalDone}/{status.totalWorkspaces}
        </span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-blue-500 transition-all"
          style={{ width: `${overallPct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export default function Migrate(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore(
    (s) => s.selectedWorkspaceIds,
  );
  const deliveryMode = useMigrationStore((s) => s.deliveryMode);
  const goToStep = useMigrationStore((s) => s.goToStep);

  const status = useOrchestratorStatus();
  const startedRef = useRef(false);

  // Guided mode local state
  const [guidedStepIdx, setGuidedStepIdx] = useState(0);
  const [guidedCompletedIds, setGuidedCompletedIds] = useState<Set<string>>(
    new Set(),
  );

  // Memory mode local state
  const [memoryStepIdx, setMemoryStepIdx] = useState(0);
  const [memoryCompletedIds, setMemoryCompletedIds] = useState<Set<string>>(
    new Set(),
  );

  // Start orchestrator on mount
  useEffect(() => {
    if (startedRef.current) return;
    if (!manifestId || !deliveryMode) return;

    startedRef.current = true;

    async function init(): Promise<void> {
      // Check if already running
      try {
        const current = await sendMessage("MIGRATION_STATUS");
        if (current.phase !== "idle") return;
      } catch {
        // SW not available yet
      }

      // Try resume first (service worker may have restarted)
      try {
        const resumed = await sendMessage("MIGRATION_RESUME");
        if (resumed.success) return;
      } catch {
        // No checkpoint to resume from
      }

      // Start fresh
      await sendMessage("MIGRATION_START", {
        manifestId: manifestId!,
        mode: deliveryMode!,
        workspaceIds: selectedWorkspaceIds,
      });
    }

    void init();
  }, [manifestId, deliveryMode, selectedWorkspaceIds]);

  // Reset guided step navigation when workspace changes
  const prevWsIdx = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (status?.mode !== "guided") return;
    if (
      prevWsIdx.current !== undefined &&
      prevWsIdx.current !== status.currentWorkspaceIndex
    ) {
      setGuidedStepIdx(0);
      setGuidedCompletedIds(new Set());
    }
    prevWsIdx.current = status.currentWorkspaceIndex;
  }, [status?.currentWorkspaceIndex, status?.mode]);

  // ─── Actions ─────────────────────────────────────────────

  const handlePause = useCallback(() => {
    void sendMessage("MIGRATION_PAUSE");
  }, []);

  const handleResume = useCallback(() => {
    void sendMessage("MIGRATION_RESUME");
  }, []);

  const handleCancel = useCallback(() => {
    void sendMessage("MIGRATION_CANCEL");
    goToStep("mode_selection");
  }, [goToStep]);

  const handleConfirm = useCallback((confirmed: boolean) => {
    void sendMessage("MIGRATION_CONFIRM", { confirmed });
  }, []);

  const handleGuidedWorkspaceDone = useCallback((workspaceId: string) => {
    void sendMessage("MIGRATION_WORKSPACE_DONE", { workspaceId });
    setGuidedStepIdx(0);
    setGuidedCompletedIds(new Set());
  }, []);

  const handleMemoryDone = useCallback(() => {
    void sendMessage("MIGRATION_MEMORY_DONE");
  }, []);

  const handleComplete = useCallback(() => {
    goToStep("complete");
  }, [goToStep]);

  const handleConfirmDelivery = useCallback((workspaceId: string) => {
    void sendMessage("MIGRATION_UPDATE_DELIVERY", {
      workspaceId,
      delivery: "manual",
    });
  }, []);

  const toggleGuidedStep = useCallback((stepId: string) => {
    setGuidedCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const toggleMemoryStep = useCallback((stepId: string) => {
    setMemoryCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  // ─── Loading ─────────────────────────────────────────────

  if (!status || status.phase === "idle") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Starting migration...</p>
      </div>
    );
  }

  // ─── Complete ────────────────────────────────────────────

  if (status.phase === "complete") {
    const clipboardWorkspaces = Object.entries(
      status.instructionsDelivery,
    ).filter(([, v]) => v === "clipboard");
    const pendingWorkspaces = Object.entries(
      status.instructionsDelivery,
    ).filter(([, v]) => v === "pending" || v === "none");
    const hasClipboardItems = clipboardWorkspaces.length > 0;

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            hasClipboardItems ? "bg-amber-100" : "bg-green-100"
          }`}
        >
          <span
            className={`text-xl ${
              hasClipboardItems ? "text-amber-600" : "text-green-600"
            }`}
          >
            {hasClipboardItems ? "\u26A0" : "\u2713"}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {hasClipboardItems
              ? "Workspaces processed — instructions pending"
              : "All workspaces processed"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {status.completedWorkspaceIds.length} workspace
            {status.completedWorkspaceIds.length !== 1 ? "s" : ""} migrated to
            Claude.
          </p>
          {hasClipboardItems && (
            <div className="mt-2">
              <p className="text-xs text-amber-600">
                {clipboardWorkspaces.length} workspace
                {clipboardWorkspaces.length !== 1 ? "s" : ""} had instructions
                copied to clipboard — paste them manually.
              </p>
              {clipboardWorkspaces.map(([wsId]) => (
                <div key={wsId} className="mt-2">
                  {status.clipboardInstructions[wsId] && (
                    <CopyBlock
                      label="instructions"
                      content={status.clipboardInstructions[wsId]}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => handleConfirmDelivery(wsId)}
                    className="mt-1.5 rounded-md bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
                  >
                    I've added the instructions
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendingWorkspaces.length > 0 &&
            pendingWorkspaces.some(([, v]) => v === "pending") && (
              <p className="mt-1 text-xs text-amber-600">
                Some workspaces still need instructions entered manually.
              </p>
            )}
          {status.failedWorkspaces.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-amber-600">
                {status.failedWorkspaces.length} workspace
                {status.failedWorkspaces.length !== 1 ? "s" : ""} skipped:
              </p>
              {status.failedWorkspaces.map((f) => (
                <p key={f.id} className="text-xs text-gray-500">
                  {f.name}: {f.error}
                </p>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleComplete}
          className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Complete Migration
        </button>
      </div>
    );
  }

  // ─── Memory Phase ────────────────────────────────────────

  if (status.phase === "memory") {
    const currentStep = status.memorySteps[memoryStepIdx];
    const allDone =
      status.memorySteps.length > 0 &&
      status.memorySteps.every((s) => memoryCompletedIds.has(s.id));

    return (
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Import Memory
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Memory items use guided mode. Follow these steps manually.
          </p>
        </div>

        {currentStep && (
          <StepCard
            step={currentStep}
            stepNumber={memoryStepIdx + 1}
            done={memoryCompletedIds.has(currentStep.id)}
            onToggleDone={() => toggleMemoryStep(currentStep.id)}
          />
        )}

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={() => setMemoryStepIdx((i) => Math.max(i - 1, 0))}
            disabled={memoryStepIdx === 0}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              memoryStepIdx === 0
                ? "invisible"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Back
          </button>

          {memoryStepIdx < status.memorySteps.length - 1 ? (
            <button
              type="button"
              onClick={() =>
                setMemoryStepIdx((i) =>
                  Math.min(i + 1, status.memorySteps.length - 1),
                )
              }
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              onClick={handleMemoryDone}
              disabled={!allDone}
              className={`rounded-lg px-6 py-2 text-sm font-medium text-white ${
                allDone
                  ? "bg-green-600 hover:bg-green-700"
                  : "cursor-not-allowed bg-green-300"
              }`}
            >
              Finish
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Shared Progress ─────────────────────────────────────

  const totalDone = status.completedWorkspaceIds.length;
  const overallPct =
    status.totalWorkspaces > 0
      ? Math.round((totalDone / status.totalWorkspaces) * 100)
      : 0;

  // ─── Paused ──────────────────────────────────────────────

  if (status.phase === "paused") {
    return (
      <div className="flex flex-col gap-3">
        <OverallProgress status={status} overallPct={overallPct} />

        <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-700">
            Migration paused
          </p>
          <p className="text-xs text-amber-600">
            {totalDone} of {status.totalWorkspaces} workspaces completed.
            Resume to continue.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResume}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Running: Guided Mode ────────────────────────────────

  if (status.mode === "guided" && status.guidedInstructions) {
    const steps = status.guidedInstructions.steps;
    const currentStep = steps[guidedStepIdx];
    const allDone =
      steps.length > 0 &&
      steps.every((s) => guidedCompletedIds.has(s.id));

    return (
      <div className="flex flex-col gap-3">
        <OverallProgress status={status} overallPct={overallPct} />

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">
            {status.guidedInstructions.workspaceName}
          </span>
          <span className="text-[11px] text-gray-400">
            Step {guidedStepIdx + 1} of {steps.length}
          </span>
        </div>

        {currentStep && (
          <StepCard
            step={currentStep}
            stepNumber={guidedStepIdx + 1}
            done={guidedCompletedIds.has(currentStep.id)}
            onToggleDone={() => toggleGuidedStep(currentStep.id)}
          />
        )}

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={() => setGuidedStepIdx((i) => Math.max(i - 1, 0))}
            disabled={guidedStepIdx === 0}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              guidedStepIdx === 0
                ? "invisible"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Back
          </button>

          {guidedStepIdx < steps.length - 1 ? (
            <button
              type="button"
              onClick={() =>
                setGuidedStepIdx((i) => Math.min(i + 1, steps.length - 1))
              }
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                handleGuidedWorkspaceDone(
                  status.guidedInstructions!.workspaceId,
                )
              }
              disabled={!allDone}
              className={`rounded-lg px-6 py-2 text-sm font-medium text-white ${
                allDone
                  ? "bg-green-600 hover:bg-green-700"
                  : "cursor-not-allowed bg-green-300"
              }`}
            >
              Workspace Done
            </button>
          )}
        </div>

        <div className="flex justify-center gap-2 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel Migration
          </button>
        </div>
      </div>
    );
  }

  // ─── Running: Autofill / Hybrid ──────────────────────────

  const successCount = status.currentSteps.filter(
    (s) => s.status === "success",
  ).length;
  const stepPct =
    status.currentSteps.length > 0
      ? Math.round((successCount / status.currentSteps.length) * 100)
      : 0;
  const modeLabel = status.mode === "hybrid" ? "Hybrid" : "Autofill";

  return (
    <div className="flex flex-col gap-3">
      <OverallProgress status={status} overallPct={overallPct} />

      {/* Workspace header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {modeLabel} Migration
          </h2>
          <span className="text-xs text-gray-500">
            Workspace {status.currentWorkspaceIndex + 1} of{" "}
            {status.totalWorkspaces}
          </span>
        </div>
        {status.currentWorkspaceName && (
          <p className="mt-0.5 text-sm font-medium text-blue-600">
            {status.currentWorkspaceName}
          </p>
        )}
      </div>

      {/* Step progress bar */}
      {status.currentSteps.length > 0 && (
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-green-500 transition-all"
            style={{ width: `${stepPct}%` }}
          />
        </div>
      )}

      {/* Step list */}
      {status.currentSteps.length > 0 && (
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          {status.currentSteps.map((step) => (
            <div key={step.id}>
              <StepRow title={step.title} status={step.status} />
              {step.status === "fallback" && step.fallback && (
                <div className="mb-2 ml-6 rounded border border-amber-200 bg-amber-50 p-2">
                  <p className="text-[11px] font-medium text-amber-700">
                    Do this manually:
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-600">
                    {step.fallback.description}
                  </p>
                  {step.fallback.link && (
                    <a
                      href={step.fallback.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[11px] font-medium text-blue-600 hover:underline"
                    >
                      {step.fallback.link} &rarr;
                    </a>
                  )}
                  {step.fallback.copyBlocks.map((block) => (
                    <div
                      key={block.label}
                      className="mt-1 rounded bg-white px-2 py-1 text-[11px] text-gray-600"
                    >
                      <span className="font-medium">{block.label}:</span>{" "}
                      <span className="break-all">
                        {block.content.length > 100
                          ? block.content.slice(0, 100) + "..."
                          : block.content}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Per-field status indicators */}
      {status.currentSteps.length > 0 && (
        <div className="rounded-lg border border-gray-100 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-gray-400">
            Field Status
          </p>
          {(
            [
              ["name", "Project name"],
              ["description", "Description"],
              ["instructions", "Instructions"],
            ] as const
          ).map(([field, label]) => {
            const step = status.currentSteps.find((s) =>
              s.id.endsWith(`-${field}`),
            );
            if (!step) return null;
            const isClipboard = step.status === "clipboard";
            return (
              <StepRow
                key={field}
                title={
                  isClipboard ? `${label} (copied to clipboard)` : label
                }
                status={step.status}
              />
            );
          })}
        </div>
      )}

      {/* Clipboard notification for instructions */}
      {(() => {
        const clipboardStep = status.currentSteps.find(
          (s) => s.status === "clipboard",
        );
        if (!clipboardStep) return null;
        // Extract workspace ID from step ID (format: "{wsId}-instructions")
        const clipWsId = Object.entries(status.instructionsDelivery).find(
          ([, v]) => v === "clipboard",
        )?.[0];
        if (!clipWsId) return null;
        return (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-medium text-blue-700">
              Instructions copied to clipboard
            </p>
            <p className="mt-0.5 text-[11px] text-blue-600">
              Paste these into the project instructions field on Claude.
            </p>
            <button
              type="button"
              onClick={() => handleConfirmDelivery(clipWsId)}
              className="mt-2 rounded-md bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
            >
              I've added the instructions
            </button>
          </div>
        );
      })()}

      {/* Always-visible Copy Instructions button when workspace has instructions */}
      {status.currentWorkspaceInstructions && (
        <CopyBlock
          label={`Instructions for ${status.currentWorkspaceName ?? "workspace"}`}
          content={status.currentWorkspaceInstructions}
        />
      )}

      {/* Navigation failed prompt */}
      {status.pendingConfirmStepId &&
        status.currentSteps.find(
          (s) =>
            s.id === status.pendingConfirmStepId &&
            s.status === "navigate_failed",
        ) && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700">
              Could not navigate to Claude
            </p>
            <p className="mt-1 text-xs text-red-600">
              Please open{" "}
              <span className="font-medium">claude.ai/projects</span> in your
              browser tab, then click Retry.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                className="rounded px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirm(true)}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

      {/* Hybrid confirmation buttons */}
      {status.pendingConfirmStepId &&
        !status.currentSteps.find(
          (s) =>
            s.id === status.pendingConfirmStepId &&
            s.status === "navigate_failed",
        ) && (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <span className="text-xs font-medium text-blue-700">
              Ready to execute this step?
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                className="rounded px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => handleConfirm(true)}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                Execute
              </button>
            </div>
          </div>
        )}

      {/* Failed workspace warnings */}
      {status.failedWorkspaces.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-medium text-amber-700">Skipped:</p>
          {status.failedWorkspaces.map((f) => (
            <p key={f.id} className="text-[11px] text-amber-600">
              {f.name}: {f.error}
            </p>
          ))}
        </div>
      )}

      {/* Pause/Cancel controls */}
      <div className="flex justify-center gap-4 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={handlePause}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="text-xs text-gray-400 hover:text-red-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
