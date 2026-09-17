import type { AutofillStepStatus } from "@/shared/messaging";

// ─── Step Row ───────────────────────────────────────────────

export interface StepRowProps {
  title: string;
  status: AutofillStepStatus;
}

export default function StepRow({
  title,
  status,
}: StepRowProps): React.JSX.Element {
  const icon: Record<AutofillStepStatus, string> = {
    pending: "\u25CB",
    running: "\u25CF",
    success: "\u2713",
    failed: "\u2717",
    fallback: "\u26A0",
    skipped: "\u2212",
    clipboard: "\u2398",
    navigate_failed: "\u2717",
  };

  const color: Record<AutofillStepStatus, string> = {
    pending: "text-blue-700",
    running: "text-blue-700 animate-pulse",
    success: "text-green-700",
    failed: "text-red-700",
    fallback: "text-amber-700",
    skipped: "text-gray-500",
    clipboard: "text-blue-700",
    navigate_failed: "text-red-700 animate-pulse",
  };

  const label: Record<AutofillStepStatus, string> = {
    pending: "waiting for you",
    running: "in progress",
    success: "done",
    failed: "failed",
    fallback: "needs attention",
    skipped: "skipped",
    clipboard: "copied",
    navigate_failed: "needs attention",
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-4 text-center text-sm ${color[status]}`} aria-hidden="true">
        {icon[status]}
      </span>
      <span
        className={`text-xs ${
          status === "skipped" ? "text-gray-500 line-through" : "text-gray-800"
        }`}
      >
        {title}
        <span className="sr-only"> ({label[status]})</span>
      </span>
    </div>
  );
}
