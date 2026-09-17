import type { ImportStep } from "@/core/adapters/claude-adapter";
import CopyBlock from "./CopyBlock";
import DownloadButton from "./DownloadButton";

export interface StepCardProps {
  step: ImportStep;
  stepNumber: number;
  totalSteps: number;
  done: boolean;
  onToggleDone: () => void;
  /** Hide the "Mark as done" checkbox (e.g. when the card has its own buttons) */
  hideDoneToggle?: boolean;
}

export default function StepCard({
  step,
  stepNumber,
  totalSteps,
  done,
  onToggleDone,
  hideDoneToggle = false,
}: StepCardProps): React.JSX.Element {
  const showNumber = stepNumber > 0;

  return (
    <div
      className={`rounded-lg border bg-white p-3 transition-colors ${
        done ? "border-green-200 bg-green-50/50" : "border-gray-200"
      }`}
    >
      {/* Step counter */}
      {totalSteps > 0 && showNumber && (
        <div className="mb-1 text-xs font-medium text-slate-500">
          Step {stepNumber} of {totalSteps}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        {(showNumber || done) && (
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              done ? "bg-green-700 text-white" : "bg-blue-100 text-blue-800"
            }`}
            aria-hidden="true"
          >
            {done ? "✓" : stepNumber}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
          <p className="mt-0.5 whitespace-pre-line text-xs text-gray-600">
            {step.description}
          </p>

          {/* Action hint */}
          {step.actionHint && (
            <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-blue-700">
              <span aria-hidden="true">{"→"}</span> {step.actionHint}
            </div>
          )}

          {/* Buttons that open each page the step needs */}
          {step.actions && step.actions.length > 0 && (
            <ol className="mt-3 space-y-2">
              {step.actions.map((action, i) => (
                <li key={action.url + action.label} className="flex items-start gap-2">
                  <span
                    className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={action.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                    >
                      {action.label}
                    </a>
                    {action.note && (
                      <p className="mt-1 whitespace-pre-line text-xs text-gray-600">{action.note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* Link */}
          {!step.actions?.length && step.link && (
            <a
              href={step.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block break-all text-xs font-medium text-blue-700 hover:underline"
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

          {/* Downloads */}
          {step.downloads && step.downloads.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="mb-1 text-xs font-medium text-slate-600">
                Files to upload:
              </div>
              {step.downloads.map((d) => (
                <DownloadButton key={`${d.fileName}-${d.contentRef ?? "inline"}`} download={d} />
              ))}
            </div>
          )}

          {/* File list */}
          {step.fileNames && step.fileNames.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="mb-1 text-xs font-medium text-slate-600">
                Files to bring over:
              </div>
              {step.fileNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 py-0.5 text-xs text-slate-700"
                >
                  <span aria-hidden="true" className="text-slate-500">{"•"}</span>
                  <span className="break-all">{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mark as done */}
      {!hideDoneToggle && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-gray-100 pt-2">
          <input
            type="checkbox"
            checked={done}
            onChange={onToggleDone}
            className="h-4 w-4 rounded border-gray-300 text-green-700 focus:ring-green-600"
          />
          <span className="text-xs font-medium text-gray-700">
            Mark as done
          </span>
        </label>
      )}
    </div>
  );
}
