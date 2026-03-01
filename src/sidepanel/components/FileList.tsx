import type { KnowledgeFile } from "@/core/schema/types";

export interface FileListProps {
  files: KnowledgeFile[];
  excludedIds: Set<string>;
  onToggle: (fileId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileList({
  files,
  excludedIds,
  onToggle,
}: FileListProps): React.JSX.Element {
  if (files.length === 0) {
    return (
      <p className="text-sm text-gray-400">No knowledge files attached.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {files.map((file) => {
        const excluded = excludedIds.has(file.id);
        return (
          <div
            key={file.id}
            className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${
              excluded
                ? "border-gray-100 bg-gray-50 opacity-60"
                : "border-gray-200 bg-white"
            }`}
          >
            {/* Toggle */}
            <button
              onClick={() => onToggle(file.id)}
              role="switch"
              aria-checked={!excluded}
              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                !excluded ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  !excluded ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </button>

            {/* File info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-gray-700">
                {file.originalName}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {formatSize(file.sizeBytes)}
                </span>
                {file.compatible ? (
                  <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                    compatible
                  </span>
                ) : (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                    incompatible
                  </span>
                )}
                {file.conversionNeeded && (
                  <span className="text-xs text-amber-600">
                    needs {file.conversionNeeded}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
