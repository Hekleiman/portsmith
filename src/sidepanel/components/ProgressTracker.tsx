import { useState, useEffect } from "react";

export interface TrackedStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
}

export interface ProgressTrackerProps {
  steps: TrackedStep[];
  startedAt: number | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function StepIcon({ status }: { status: TrackedStep["status"] }): React.JSX.Element {
  switch (status) {
    case "complete":
      return (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100">
          <svg className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case "active":
      return (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        </div>
      );
    case "error":
      return (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
          <svg className="h-3 w-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    default:
      return (
        <div className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-200" />
      );
  }
}

export default function ProgressTracker({
  steps,
  startedAt,
}: ProgressTrackerProps): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  const isRunning = steps.some((s) => s.status === "active");

  useEffect(() => {
    if (!startedAt || !isRunning) return;

    setElapsed(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt, isRunning]);

  const completed = steps.filter((s) => s.status === "complete").length;
  const progressPercent = steps.length > 0 ? (completed / steps.length) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Step list */}
      <ul className="space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2.5">
            <StepIcon status={step.status} />
            <div>
              <span
                className={`text-sm ${
                  step.status === "active"
                    ? "font-medium text-gray-900"
                    : step.status === "complete"
                      ? "text-gray-500"
                      : step.status === "error"
                        ? "text-red-600"
                        : "text-gray-400"
                }`}
              >
                {step.label}
              </span>
              {step.detail && (
                <span className="mt-0.5 block text-xs text-gray-400">
                  {step.detail}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{Math.round(progressPercent)}% complete</span>
          {startedAt !== null && <span>{formatElapsed(elapsed)}</span>}
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
