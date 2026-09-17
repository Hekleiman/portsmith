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
