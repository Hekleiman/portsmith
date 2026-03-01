// ─── Types ──────────────────────────────────────────────────

export type FollowUpType =
  | "unsupported_capability"
  | "incompatible_file"
  | "conversion_needed"
  | "manual_step";

export interface FollowUpItem {
  workspaceName: string;
  description: string;
  type: FollowUpType;
}

export interface ManualFollowUpProps {
  items: FollowUpItem[];
}

// ─── Helpers ────────────────────────────────────────────────

const TYPE_LABELS: Record<FollowUpType, string> = {
  unsupported_capability: "Unsupported Feature",
  incompatible_file: "Incompatible File",
  conversion_needed: "File Needs Conversion",
  manual_step: "Manual Step Required",
};

const TYPE_COLORS: Record<FollowUpType, string> = {
  unsupported_capability: "bg-red-100 text-red-700",
  incompatible_file: "bg-amber-100 text-amber-700",
  conversion_needed: "bg-blue-100 text-blue-700",
  manual_step: "bg-gray-100 text-gray-700",
};

// ─── Component ──────────────────────────────────────────────

export default function ManualFollowUp({
  items,
}: ManualFollowUpProps): React.JSX.Element {
  if (items.length === 0) return <></>;

  // Group by workspace
  const grouped = new Map<string, FollowUpItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.workspaceName) ?? [];
    existing.push(item);
    grouped.set(item.workspaceName, existing);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-gray-500">
        Manual Follow-Up ({items.length})
      </h3>

      <div className="max-h-60 overflow-y-auto">
        {Array.from(grouped.entries()).map(([workspaceName, wsItems]) => (
          <div
            key={workspaceName}
            className="mb-2 rounded-lg border border-gray-200 px-3 py-2"
          >
            <p className="text-xs font-medium text-gray-900">
              {workspaceName}
            </p>
            <div className="mt-1.5 flex flex-col gap-1">
              {wsItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[item.type]}`}
                  >
                    {TYPE_LABELS[item.type]}
                  </span>
                  <span className="text-[11px] text-gray-600">
                    {item.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
