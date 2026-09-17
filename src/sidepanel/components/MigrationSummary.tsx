import type { VerificationResult } from "@/core/adapters/claude-verifier";

// ─── Types ──────────────────────────────────────────────────

export type WorkspaceStatus = "success" | "partial" | "skipped" | "failed";

export interface WorkspaceSummary {
  id: string;
  name: string;
  status: WorkspaceStatus;
  error?: string;
  fileCount: number;
  warnings: string[];
  verified?: boolean;
}

export interface MigrationSummaryProps {
  workspaces: WorkspaceSummary[];
  memoryItemCount: number;
  totalFileCount: number;
  projectMemoryCount: number;
  durationMs: number | null;
  verificationResult: VerificationResult | null;
  verifying: boolean;
  targetName: string;
}

// ─── Helpers ────────────────────────────────────────────────

const STATUS_ICON: Record<WorkspaceStatus, string> = {
  success: "\u2713",
  partial: "\u26A0",
  skipped: "\u2212",
  failed: "\u2717",
};

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  success: "migrated",
  partial: "migrated with follow-ups",
  skipped: "not migrated",
  failed: "failed",
};

const STATUS_COLOR: Record<WorkspaceStatus, string> = {
  success: "text-green-700",
  partial: "text-amber-700",
  skipped: "text-gray-600",
  failed: "text-red-700",
};

const STATUS_BG: Record<WorkspaceStatus, string> = {
  success: "bg-green-50 border-green-200",
  partial: "bg-amber-50 border-amber-200",
  skipped: "bg-gray-50 border-gray-200",
  failed: "bg-red-50 border-red-200",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ─── Component ──────────────────────────────────────────────

export default function MigrationSummary({
  workspaces,
  memoryItemCount,
  totalFileCount,
  projectMemoryCount,
  durationMs,
  verificationResult,
  verifying,
  targetName,
}: MigrationSummaryProps): React.JSX.Element {
  const successCount = workspaces.filter((w) => w.status === "success").length;
  const partialCount = workspaces.filter((w) => w.status === "partial").length;
  const failedCount = workspaces.filter(
    (w) => w.status === "failed" || w.status === "skipped",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-200 px-3 py-2 text-center">
          <p className="text-lg font-semibold text-green-700">{successCount}</p>
          <p className="text-[11px] text-gray-600">Migrated</p>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2 text-center">
          <p className="text-lg font-semibold text-amber-700">{partialCount}</p>
          <p className="text-[11px] text-gray-600">Follow-ups</p>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2 text-center">
          <p className="text-lg font-semibold text-red-700">{failedCount}</p>
          <p className="text-[11px] text-gray-600">Not migrated</p>
        </div>
      </div>

      {/* Meta stats */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        {memoryItemCount > 0 && (
          <span>
            {memoryItemCount} memor{memoryItemCount !== 1 ? "ies" : "y"} imported
          </span>
        )}
        {projectMemoryCount > 0 && (
          <span>
            project memory for {projectMemoryCount} workspace
            {projectMemoryCount !== 1 ? "s" : ""}
          </span>
        )}
        {totalFileCount > 0 && (
          <span>
            {totalFileCount} file{totalFileCount !== 1 ? "s" : ""} added
          </span>
        )}
        {durationMs !== null && <span>{formatDuration(durationMs)}</span>}
      </div>

      {/* Verification status */}
      {verifying && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="animate-pulse text-xs text-blue-800" role="status">
            Checking your projects on {targetName}...
          </span>
        </div>
      )}
      {verificationResult?.error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-900">{verificationResult.error}</p>
        </div>
      )}

      {/* Workspace list */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-gray-500">Workspaces</h3>
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${STATUS_BG[ws.status]}`}
          >
            <span
              className={`mt-0.5 shrink-0 text-sm ${STATUS_COLOR[ws.status]}`}
              aria-hidden="true"
            >
              {STATUS_ICON[ws.status]}
            </span>
            <span className="sr-only">{STATUS_LABEL[ws.status]}: </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">
                  {ws.name}
                </span>
                {ws.verified !== undefined && (
                  <span
                    className={`shrink-0 text-[10px] ${
                      ws.verified ? "text-green-700" : "text-gray-600"
                    }`}
                  >
                    {ws.verified ? "verified" : "not found"}
                  </span>
                )}
              </div>
              {ws.error && (
                <p className="mt-0.5 text-[11px] text-red-800">{ws.error}</p>
              )}
              {ws.warnings.length > 0 && (
                <p className="mt-0.5 text-[11px] text-amber-800">
                  {ws.warnings.length} warning
                  {ws.warnings.length !== 1 ? "s" : ""}
                </p>
              )}
              {ws.fileCount > 0 && ws.status !== "failed" && (
                <p className="mt-0.5 text-[11px] text-gray-600">
                  {ws.fileCount} file{ws.fileCount !== 1 ? "s" : ""} added
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
