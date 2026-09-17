import { useState } from "react";
import type { KnowledgeFile } from "@/core/schema/types";

export interface FileCompatibilityListProps {
  files: KnowledgeFile[];
}

const COLLAPSED_LIMIT = 5;

export default function FileCompatibilityList({
  files,
}: FileCompatibilityListProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = files.length - COLLAPSED_LIMIT;

  return (
    <div className="mt-2 space-y-1">
      {visibleFiles.map((file) => (
        <div key={file.id} className="flex items-start gap-1.5">
          {file.compatible ? (
            <span className="shrink-0 text-xs text-green-600">{"\u2713"}</span>
          ) : file.conversionNeeded ? (
            <span className="shrink-0 text-xs text-amber-500">{"\u26A0"}</span>
          ) : (
            <span className="shrink-0 text-xs text-red-500">{"\u2717"}</span>
          )}
          <div className="min-w-0">
            <span
              className={`text-xs ${
                file.compatible ? "text-gray-600" : "text-gray-500"
              }`}
            >
              {file.originalName}
              {file.sizeBytes > 0 && (
                <span className="ml-1 text-gray-400">
                  ({formatSize(file.sizeBytes)})
                </span>
              )}
            </span>
            {!file.compatible && (
              <p className="text-[11px] text-amber-600">
                {file.conversionNeeded ?? "Not supported"}
              </p>
            )}
          </div>
        </div>
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          and {hiddenCount} more...
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
