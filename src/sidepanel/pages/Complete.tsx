import { useState, useEffect, useCallback } from "react";
import { useMigrationStore } from "../store/migration-store";
import { sendMessage, type OrchestratorStatus } from "@/shared/messaging";
import { loadManifest } from "@/core/storage/indexed-db";
import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type { VerificationResult } from "@/core/adapters/claude-verifier";
import MigrationSummary, {
  type WorkspaceSummary,
  type WorkspaceStatus,
} from "../components/MigrationSummary";
import ManualFollowUp, {
  type FollowUpItem,
} from "../components/ManualFollowUp";

// ─── Unsupported capability types on Claude ─────────────────

const UNSUPPORTED_ON_CLAUDE = new Set([
  "image_generation",
  "api_actions",
  "voice",
]);

// ─── Helpers ────────────────────────────────────────────────

function classifyWorkspace(
  ws: Workspace,
  failed: boolean,
): WorkspaceStatus {
  if (failed) return "failed";

  const hasUnsupported = ws.capabilities.some(
    (c) => UNSUPPORTED_ON_CLAUDE.has(c.type) && c.required,
  );
  const hasIncompatibleFiles = ws.knowledgeFiles.some((f) => !f.compatible);
  const hasManualSteps = ws.migration.manualStepsRequired.length > 0;

  if (hasUnsupported || hasIncompatibleFiles || hasManualSteps) return "partial";
  return "success";
}

