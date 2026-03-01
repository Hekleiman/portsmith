import { useCallback, useEffect, useState } from "react";
import { APP_NAME, APP_VERSION } from "@/shared/constants";
import { sendMessage } from "@/shared/messaging";
import type { OrchestratorStatus } from "@/shared/messaging";
import StatusBadge, {
  type StatusVariant,
} from "./components/StatusBadge";

function openSidePanel(): void {
  chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
}

function openSidePanelToComplete(): void {
  // Open side panel — the wizard will show the complete page based on state
  chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
}

function deriveVariant(phase: OrchestratorStatus["phase"]): StatusVariant {
  if (phase === "complete") return "complete";
  if (phase === "running" || phase === "paused" || phase === "memory")
    return "in-progress";
  return "idle";
}

function deriveBadgeLabel(phase: OrchestratorStatus["phase"]): string {
  switch (phase) {
    case "running":
      return "Migrating";
    case "paused":
      return "Paused";
    case "memory":
      return "Memory import";
    case "complete":
      return "Complete";
    default:
      return "Idle";
  }
}

export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback((): void => {
    sendMessage("MIGRATION_STATUS")
      .then((s) => {
        setStatus(s);
        setError(false);
      })
      .catch(() => {
        setError(true);
      });
  }, []);

  useEffect(() => {
    fetchStatus();

    // Poll while in-progress to keep the popup live
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const variant = status ? deriveVariant(status.phase) : "idle";
  const isActive = variant === "in-progress";
  const isComplete = variant === "complete";

  const progressPercent =
    status && status.totalWorkspaces > 0
      ? Math.round(
          ((status.completedWorkspaceIds.length +
            status.failedWorkspaces.length) /
            status.totalWorkspaces) *
            100,
        )
      : 0;

  const currentStep =
    status && status.totalWorkspaces > 0
      ? status.currentWorkspaceIndex + 1
      : 0;

  return (
    <div className="flex w-72 flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
            P
          </div>
          <span className="text-sm font-semibold text-gray-900">
            {APP_NAME}
          </span>
        </div>
        <span className="text-xs text-gray-400">v{APP_VERSION}</span>
      </div>

      <div className="h-px bg-gray-100" />

      {/* Status Section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">Status</span>
          <StatusBadge
            variant={error ? "idle" : variant}
            label={error ? "Offline" : deriveBadgeLabel(status?.phase ?? "idle")}
          />
        </div>

        {isActive && status && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-3">
            {status.currentWorkspaceName && (
              <p className="truncate text-sm font-medium text-gray-800">
                {status.currentWorkspaceName}
              </p>
            )}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                Workspace {currentStep} of {status.totalWorkspaces}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {isComplete && status && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-green-50 p-3">
            <p className="text-sm font-medium text-green-800">
              {status.completedWorkspaceIds.length} workspace
              {status.completedWorkspaceIds.length === 1 ? "" : "s"} migrated
            </p>
            {status.failedWorkspaces.length > 0 && (
              <p className="text-xs text-red-600">
                {status.failedWorkspaces.length} failed
              </p>
            )}
          </div>
        )}

        {!isActive && !isComplete && (
          <p className="text-xs text-gray-400">No active migration</p>
        )}
      </div>

      <div className="h-px bg-gray-100" />

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {!isActive && !isComplete && (
          <button
            onClick={openSidePanel}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800"
          >
            Start Migration
          </button>
        )}

        {isComplete && (
          <button
            onClick={openSidePanelToComplete}
            className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800"
          >
            View Summary
          </button>
        )}

        <button
          onClick={openSidePanel}
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100"
        >
          Open Wizard
        </button>
      </div>
    </div>
  );
}
