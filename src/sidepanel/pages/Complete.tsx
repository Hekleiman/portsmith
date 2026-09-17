import { useState, useEffect, useCallback, useMemo } from "react";
import { useMigrationStore } from "../store/migration-store";
import {
  sendMessage,
  type KnowledgeLeftover,
  type OrchestratorStatus,
} from "@/shared/messaging";
import {
  deleteManifestAndFiles,
  loadLatestCheckpoint,
  loadManifest,
} from "@/core/storage/indexed-db";
import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type { VerificationResult } from "@/core/adapters/claude-verifier";
import {
  PLATFORM_HOME_URLS,
  PLATFORM_ITEM_NOUN,
  isPlatformId,
  platformLabel,
  type PlatformId,
} from "@/core/platforms";
import { hasProjectMemory } from "@/core/transform/project-memory";
import MigrationSummary, {
  type WorkspaceSummary,
  type WorkspaceStatus,
} from "../components/MigrationSummary";
import ManualFollowUp, {
  type FollowUpItem,
} from "../components/ManualFollowUp";
import ConfirmButton from "../components/ConfirmButton";
import StepCard from "../components/StepCard";
import { buildMemoryStepsForTarget } from "@/core/adapters/memory-steps";
import { buildLeftoverCards } from "@/core/adapters/leftover-cards";

// ─── Capabilities each target can't provide ─────────────────

const UNSUPPORTED_BY_TARGET: Record<PlatformId, Set<string>> = {
  claude: new Set(["image_generation", "api_actions"]),
  gemini: new Set(["api_actions"]),
  chatgpt: new Set([]),
};

const CAPABILITY_LABELS: Record<string, string> = {
  image_generation: "Image generation",
  api_actions: "Custom API Actions",
};

interface RunResult {
  completed: Set<string>;
  failed: Map<string, string>;
  manual: Map<string, string>;
  verified: Set<string>;
  /** Steps that were skipped or need checking, per workspace */
  followUps: Map<string, string[]>;
  filesDelivered: Map<string, number>;
  projectMemory: Set<string>;
  /** Knowledge an automatic run couldn't add, per workspace */
  knowledgeLeftovers: Map<string, KnowledgeLeftover>;
  /** null when the run had no memory step (or ended before it) */
  memoryImported: boolean | null;
}

// ─── Helpers ────────────────────────────────────────────────

function classifyWorkspace(
  ws: Workspace,
  result: RunResult,
  target: PlatformId,
): WorkspaceStatus {
  if (result.failed.has(ws.id)) return "failed";
  if (!result.completed.has(ws.id)) return "skipped";

  const unsupported = UNSUPPORTED_BY_TARGET[target];
  const hasUnsupported = ws.capabilities.some((c) => unsupported.has(c.type));
  const hasFilesToMove = ws.knowledgeFiles.some((f) => !f.contentRef);
  const hasFollowUps = (result.followUps.get(ws.id)?.length ?? 0) > 0;

  if (hasUnsupported || hasFilesToMove || hasFollowUps) return "partial";
  return "success";
}

function buildFollowUpItems(
  workspaces: Workspace[],
  result: RunResult,
  target: PlatformId,
): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const unsupported = UNSUPPORTED_BY_TARGET[target];
  const targetName = platformLabel(target);

  for (const ws of workspaces) {
    if (!result.completed.has(ws.id)) continue;

    for (const note of result.followUps.get(ws.id) ?? []) {
      items.push({
        workspaceName: ws.name,
        type: "manual_step",
        description: note,
      });
    }

    for (const cap of ws.capabilities) {
      if (unsupported.has(cap.type)) {
        const label = CAPABILITY_LABELS[cap.type] ?? cap.type;
        items.push({
          workspaceName: ws.name,
          type: "unsupported_capability",
          description: `${label} isn't available in ${targetName}${cap.equivalent ? ` (consider: ${cap.equivalent})` : ""}`,
        });
      }
    }

    for (const f of ws.knowledgeFiles) {
      if (f.contentRef) continue;
      items.push({
        workspaceName: ws.name,
        type: f.conversionNeeded ? "conversion_needed" : "incompatible_file",
        description: f.conversionNeeded
          ? `"${f.originalName}": ${f.conversionNeeded}`
          : `"${f.originalName}" wasn't copied; upload it by hand if you need it`,
      });
    }

    for (const step of ws.migration.manualStepsRequired) {
      // Upload reminders are covered by the run's own file steps.
      if (/^(upload|re-upload)\b/i.test(step)) continue;
      items.push({
        workspaceName: ws.name,
        type: "manual_step",
        description: step,
      });
    }
  }

  return items;
}

