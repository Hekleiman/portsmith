import type { ImportStep } from "@/core/adapters/claude-adapter";
import CopyBlock from "./CopyBlock";

export interface StepCardProps {
  step: ImportStep;
  stepNumber: number;
  totalSteps: number;
  done: boolean;
  onToggleDone: () => void;
}

export default function StepCard({
  step,
  stepNumber,
  totalSteps,
  done,
  onToggleDone,
}: StepCardProps): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        done ? "border-green-200 bg-green-50/50" : "border-gray-200"
      }`}
    >
      {/* Step counter */}
      {totalSteps > 0 && (
        <div className="mb-1 text-xs font-medium text-slate-400">
          Step {stepNumber} of {totalSteps}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            done
              ? "bg-green-600 text-white"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {done ? "\u2713" : stepNumber}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
          <p className="mt-0.5 whitespace-pre-line text-xs text-gray-500">
            {step.description}
          </p>

          {/* Action hint */}
          {step.actionHint && (
            <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-blue-600">
              <span>{"\u2192"}</span> {step.actionHint}
            </div>
          )}

          {/* Link */}
          {step.link && (
            <a
              href={step.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
            >
              {step.link} &rarr;
            </a>
          )}

          {/* Copy blocks */}
          {step.copyBlocks.map((block) => (
            <CopyBlock
              key={block.label}
              label={block.label}
              content={block.content}
            />
          ))}

          {/* File list */}
          {step.fileNames && step.fileNames.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="mb-1 text-xs font-medium text-slate-500">
                Ready to upload:
              </div>
              {step.fileNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 py-0.5 text-xs text-slate-700"
                >
                  <span className="text-green-500">{"\u2713"}</span>
                  <span>{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mark as done */}
      <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-gray-100 pt-2">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggleDone}
          className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        <span className="text-xs font-medium text-gray-600">
          Mark as done
        </span>
      </label>
    </div>
  );
}
