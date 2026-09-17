import { useState, useCallback, useRef, useEffect } from "react";

export interface CopyBlockProps {
  label: string;
  content: string;
}

type CopyState = "idle" | "copied" | "failed";

function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

export default function CopyBlock({
  label,
  content,
}: CopyBlockProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>("idle");
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = useCallback(async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(content);
      ok = true;
    } catch {
      ok = legacyCopy(content);
    }
    setState(ok ? "copied" : "failed");
    if (!ok) setExpanded(true); // let the user select the text by hand
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 2000 : 6000);
  }, [content]);

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-[11px] font-medium text-gray-600 hover:text-gray-800"
        >
          {expanded ? `Hide ${label} ▾` : `Preview ${label} ▸`}
        </button>
        <span className="text-[10px] text-gray-500">
          {content.length.toLocaleString()} chars
        </span>
      </div>
      {expanded && (
        <pre className="max-h-[200px] select-text overflow-y-auto whitespace-pre-wrap break-words border-t border-gray-200 px-3 py-2 font-mono text-xs text-gray-800">
          {content}
        </pre>
      )}
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={`flex w-full items-center justify-center gap-2 rounded-b-md px-3 py-2 text-sm font-medium transition-colors ${
          state === "copied"
            ? "bg-green-100 text-green-800"
            : state === "failed"
              ? "bg-red-50 text-red-800"
              : "bg-blue-50 text-blue-800 hover:bg-blue-100"
        }`}
      >
        {state === "copied" ? (
          "✓ Copied to clipboard"
        ) : state === "failed" ? (
          "Couldn't copy. Select the text above and copy it."
        ) : (
          <>
            Copy {label}
            {content.length > 100 && (
              <span className="font-normal text-blue-700/80">
                ({content.length.toLocaleString()} chars)
              </span>
            )}
          </>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? `${label} copied` : state === "failed" ? `Could not copy ${label}` : ""}
      </span>
    </div>
  );
}