function exportManifest(manifest: PortsmithManifest): void {
  const json = JSON.stringify(manifest, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `portsmith-${new Date().toISOString().slice(0, 10)}.portsmith.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadRunResult(): Promise<RunResult> {
  let status: OrchestratorStatus | null = null;
  try {
    status = await sendMessage("MIGRATION_STATUS");
  } catch {
    // Service worker unavailable; fall back to the last checkpoint
  }

  if (status && status.phase !== "idle") {
    return {
      completed: new Set(status.completedWorkspaceIds),
      failed: new Map(status.failedWorkspaces.map((f) => [f.id, f.error])),
      manual: new Map(status.manualWorkspaces.map((m) => [m.id, m.reason])),
      verified: new Set(status.verifiedWorkspaceIds),
      followUps: new Map(Object.entries(status.followUps ?? {})),
      filesDelivered: new Map(Object.entries(status.filesDelivered ?? {})),
      projectMemory: new Set(status.projectMemoryWorkspaceIds ?? []),
      knowledgeLeftovers: new Map(Object.entries(status.knowledgeLeftovers ?? {})),
      memoryImported: status.memoryImported ?? null,
    };
  }

  const ckpt = await loadLatestCheckpoint().catch(() => undefined);
  const snap = ckpt?.migrationState;
  return {
    completed: new Set(snap?.completedWorkspaceIds ?? []),
    failed: new Map((snap?.failedWorkspaces ?? []).map((f) => [f.id, f.error])),
    manual: new Map((snap?.manualWorkspaces ?? []).map((m) => [m.id, m.reason])),
    verified: new Set(snap?.verifiedWorkspaceIds ?? []),
    followUps: new Map(Object.entries(snap?.followUps ?? {})),
    filesDelivered: new Map(Object.entries(snap?.filesDelivered ?? {})),
    projectMemory: new Set(snap?.projectMemoryWorkspaceIds ?? []),
    knowledgeLeftovers: new Map(Object.entries(snap?.knowledgeLeftovers ?? {})),
    memoryImported: snap?.memoryImported ?? null,
  };
}

// ─── Component ──────────────────────────────────────────────

export default function Complete(): React.JSX.Element {
  const reset = useMigrationStore((s) => s.reset);
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore(
    (s) => s.selectedWorkspaceIds,
  );
  const migrationStartedAt = useMigrationStore((s) => s.migrationStartedAt);
  const targetPlatform = useMigrationStore((s) => s.targetPlatform);
  const target: PlatformId = isPlatformId(targetPlatform) ? targetPlatform : "claude";
  const targetName = platformLabel(target);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [memoryDone, setMemoryDone] = useState<Set<string>>(new Set());
  const [leftoverDone, setLeftoverDone] = useState<Set<string>>(new Set());

  // Memory steps to show again when they were skipped during the run
  const memorySteps = useMemo(
    () => buildMemoryStepsForTarget(manifest, target),
    [manifest, target],
  );

  // Load manifest and results on mount
  useEffect(() => {
    let active = true;

    async function init(): Promise<void> {
      if (manifestId) {
        const record = await loadManifest(manifestId).catch(() => undefined);
        if (active && record) setManifest(record.data);
      }
      const run = await loadRunResult();
      if (active) {
        setResult(run);
        setLoading(false);
      }
    }

    void init();
    return () => {
      active = false;
    };
  }, [manifestId]);

  // Double-check Claude projects that weren't verified during the run
  useEffect(() => {
    if (target !== "claude") return;
    if (loading || !manifest || !result || verifying || verificationResult) return;

    const projectNames = manifest.workspaces
      .filter(
        (ws) =>
          selectedWorkspaceIds.includes(ws.id) &&
          result.completed.has(ws.id) &&
          !result.verified.has(ws.id) &&
          !result.followUps.has(ws.id),
      )
      .map((ws) => ws.name);

    if (projectNames.length === 0) return;

    setVerifying(true);
    sendMessage("VERIFY_PROJECTS", { projectNames })
      .then(setVerificationResult)
      .catch(() => {
        setVerificationResult({
          found: [],
          notFound: [],
          error:
            "Couldn't check your projects right now. They may still have been created.",
        });
      })
      .finally(() => setVerifying(false));
  }, [target, loading, manifest, result, selectedWorkspaceIds, verifying, verificationResult]);

  const handleExport = useCallback(() => {
    if (manifest) exportManifest(manifest);
  }, [manifest]);

  const handleDeleteData = useCallback(async () => {
    setDeleteError(null);
    try {
      if (manifestId) await deleteManifestAndFiles(manifestId);
      reset();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  }, [manifestId, reset]);

  // ─── Loading State ──────────────────────────────────────────

  if (loading || !result) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-600" role="status">
          Loading results...
        </p>
      </div>
    );
  }

  // ─── No manifest (edge case) ──────────────────────────────

  if (!manifest) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Migration finished
        </h2>
        <p className="text-sm text-gray-600">
          The extracted data is no longer available, so there is no summary to
          show.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-blue-700 px-6 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          Start new migration
        </button>
      </div>
    );
  }

  // ─── Build summary data ──────────────────────────────────

  // A failed lookup (no Claude tab, signed out) proves nothing either way.
  const verificationUsable = !!verificationResult && !verificationResult.error;
  const verifiedNames = new Set(verificationUsable ? verificationResult.found : []);
  const notFoundNames = new Set(verificationUsable ? verificationResult.notFound : []);

  const selectedWorkspaces = manifest.workspaces.filter((ws) =>
    selectedWorkspaceIds.includes(ws.id),
  );

  const workspaceSummaries: WorkspaceSummary[] = selectedWorkspaces.map(
    (ws) => {
      const status = classifyWorkspace(ws, result, target);
      let verified: boolean | undefined;
      const checkedInRun = result.verified.has(ws.id);
      const problemsInRun = result.followUps.has(ws.id);
      if (checkedInRun || (!problemsInRun && verifiedNames.has(ws.name))) {
        verified = true;
      } else if (notFoundNames.has(ws.name) && status !== "skipped" && status !== "failed") {
        verified = false;
      }
      return {
        id: ws.id,
        name: ws.name,
        status,
        error: result.failed.get(ws.id) ?? result.manual.get(ws.id),
        fileCount: result.filesDelivered.get(ws.id) ?? 0,
        warnings: ws.migration.warnings,
        verified,
      };
    },
  );

  const migratedCount = workspaceSummaries.filter(
    (w) => w.status === "success" || w.status === "partial",
  ).length;
  const totalFileCount = workspaceSummaries.reduce((s, w) => s + w.fileCount, 0);
  const projectMemoryCount = selectedWorkspaces.filter(
    (ws) => result.projectMemory.has(ws.id) && hasProjectMemory(ws),
  ).length;
  const durationMs = migrationStartedAt ? Date.now() - migrationStartedAt : null;

  const followUpItems = buildFollowUpItems(selectedWorkspaces, result, target);
  const leftoverCards = buildLeftoverCards(
    selectedWorkspaces,
    result,
    target,
    platformLabel(manifest.source.platform),
  );

  const allFailed =
    workspaceSummaries.length > 0 && migratedCount === 0;
  const allSuccess =
    workspaceSummaries.length > 0 &&
    workspaceSummaries.every((ws) => ws.status === "success");
  const noun = PLATFORM_ITEM_NOUN[target];

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            allFailed ? "bg-red-100" : allSuccess ? "bg-green-100" : "bg-amber-100"
          }`}
          aria-hidden="true"
        >
          <span
            className={`text-lg ${
              allFailed
                ? "text-red-700"
                : allSuccess
                  ? "text-green-700"
                  : "text-amber-700"
            }`}
          >
            {allFailed ? "✗" : allSuccess ? "✓" : "⚠"}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {allFailed
              ? "Nothing was migrated"
              : allSuccess
                ? "Migration complete"
                : "Migration complete, with follow-ups"}
          </h2>
          <p className="text-xs text-gray-600">
            {migratedCount} of {selectedWorkspaces.length} workspace
            {selectedWorkspaces.length !== 1 ? "s" : ""} migrated to {targetName}
          </p>
        </div>
      </div>

      {/* Summary */}
      <MigrationSummary
        workspaces={workspaceSummaries}
        memoryItemCount={result.memoryImported === true ? manifest.memory.length : 0}
        totalFileCount={totalFileCount}
        projectMemoryCount={projectMemoryCount}
        durationMs={durationMs}
        verificationResult={verificationResult}
        verifying={verifying}
        targetName={targetName}
      />

      {/* Manual Follow-Up */}
      {followUpItems.length > 0 && <ManualFollowUp items={followUpItems} />}

      {/* What the automatic run left for the user */}
      {leftoverCards.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-medium text-amber-900">
            Finish these by hand
          </h3>
          <p className="mt-1 text-xs text-amber-900">
            PortSmith kept going and saved these for the end.
          </p>
          <div className="mt-2 space-y-2">
            {leftoverCards.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                stepNumber={i + 1}
                totalSteps={leftoverCards.length}
                done={leftoverDone.has(step.id)}
                onToggleDone={() =>
                  setLeftoverDone((prev) => {
                    const next = new Set(prev);
                    if (next.has(step.id)) next.delete(step.id);
                    else next.add(step.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Memory import that was skipped during the run */}
      {result.memoryImported === false && memorySteps.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-medium text-amber-900">
            Your memory isn&apos;t in {targetName} yet
          </h3>
          <p className="mt-1 text-xs text-amber-900">
            Some memory steps were skipped. Here they are again.
          </p>
          <div className="mt-2 space-y-2">
            {memorySteps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                stepNumber={i + 1}
                totalSteps={memorySteps.length}
                done={memoryDone.has(step.id)}
                onToggleDone={() =>
                  setMemoryDone((prev) => {
                    const next = new Set(prev);
                    if (next.has(step.id)) next.delete(step.id);
                    else next.add(step.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      <a
        href={PLATFORM_HOME_URLS[target]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-center text-xs font-medium text-blue-800 hover:underline"
      >
        Open your {noun === "Gem" ? "Gems" : `${noun}s`} in {targetName} &rarr;
      </a>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 border-t border-gray-200 pt-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Export backup (JSON)
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            Start new migration
          </button>
        </div>
        <div className="text-center">
          <ConfirmButton
            label="Delete the data PortSmith extracted"
            question="Delete the extracted copy (instructions, files, memory) from this browser?"
            confirmLabel="Delete"
            cancelLabel="Keep it"
            onConfirm={() => void handleDeleteData()}
            className="text-xs text-gray-600 underline hover:text-red-700"
          />
          {deleteError && (
            <p className="mt-1 text-xs text-red-800" role="alert">
              {deleteError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
