import { useState, useCallback } from "react";

export interface CopyBlockProps {
  label: string;
  content: string;
}

export default function CopyBlock({
  label,
  content,
}: CopyBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-medium text-gray-500 hover:text-gray-700"
        >
          {expanded ? `Hide ${label} \u25BE` : `Preview ${label} \u25B8`}
        </button>
        <span className="text-[10px] text-gray-400">
          {content.length.toLocaleString()} chars
        </span>
      </div>
      {expanded && (
        <pre className="max-h-[200px] overflow-y-auto border-t border-gray-200 whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs text-gray-700">
          {content}
        </pre>
      )}
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={`flex w-full items-center justify-center gap-2 rounded-b-md px-3 py-2 text-sm font-medium transition-colors ${
          copied
            ? "bg-green-100 text-green-700"
            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
        }`}
      >
        {copied ? (
          "\u2713 Copied to clipboard"
        ) : (
          <>
            Copy {label}
            {content.length > 100 && (
              <span className="font-normal text-blue-400">
                ({content.length.toLocaleString()} chars)
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}
