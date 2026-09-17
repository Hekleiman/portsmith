import { useState } from "react";

export interface ConfirmButtonProps {
  label: string;
  question: string;
  confirmLabel: string;
  /** Label of the button that dismisses the question */
  cancelLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Two-step button with an inline confirmation. Used instead of
 * window.confirm(), which isn't dependable inside Chrome's side panel.
 */
export default function ConfirmButton({
  label,
  question,
  confirmLabel,
  cancelLabel = "Keep going",
  onConfirm,
  disabled = false,
  className = "",
}: ConfirmButtonProps): React.JSX.Element {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        className={className}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      <span className="text-xs text-gray-800">{question}</span>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="rounded px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className="rounded bg-red-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-60"
      >
        {confirmLabel}
      </button>
    </span>
  );
}