function buildFollowUpItems(
  workspaces: Workspace[],
  failedIds: Set<string>,
): FollowUpItem[] {
  const items: FollowUpItem[] = [];

  for (const ws of workspaces) {
    if (failedIds.has(ws.id)) continue;

    // Unsupported capabilities
    for (const cap of ws.capabilities) {
      if (UNSUPPORTED_ON_CLAUDE.has(cap.type)) {
        const label =
          cap.type === "image_generation"
            ? "DALL-E image generation"
            : cap.type === "api_actions"
              ? "API Actions"
              : cap.type;
        items.push({
          workspaceName: ws.name,
          type: "unsupported_capability",
          description: `${label} is not available on Claude${cap.equivalent ? ` (consider: ${cap.equivalent})` : ""}`,
        });
      }
    }

    // Incompatible files
    for (const f of ws.knowledgeFiles) {
      if (!f.compatible) {
        items.push({
          workspaceName: ws.name,
          type: "incompatible_file",
          description: `"${f.originalName}" (${f.mimeType}) is not compatible`,
        });
      } else if (f.conversionNeeded) {
        items.push({
          workspaceName: ws.name,
          type: "conversion_needed",
          description: `"${f.originalName}" needs conversion: ${f.conversionNeeded}`,
        });
      }
    }

    // Manual steps
    for (const step of ws.migration.manualStepsRequired) {
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

// ─── Component ──────────────────────────────────────────────

export default function Complete(): React.JSX.Element {
  const reset = useMigrationStore((s) => s.reset);
  const manifestId = useMigrationStore((s) => s.manifestId);
  const selectedWorkspaceIds = useMigrationStore(
    (s) => s.selectedWorkspaceIds,
  );
  const migrationStartedAt = useMigrationStore((s) => s.migrationStartedAt);

  const [manifest, setManifest] = useState<PortsmithManifest | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] =
    useState<OrchestratorStatus | null>(null);
  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load manifest and orchestrator status on mount
  useEffect(() => {
    let active = true;

    async function init(): Promise<void> {
      // Load manifest
      if (manifestId) {
        const record = await loadManifest(manifestId);
        if (active && record) setManifest(record.data);
      }

      // Get final orchestrator status
      try {
        const status = await sendMessage("MIGRATION_STATUS");
        if (active) setOrchestratorStatus(status);
      } catch {
        // Service worker unavailable — degrade gracefully
      }

      if (active) setLoading(false);
    }

    void init();
    return () => {
      active = false;
    };
  }, [manifestId]);

  // Auto-run verification after data loads
  useEffect(() => {
    if (loading || !manifest || verifying || verificationResult) return;

    const completedIds = new Set(
      orchestratorStatus?.completedWorkspaceIds ?? [],
    );
    const projectNames = manifest.workspaces
      .filter(
        (ws) =>
          selectedWorkspaceIds.includes(ws.id) && completedIds.has(ws.id),
      )
      .map((ws) => ws.name);

    if (projectNames.length === 0) return;

    setVerifying(true);
    sendMessage("VERIFY_PROJECTS", { projectNames })
      .then(setVerificationResult)
      .catch(() => {
        setVerificationResult({
          found: [],
          notFound: projectNames,
          error: "Verification unavailable. Projects may still have been created successfully.",
        });
      })
      .finally(() => setVerifying(false));
  }, [
    loading,
    manifest,
    orchestratorStatus,
    selectedWorkspaceIds,
    verifying,
    verificationResult,
  ]);

  const handleExport = useCallback(() => {
    if (manifest) exportManifest(manifest);
  }, [manifest]);

  // ─── Loading State ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading results...</p>
      </div>
    );
  }

  // ─── No manifest (edge case) ──────────────────────────────

  if (!manifest) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Migration Complete
        </h2>
        <p className="text-sm text-gray-500">
          Migration data is no longer available.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Start New Migration
        </button>
      </div>
    );
  }

  // ─── Build summary data ──────────────────────────────────

  const failedMap = new Map(
    (orchestratorStatus?.failedWorkspaces ?? []).map((f) => [f.id, f.error]),
  );
  const completedIds = new Set(
    orchestratorStatus?.completedWorkspaceIds ?? [],
  );
  const verifiedNames = new Set(verificationResult?.found ?? []);

  const selectedWorkspaces = manifest.workspaces.filter((ws) =>
    selectedWorkspaceIds.includes(ws.id),
  );

  const workspaceSummaries: WorkspaceSummary[] = selectedWorkspaces.map(
    (ws) => {
      const failed = failedMap.has(ws.id);
      const status = classifyWorkspace(ws, failed);
      return {
        id: ws.id,
        name: ws.name,
        status,
        error: failedMap.get(ws.id),
        fileCount: ws.knowledgeFiles.filter((f) => f.compatible).length,
        warnings: ws.migration.warnings,
        verified: verificationResult ? verifiedNames.has(ws.name) : undefined,
      };
    },
  );

  const memoryItemCount = manifest.memory.length;
  const totalFileCount = selectedWorkspaces.reduce(
    (sum, ws) => sum + ws.knowledgeFiles.filter((f) => f.compatible).length,
    0,
  );
  const durationMs = migrationStartedAt
    ? Date.now() - migrationStartedAt
    : null;

  const followUpItems = buildFollowUpItems(
    selectedWorkspaces,
    new Set(failedMap.keys()),
  );

  const allFailed =
    workspaceSummaries.length > 0 &&
    workspaceSummaries.every((ws) => ws.status === "failed");
  const allSuccess =
    workspaceSummaries.length > 0 &&
    workspaceSummaries.every((ws) => ws.status === "success");

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            allFailed
              ? "bg-red-100"
              : allSuccess
                ? "bg-green-100"
                : "bg-amber-100"
          }`}
        >
          <span
            className={`text-lg ${
              allFailed
                ? "text-red-600"
                : allSuccess
                  ? "text-green-600"
                  : "text-amber-600"
            }`}
          >
            {allFailed ? "\u2717" : allSuccess ? "\u2713" : "\u26A0"}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {allFailed
              ? "Migration Failed"
              : allSuccess
                ? "Migration Complete"
                : "Migration Completed with Warnings"}
          </h2>
          <p className="text-xs text-gray-500">
            {completedIds.size} of {selectedWorkspaces.length} workspace
            {selectedWorkspaces.length !== 1 ? "s" : ""} migrated to Claude
          </p>
        </div>
      </div>

      {/* Summary */}
      <MigrationSummary
        workspaces={workspaceSummaries}
        memoryItemCount={memoryItemCount}
        totalFileCount={totalFileCount}
        durationMs={durationMs}
        verificationResult={verificationResult}
        verifying={verifying}
      />

      {/* Manual Follow-Up */}
      {followUpItems.length > 0 && <ManualFollowUp items={followUpItems} />}

      {/* View on Claude link */}
      <a
        href="https://claude.ai/projects"
        target="_blank"
        rel="noopener noreferrer"
        className="text-center text-xs font-medium text-blue-600 hover:underline"
      >
        View your projects on Claude &rarr;
      </a>

      {/* Action buttons */}
      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <button
          type="button"
          onClick={handleExport}
          className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export Manifest
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Start New Migration
        </button>
      </div>
    </div>
  );
}
