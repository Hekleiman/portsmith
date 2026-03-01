import type { ImportStep } from "@/core/adapters/claude-adapter";
import CopyBlock from "./CopyBlock";

export interface StepCardProps {
  step: ImportStep;
  stepNumber: number;
  done: boolean;
  onToggleDone: () => void;
}

export default function StepCard({
  step,
  stepNumber,
  done,
  onToggleDone,
}: StepCardProps): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        done ? "border-green-200 bg-green-50/50" : "border-gray-200"
      }`}
    >
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
          <p className="mt-0.5 text-xs text-gray-500">{step.description}</p>

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
            <ul className="mt-2 space-y-1">
              {step.fileNames.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-1.5 text-xs text-gray-600"
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {name}
                </li>
              ))}
            </ul>
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
