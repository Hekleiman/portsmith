import type { WorkspaceCapability } from "@/core/schema/types";

export interface CapabilityMapProps {
  capabilities: WorkspaceCapability[];
}

const TYPE_LABELS: Record<string, string> = {
  web_browsing: "Web Browsing",
  code_execution: "Code Execution",
  image_generation: "Image Generation",
  file_upload: "File Upload",
  api_actions: "API Actions",
  web_search: "Web Search",
  mcp: "MCP",
  voice: "Voice",
  canvas: "Canvas",
  artifacts: "Artifacts",
};

export default function CapabilityMap({
  capabilities,
}: CapabilityMapProps): React.JSX.Element {
  if (capabilities.length === 0) {
    return (
      <p className="text-sm text-gray-400">No capabilities detected.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {capabilities.map((cap) => (
        <div
          key={cap.type}
          className={`flex items-center justify-between rounded-lg border p-2.5 ${
            cap.available
              ? "border-gray-200 bg-white"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-center gap-2">
            {/* Status icon */}
            {cap.available ? (
              <svg
                className="h-4 w-4 shrink-0 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4 shrink-0 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86l-8.3 14.58A1 1 0 003 20h18a1 1 0 00.87-1.5l-8.3-14.58a1.04 1.04 0 00-1.74 0z"
                />
              </svg>
            )}

            <div>
              <p className="text-sm text-gray-700">
                {TYPE_LABELS[cap.type] ?? cap.type}
                {cap.required && (
                  <span className="ml-1 text-xs text-red-500">required</span>
                )}
              </p>
              {cap.platformSpecific && (
                <p className="text-xs text-gray-400">
                  via {cap.platformSpecific}
                </p>
              )}
            </div>
          </div>

          {/* Target mapping */}
          <div className="text-right">
            {cap.available ? (
              <span className="text-xs text-green-600">
                {cap.equivalent ?? "Supported"}
              </span>
            ) : (
              <span className="text-xs text-amber-600">Unavailable</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
