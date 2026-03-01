import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type { AutofillStepResult } from "@/core/adapters/claude-autofill";
import { autofillWorkspace } from "@/core/adapters/claude-autofill";
import { generateMemoryInstructions } from "@/core/adapters/claude-adapter";
import { loadManifest } from "@/core/storage/indexed-db";
import { useMigrationStore } from "../store/migration-store";
import StepCard from "./StepCard";
import type { AutofillStepStatus } from "@/shared/messaging";

// ─── Step Row ───────────────────────────────────────────────

interface StepRowProps {
  title: string;
  status: AutofillStepStatus;
}

function StepRow({ title, status }: StepRowProps): React.JSX.Element {
  const icon: Record<AutofillStepStatus, string> = {
    pending: "\u25CB", // ○
    running: "\u25CF", // ●
    success: "\u2713", // ✓
    failed: "\u2717",  // ✗
    fallback: "\u26A0", // ⚠
    skipped: "\u2014",  // —
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

// ─── Component ──────────────────────────────────────────────

export default function AutofillMigration(): React.JSX.Element {
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore(
    (s) => s.selectedWorkspaceIds,
  );
  const deliveryMode = useMigrationStore((s) => s.deliveryMode);
  const goToStep = useMigrationStore((s) => s.goToStep);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [loading, setLoading] = useState(true);

  // Autofill state
  const [currentWsIdx, setCurrentWsIdx] = useState(0);
  const [steps, setSteps] = useState<AutofillStepResult[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "running" | "paused" | "memory" | "done"
  >("idle");
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  // Ref to send confirmation to the generator
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

  // Memory step tracking (memory always uses guided mode)
  const [memoryCompletedIds, setMemoryCompletedIds] = useState<Set<string>>(
    new Set(),
  );
  const [memoryStepIdx, setMemoryStepIdx] = useState(0);

  // Load manifest
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!manifestId) {
        setLoading(false);
        return;
      }
      const record = await loadManifest(manifestId);
      if (cancelled) return;
      if (record) setManifest(record.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [manifestId]);

  const selectedWorkspaces: Workspace[] = useMemo(
    () =>
      manifest?.workspaces.filter((ws) =>
        selectedWorkspaceIds.includes(ws.id),
      ) ?? [],
    [manifest, selectedWorkspaceIds],
  );

  const memorySteps = useMemo(
    () => generateMemoryInstructions(manifest?.memory ?? []),
    [manifest],
  );

  const isHybrid = deliveryMode === "hybrid";

  // Find the active Claude tab
  const findClaudeTab = useCallback(async (): Promise<number | null> => {
    try {
      const tabs = await chrome.tabs.query({
        url: "https://claude.ai/*",
        active: true,
        currentWindow: true,
      });
      if (tabs.length > 0 && tabs[0]?.id != null) return tabs[0].id;

      // Try any Claude tab
      const allTabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
      if (allTabs.length > 0 && allTabs[0]?.id != null) return allTabs[0].id;
    } catch {
      // Not in extension context
    }
    return null;
  }, []);

  // Run autofill for a workspace
  const runWorkspace = useCallback(
    async (workspace: Workspace) => {
      const tabId = await findClaudeTab();
      if (tabId === null) {
        setSteps([
          {
            id: "error-no-tab",
            title: "No Claude tab found. Please open claude.ai first.",
            status: "failed",
          },
        ]);
        return;
      }

      setSteps([]);
      setPhase("running");

      const gen = autofillWorkspace(workspace, tabId, { hybrid: isHybrid });
      let nextInput: boolean | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await gen.next(nextInput);
        if (done || !value) break;
        nextInput = undefined;

        const step = value;

        // Hybrid: pause at pending state for confirmation
        if (isHybrid && step.status === "pending") {
          setPendingConfirm(step.id);
          setSteps((prev) => [...prev, step]);
          setPhase("paused");

          // Wait for user confirmation
          const confirmed = await new Promise<boolean>((resolve) => {
            confirmResolverRef.current = resolve;
          });
          confirmResolverRef.current = null;
          setPendingConfirm(null);
          setPhase("running");
          nextInput = confirmed;
          continue;
        }

        // Update step in list
        setSteps((prev) => {
          const exists = prev.findIndex((s) => s.id === step.id);
          if (exists >= 0) {
            const updated = [...prev];
            updated[exists] = step;
            return updated;
          }
          return [...prev, step];
        });
      }
    },
    [findClaudeTab, isHybrid],
  );

  // Start autofill
  const startAutofill = useCallback(async () => {
    const workspace = selectedWorkspaces[currentWsIdx];
    if (!workspace) return;
    await runWorkspace(workspace);

    // Check if more workspaces
    if (currentWsIdx < selectedWorkspaces.length - 1) {
      setCurrentWsIdx((i) => i + 1);
      setPhase("idle");
    } else if (memorySteps.length > 0) {
      setPhase("memory");
    } else {
      setPhase("done");
    }
  }, [currentWsIdx, selectedWorkspaces, runWorkspace, memorySteps.length]);

  // Hybrid confirm/skip
  const handleConfirm = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed);
  }, []);

  // Memory step toggle
  const toggleMemoryStep = useCallback((stepId: string) => {
    setMemoryCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }, []);

  const finishMigration = useCallback(() => {
    goToStep("complete");
  }, [goToStep]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (selectedWorkspaces.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-sm text-gray-500">No workspaces to migrate.</p>
      </div>
    );
  }

  const currentWorkspace = selectedWorkspaces[currentWsIdx];

  // Memory phase — show guided steps for memory items
  if (phase === "memory") {
    const currentMemStep = memorySteps[memoryStepIdx];
    const allMemDone =
      memorySteps.length > 0 &&
      memorySteps.every((s) => memoryCompletedIds.has(s.id));

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

        {currentMemStep && (
          <StepCard
            step={currentMemStep}
            stepNumber={memoryStepIdx + 1}
            done={memoryCompletedIds.has(currentMemStep.id)}
            onToggleDone={() => toggleMemoryStep(currentMemStep.id)}
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

          {memoryStepIdx < memorySteps.length - 1 ? (
            <button
              type="button"
              onClick={() =>
                setMemoryStepIdx((i) => Math.min(i + 1, memorySteps.length - 1))
              }
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPhase("done")}
              disabled={!allMemDone}
              className={`rounded-lg px-6 py-2 text-sm font-medium text-white ${
                allMemDone
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

  // Done phase
  if (phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <span className="text-xl text-green-600">{"\u2713"}</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            All workspaces processed
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {selectedWorkspaces.length} workspace
            {selectedWorkspaces.length !== 1 ? "s" : ""} migrated to Claude.
          </p>
        </div>
        <button
          type="button"
          onClick={finishMigration}
          className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Complete Migration
        </button>
      </div>
    );
  }

  // Idle or running phase — autofill UI
  const successCount = steps.filter((s) => s.status === "success").length;
  const progressPct =
    steps.length > 0 ? Math.round((successCount / steps.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isHybrid ? "Hybrid" : "Autofill"} Migration
          </h2>
          <span className="text-xs text-gray-500">
            Workspace {currentWsIdx + 1} of {selectedWorkspaces.length}
          </span>
        </div>
        {currentWorkspace && (
          <p className="mt-0.5 text-sm font-medium text-blue-600">
            {currentWorkspace.name}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-green-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Step list */}
      {steps.length > 0 && (
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          {steps.map((step) => (
            <div key={step.id}>
              <StepRow title={step.title} status={step.status} />
              {/* Show fallback guided step for failed steps */}
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

      {/* Hybrid confirmation buttons */}
      {phase === "paused" && pendingConfirm && (
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

      {/* Start / Next Workspace button */}
      {phase === "idle" && (
        <button
          type="button"
          onClick={() => void startAutofill()}
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {currentWsIdx === 0
            ? `Start ${isHybrid ? "Hybrid" : "Autofill"}`
            : "Next Workspace"}
        </button>
      )}
    </div>
  );
}
