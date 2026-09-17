import { useState, useEffect, useCallback, useRef } from "react";
import {
  sendMessage,
  type OrchestratorStatus,
  type MigrationStep,
} from "@/shared/messaging";
import { platformLabel } from "@/core/platforms";
import { loadLatestCheckpoint } from "@/core/storage/indexed-db";
import { useMigrationStore } from "../store/migration-store";
import StepCard from "../components/StepCard";
import CopyBlock from "../components/CopyBlock";
import StepRow from "../components/StepRow";
import ConfirmButton from "../components/ConfirmButton";

// ─── Status Hook ─────────────────────────────────────────────

interface StatusState {
  status: OrchestratorStatus | null;
  /** False after several failed polls (service worker unreachable) */
  connected: boolean;
}

function useOrchestratorStatus(pollMs = 500): StatusState {
  const [state, setState] = useState<StatusState>({
    status: null,
    connected: true,
  });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let failures = 0;

    async function poll(): Promise<void> {
      if (inFlight) return;
      inFlight = true;
      try {
        const s = await sendMessage("MIGRATION_STATUS");
        failures = 0;
        if (active) setState({ status: s, connected: true });
      } catch {
        failures++;
        if (active && failures >= 4) {
          setState((prev) => ({ ...prev, connected: false }));
        }
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollMs]);

  return state;
}

// ─── Overall Progress ──────────────────────────────────────

interface OverallProgressProps {
  status: OrchestratorStatus;
}

