import type { MemoryItem } from "@/core/schema/types";

export interface MemoryListProps {
  items: MemoryItem[];
}

const CATEGORY_COLORS: Record<string, string> = {
  identity: "bg-violet-100 text-violet-700",
  preference: "bg-blue-100 text-blue-700",
  project: "bg-emerald-100 text-emerald-700",
  skill: "bg-orange-100 text-orange-700",
  relationship: "bg-pink-100 text-pink-700",
  tool: "bg-gray-100 text-gray-700",
  context: "bg-sky-100 text-sky-700",
  instruction: "bg-amber-100 text-amber-700",
};

export default function MemoryList({
  items,
}: MemoryListProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400">No memory items found.</p>
    );
  }

  return (
    <div className="max-h-60 space-y-2 overflow-y-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-gray-200 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm text-gray-700">
              {item.fact}
            </p>
            <span className="shrink-0 text-xs text-gray-400">
              {item.fact.length}c
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[item.category] ?? "bg-gray-100 text-gray-600"}`}
            >
              {item.category}
            </span>
            {item.source === "inferred" && (
              <span className="text-xs text-gray-400">inferred</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
