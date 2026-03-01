import { Fragment } from "react";
import {
  STEP_LABELS,
  TOTAL_STEPS,
  phaseToStep,
  useMigrationStore,
} from "../store/migration-store";

export default function StepProgress(): React.JSX.Element {
  const phase = useMigrationStore((s) => s.phase);
  const currentStep = phaseToStep(phase);

  return (
    <nav aria-label="Migration progress">
      <ol className="flex items-start">
        {STEP_LABELS.map((label, i) => {
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          const isLast = i === TOTAL_STEPS - 1;

          return (
            <Fragment key={label}>
              <li className="flex flex-col items-center">
                {/* Dot */}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isCompleted
                      ? "bg-blue-600 text-white"
                      : isCurrent
                        ? "border-2 border-blue-600 bg-white text-blue-600"
                        : "border-2 border-gray-200 bg-white text-gray-400"
                  }`}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? "\u2713" : i + 1}
                </div>
                {/* Label */}
                <span
                  className={`mt-1 text-[10px] leading-tight ${
                    isCurrent
                      ? "font-semibold text-blue-600"
                      : isCompleted
                        ? "font-medium text-gray-700"
                        : "text-gray-400"
                  }`}
                >
                  {label}
                </span>
              </li>

              {/* Connector line */}
              {!isLast && (
                <div
                  className={`mt-3.5 h-0.5 flex-1 ${
                    isCompleted ? "bg-blue-600" : "bg-gray-200"
                  }`}
                  aria-hidden
                />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