function OverallProgress({ status }: OverallProgressProps): React.JSX.Element {
  const handled =
    status.completedWorkspaceIds.length +
    status.failedWorkspaces.length +
    status.manualWorkspaces.length;
  const total = status.totalWorkspaces;
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">
          Overall progress
        </span>
        <span className="text-xs text-gray-600">
          {handled}/{total}
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full rounded-full bg-gray-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={handled}
        aria-label="Workspaces handled"
      >
        <div
          className="h-2 rounded-full bg-blue-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Results lists ─────────────────────────────────────────

function ResultLists({ status }: { status: OrchestratorStatus }): React.JSX.Element | null {
  if (status.failedWorkspaces.length === 0 && status.manualWorkspaces.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2 text-left">
      {status.manualWorkspaces.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-medium text-amber-900">
            Not migrated ({status.manualWorkspaces.length}):
          </p>
          {status.manualWorkspaces.map((w) => (
            <p key={w.id} className="text-[11px] text-amber-900">
              {w.name}: {w.reason}
            </p>
          ))}
        </div>
      )}
      {status.failedWorkspaces.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="text-xs font-medium text-red-800">
            Failed ({status.failedWorkspaces.length}):
          </p>
          {status.failedWorkspaces.map((f) => (
            <p key={f.id} className="text-[11px] text-red-800">
              {f.name}: {f.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pending step (needs the user) ─────────────────────────

interface PendingStepProps {
  step: MigrationStep;
  busy: boolean;
  onAnswer: (confirmed: boolean) => void;
}

function PendingStep({ step, busy, onAnswer }: PendingStepProps): React.JSX.Element {
  const confirmLabel = step.confirmLabel ?? "Continue";
  const skipLabel = step.skipLabel ?? "Skip";

  return (
    <div
      className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
      role="region"
      aria-label="Action needed"
    >
      <p className="text-sm font-medium text-blue-900">{step.title}</p>
      {step.fallback && (
        <StepCard
          step={step.fallback}
          stepNumber={0}
          totalSteps={0}
          done={false}
          onToggleDone={() => {}}
          hideDoneToggle
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className="flex-1 rounded-lg bg-blue-700 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          className="flex-1 rounded-lg bg-white py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {skipLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

export default function Migrate(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore((s) => s.selectedWorkspaceIds);
  const deliveryMode = useMigrationStore((s) => s.deliveryMode);
  const targetPlatform = useMigrationStore((s) => s.targetPlatform);
  const resumedMigration = useMigrationStore((s) => s.resumedMigration);
  const goToStep = useMigrationStore((s) => s.goToStep);
  const setSelectedWorkspaceIds = useMigrationStore((s) => s.setSelectedWorkspaceIds);

  const targetName = platformLabel(targetPlatform);

  const { status, connected } = useOrchestratorStatus();
  const startedRef = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [canRetryStart, setCanRetryStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sawRunRef = useRef(false);

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

  /** Run one request at a time so double clicks can't repeat an action. */
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.warn("[PortSmith] Action failed:", err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const startRun = useCallback(async () => {
    if (!manifestId || !deliveryMode) return;
    setStartError(null);
    setCanRetryStart(true);
    try {
      const current = await sendMessage("MIGRATION_STATUS").catch(() => null);
      const sameManifest = current?.manifestId === manifestId;

      if (current && current.phase !== "idle") {
        if (sameManifest && (current.phase !== "complete" || resumedMigration)) {
          return; // Re-attach to the run the service worker already has
        }
        // Leftover run (another manifest, or a finished one): clear it first
        await sendMessage("MIGRATION_CANCEL");
      }

      if (resumedMigration) {
        const resumed = await sendMessage("MIGRATION_RESUME");
        if (resumed.success) return;
      }

      const started = await sendMessage("MIGRATION_START", {
        manifestId,
        mode: deliveryMode,
        workspaceIds: selectedWorkspaceIds,
        targetPlatform: targetPlatform ?? undefined,
      });
      if (!started.success) {
        setStartError(
          "PortSmith couldn't start the migration. The extracted data may no longer be available. Go back and extract again.",
        );
      }
    } catch (err) {
      setStartError(
        `PortSmith's background worker didn't respond (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }, [manifestId, deliveryMode, selectedWorkspaceIds, targetPlatform, resumedMigration]);

  // Start (or attach to) the run on mount
  useEffect(() => {
    if (startedRef.current) return;
    if (!manifestId || !deliveryMode) return;
    startedRef.current = true;
    void startRun();
  }, [manifestId, deliveryMode, startRun]);

  useEffect(() => {
    if (status && status.phase !== "idle") sawRunRef.current = true;
  }, [status]);

  // Reset guided step navigation when workspace changes
  const prevWsId = useRef<string | undefined>(undefined);
  const currentGuidedId = status?.guidedInstructions?.workspaceId;
  useEffect(() => {
    if (currentGuidedId && prevWsId.current !== currentGuidedId) {
      setGuidedStepIdx(0);
      setGuidedCompletedIds(new Set());
    }
    prevWsId.current = currentGuidedId;
  }, [currentGuidedId]);

  // ─── Actions ─────────────────────────────────────────────

  const handlePause = useCallback(() => {
    void act(() => sendMessage("MIGRATION_PAUSE"));
  }, [act]);

  /**
   * Leave the run and go back to mode selection without the workspaces that
   * already exist on the target, so starting again can't create them twice.
   */
  const leaveRun = useCallback(
    async (created: string[]) => {
      const done = new Set(created);
      const remaining = selectedWorkspaceIds.filter((id) => !done.has(id));
      if (remaining.length !== selectedWorkspaceIds.length) {
        setSelectedWorkspaceIds(remaining);
      }
      // With nothing left to move, show the review list instead of a
      // mode choice that would start an empty run.
      goToStep(remaining.length > 0 ? "mode_selection" : "review");
    },
    [selectedWorkspaceIds, setSelectedWorkspaceIds, goToStep],
  );

  const handleResume = useCallback(() => {
    void act(async () => {
      const resumed = await sendMessage("MIGRATION_RESUME");
      if (resumed.success) return;
      // Nothing to resume: the run may already have finished.
      const ckpt = await loadLatestCheckpoint().catch(() => undefined);
      const snap = ckpt?.migrationState;
      if (snap?.phase === "complete" && snap.manifestId === manifestId) {
        goToStep("complete");
      } else {
        setCanRetryStart(false);
        setStartError(
          "There's no saved progress to continue from. Go back to choose what to move; PortSmith asks before creating anything that already exists.",
        );
      }
    });
  }, [act, manifestId, goToStep]);

  const handleCancel = useCallback(() => {
    void act(async () => {
      const last = await sendMessage("MIGRATION_STATUS").catch(() => null);
      await sendMessage("MIGRATION_CANCEL");
      await leaveRun([
        ...(last?.completedWorkspaceIds ?? []),
        ...(last?.createdWorkspaceIds ?? []),
      ]);
    });
  }, [act, leaveRun]);

  const handleBackAfterInterruption = useCallback(() => {
    void act(async () => {
      const ckpt = await loadLatestCheckpoint().catch(() => undefined);
      const snap = ckpt?.migrationState;
      const sameRun = snap?.manifestId === manifestId;
      await leaveRun(
        sameRun
          ? [...(snap?.completedWorkspaceIds ?? []), ...(snap?.createdWorkspaceIds ?? [])]
          : [],
      );
    });
  }, [act, manifestId, leaveRun]);

  const handleConfirm = useCallback(
    (token: string | null, confirmed: boolean) => {
      if (!token) return;
      void act(() => sendMessage("MIGRATION_CONFIRM", { confirmed, token }));
    },
    [act],
  );

  const handleGuidedWorkspaceDone = useCallback(
    (workspaceId: string, skippedStepIds: string[]) => {
      void act(async () => {
        await sendMessage("MIGRATION_WORKSPACE_DONE", { workspaceId, skippedStepIds });
        setGuidedStepIdx(0);
        setGuidedCompletedIds(new Set());
      });
    },
    [act],
  );

  const handleMemoryDone = useCallback(
    (allDone: boolean) => {
      void act(() => sendMessage("MIGRATION_MEMORY_DONE", { allDone }));
    },
    [act],
  );

  const handleComplete = useCallback(() => {
    goToStep("complete");
  }, [goToStep]);

  const handleConfirmDelivery = useCallback(
    (workspaceId: string) => {
      void act(() =>
        sendMessage("MIGRATION_UPDATE_DELIVERY", {
          workspaceId,
          delivery: "manual",
        }),
      );
    },
    [act],
  );

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

  // ─── Connection problems ─────────────────────────────────

  const disconnectedBanner = !connected ? (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
      <p className="text-sm font-medium text-red-800">
        Lost contact with PortSmith&apos;s background worker
      </p>
      <p className="mt-1 text-xs text-red-800">
        Chrome may have restarted it. Your progress is saved after each
        workspace.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={handleResume}
        className="mt-2 rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-60"
      >
        Try to continue
      </button>
    </div>
  ) : null;

  // ─── Loading / not started ───────────────────────────────

  if (!status || status.phase === "idle") {
    const interrupted = sawRunRef.current && status?.phase === "idle";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {disconnectedBanner}
        {startError ? (
          <>
            <p className="text-sm text-red-800" role="alert">{startError}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBackAfterInterruption}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Back
              </button>
              {canRetryStart && (
                <button
                  type="button"
                  onClick={() => void startRun()}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
                >
                  Try again
                </button>
              )}
            </div>
          </>
        ) : interrupted ? (
          <>
            <p className="text-sm text-gray-800">
              The migration was interrupted (Chrome may have restarted the
              extension in the background).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleBackAfterInterruption}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleResume}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
              >
                Continue where it stopped
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600" role="status">
            Starting migration...
          </p>
        )}
      </div>
    );
  }

  // ─── Complete ────────────────────────────────────────────

  if (status.phase === "complete") {
    const clipboardWorkspaces = Object.entries(
      status.instructionsDelivery,
    ).filter(([, v]) => v === "clipboard");
    const migrated = status.completedWorkspaceIds.length;
    const problems =
      status.failedWorkspaces.length + status.manualWorkspaces.length;

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            problems > 0 ? "bg-amber-100" : "bg-green-100"
          }`}
          aria-hidden="true"
        >
          <span
            className={`text-xl ${
              problems > 0 ? "text-amber-800" : "text-green-800"
            }`}
          >
            {problems > 0 ? "⚠" : "✓"}
          </span>
        </div>
        <div className="w-full">
          <h2 className="text-lg font-semibold text-gray-900">
            {problems > 0 ? "Finished, with items to review" : "All workspaces processed"}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {migrated} of {status.totalWorkspaces} workspace
            {status.totalWorkspaces !== 1 ? "s" : ""} migrated to {targetName}.
          </p>
          {clipboardWorkspaces.length > 0 && (
            <div className="mt-2 text-left">
              <p className="text-xs text-amber-900">
                These workspaces still need their instructions pasted:
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
                    disabled={busy}
                    onClick={() => handleConfirmDelivery(wsId)}
                    className="mt-1.5 rounded-md bg-green-100 px-3 py-1 text-xs font-medium text-green-900 hover:bg-green-200"
                  >
                    I&apos;ve added the instructions
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <ResultLists status={status} />
          </div>
        </div>
        <button
          type="button"
          onClick={handleComplete}
          className="rounded-lg bg-green-700 px-6 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          See summary
        </button>
      </div>
    );
  }

  // ─── Memory Phase ────────────────────────────────────────

  if (status.phase === "memory") {
    const currentStep = status.memorySteps[memoryStepIdx];
    // Finishing on the last step counts that step as done.
    const allDone = status.memorySteps.every(
      (st) =>
        st.optional === true ||
        memoryCompletedIds.has(st.id) ||
        st.id === currentStep?.id,
    );
    const isLast = memoryStepIdx >= status.memorySteps.length - 1;
    const onlyOptional = status.memorySteps.every((st) => st.optional === true);

    return (
      <div className="flex flex-col gap-3">
        {disconnectedBanner}
        <div>
          {onlyOptional ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">
                One more thing you can bring
              </h2>
              <p className="mt-1 text-xs text-gray-600">
                This step is optional. Finish whenever you like.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900">
                Bring over your memory
              </h2>
              <p className="mt-1 text-xs text-gray-600">
                {targetName} doesn&apos;t let extensions add memories directly, so
                this part is quick copy and paste.
              </p>
            </>
          )}
        </div>

        {currentStep && (
          <StepCard
            step={currentStep}
            stepNumber={memoryStepIdx + 1}
            totalSteps={status.memorySteps.length}
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
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            Back
          </button>

          {!isLast ? (
            <button
              type="button"
              onClick={() => {
                if (currentStep) {
                  setMemoryCompletedIds((prev) => new Set(prev).add(currentStep.id));
                }
                setMemoryStepIdx((i) =>
                  Math.min(i + 1, status.memorySteps.length - 1),
                );
              }}
              className="rounded-lg bg-blue-700 px-6 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Done, next step
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleMemoryDone(allDone)}
              disabled={busy}
              className={`rounded-lg px-6 py-2 text-sm font-medium ${
                allDone
                  ? "bg-green-700 text-white hover:bg-green-800"
                  : "bg-white text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
              } disabled:opacity-60`}
            >
              {allDone ? "Done, finish" : "Finish without the unticked steps"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const duplicateTabBanner = status.duplicateTabWarning ? (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
      {status.duplicateTabWarning}
    </div>
  ) : null;

  // ─── Paused ──────────────────────────────────────────────

  if (status.phase === "paused") {
    return (
      <div className="flex flex-col gap-3">
        {disconnectedBanner}
        {duplicateTabBanner}
        <OverallProgress status={status} />

        <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Migration paused
          </p>
          <p className="text-xs text-amber-900">
            {status.completedWorkspaceIds.length} of {status.totalWorkspaces}{" "}
            workspaces done. Resume to continue.
          </p>
          <div className="flex gap-2">
            <ConfirmButton
              label="Stop"
              question="Stop the migration? Anything already created stays."
              confirmLabel="Stop"
              disabled={busy}
              onConfirm={handleCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleResume}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Running: Guided Mode ────────────────────────────────

  if (status.mode === "guided") {
    if (!status.guidedInstructions) {
      return (
        <div className="flex flex-col gap-3">
          {disconnectedBanner}
          <OverallProgress status={status} />
          <p className="text-sm text-gray-600" role="status">
            Preparing the next workspace...
          </p>
        </div>
      );
    }

    const steps = status.guidedInstructions.steps;
    const currentStep = steps[guidedStepIdx];
    const guidedTotalSteps =
      status.guidedInstructions.totalSteps || steps.length;
    // Finishing on the last step counts that step as done.
    const unticked = steps
      .filter((st) => !guidedCompletedIds.has(st.id) && st.id !== currentStep?.id)
      .map((st) => st.id);
    const allDone = unticked.length === 0;

    return (
      <div className="flex flex-col gap-3">
        {disconnectedBanner}
        {duplicateTabBanner}
        <OverallProgress status={status} />

        <div className="mb-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-600">
            Migrating to {targetName}: {status.guidedInstructions.workspaceName}
          </div>
        </div>

        {currentStep && (
          <StepCard
            step={currentStep}
            stepNumber={currentStep.stepNumber ?? guidedStepIdx + 1}
            totalSteps={guidedTotalSteps}
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
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            Back
          </button>

          {guidedStepIdx < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                if (currentStep) {
                  setGuidedCompletedIds((prev) => new Set(prev).add(currentStep.id));
                }
                setGuidedStepIdx((i) => Math.min(i + 1, steps.length - 1));
              }}
              className="rounded-lg bg-blue-700 px-6 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Done, next step
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                handleGuidedWorkspaceDone(status.guidedInstructions!.workspaceId, unticked)
              }
              disabled={busy}
              className={`rounded-lg px-6 py-2 text-sm font-medium ${
                allDone
                  ? "bg-green-700 text-white hover:bg-green-800"
                  : "bg-white text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
              } disabled:opacity-60`}
            >
              {allDone ? "Done, workspace finished" : "Finish without the unticked steps"}
            </button>
          )}
        </div>

        <div className="flex justify-center gap-2 border-t border-gray-100 pt-2">
          <ConfirmButton
            label="Stop migration"
            question="Stop the migration? Anything already created stays."
            confirmLabel="Stop"
            disabled={busy}
            onConfirm={handleCancel}
            className="text-xs text-gray-600 hover:text-gray-800"
          />
        </div>
      </div>
    );
  }

  // ─── Running: Autofill / Hybrid ──────────────────────────

  const doneCount = status.currentSteps.filter(
    (s) => s.status === "success" || s.status === "skipped",
  ).length;
  const stepPct =
    status.currentSteps.length > 0
      ? Math.round((doneCount / status.currentSteps.length) * 100)
      : 0;
  const modeLabel = status.mode === "hybrid" ? "Hybrid" : "Autofill";
  const pendingStep = status.pendingConfirmStepId
    ? status.currentSteps.find((s) => s.id === status.pendingConfirmStepId)
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {disconnectedBanner}
      {duplicateTabBanner}
      <OverallProgress status={status} />

      {/* Workspace header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {modeLabel} to {targetName}
          </h2>
          <span className="text-xs text-gray-600">
            Workspace {Math.min(status.currentWorkspaceIndex + 1, status.totalWorkspaces)} of{" "}
            {status.totalWorkspaces}
          </span>
        </div>
        {status.currentWorkspaceName && (
          <p className="mt-0.5 text-sm font-medium text-blue-800">
            {status.currentWorkspaceName}
          </p>
        )}
      </div>

      {/* Step progress bar */}
      {status.currentSteps.length > 0 && (
        <div className="h-1.5 w-full rounded-full bg-gray-100" aria-hidden="true">
          <div
            className="h-1.5 rounded-full bg-green-600 transition-all"
            style={{ width: `${stepPct}%` }}
          />
        </div>
      )}

      {/* Step list */}
      {status.currentSteps.length > 0 && (
        <div
          className="rounded-lg border border-gray-200 px-3 py-2"
          aria-live="polite"
        >
          {status.currentSteps.map((step) => (
            <div key={step.id}>
              <StepRow title={step.title} status={step.status} />
              {step.status === "fallback" && step.fallback && (
                <div className="mb-2 ml-6">
                  <StepCard
                    step={step.fallback}
                    stepNumber={0}
                    totalSteps={0}
                    done={false}
                    onToggleDone={() => {}}
                    hideDoneToggle
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Navigation failed prompt */}
      {pendingStep?.status === "navigate_failed" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm font-medium text-red-800">
            {targetName} isn&apos;t ready
          </p>
          <p className="mt-1 text-xs text-red-800">{pendingStep.title}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleConfirm(status.pendingConfirmToken, false)}
              className="rounded px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              Skip this workspace
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleConfirm(status.pendingConfirmToken, true)}
              className="rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Anything waiting on the user */}
      {pendingStep && pendingStep.status === "pending" && (
        <PendingStep
          key={status.pendingConfirmToken ?? pendingStep.id}
          step={pendingStep}
          busy={busy}
          onAnswer={(confirmed) => handleConfirm(status.pendingConfirmToken, confirmed)}
        />
      )}

      {/* Instructions for the current workspace, always copyable */}
      {status.currentWorkspaceInstructions && !pendingStep && (
        <CopyBlock
          label={`instructions for ${status.currentWorkspaceName ?? "this workspace"}`}
          content={status.currentWorkspaceInstructions}
        />
      )}

      <ResultLists status={status} />

      {/* Pause/Stop controls */}
      <div className="flex justify-center gap-4 border-t border-gray-100 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={handlePause}
          className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-60"
          title="Pauses after the current workspace"
        >
          Pause after this workspace
        </button>
        <ConfirmButton
          label="Stop"
          question="Stop the migration? Anything already created stays."
          confirmLabel="Stop"
          disabled={busy}
          onConfirm={handleCancel}
          className="text-xs text-gray-600 hover:text-red-700 disabled:opacity-60"
        />
      </div>
    </div>
  );
}
