import type { Workspace } from "@/core/schema/types";
import { projectMemoryEntryCount } from "@/core/transform/project-memory";
import ConfidenceBadge from "./ConfidenceBadge";
import WarningBadge from "./WarningBadge";
import FileCompatibilityList from "./FileCompatibilityList";

export interface WorkspaceCardProps {
  workspace: Workspace;
  accepted: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** Name of the target, when its instructions differ from the original */
  adaptedFor?: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  coding: "Coding",
  writing: "Writing",
  research: "Research",
  data_analysis: "Data Analysis",
  creative: "Creative",
  business: "Business",
  education: "Education",
  personal: "Personal",
  customer_support: "Support",
  other: "Other",
};

export default function WorkspaceCard({
  workspace,
  accepted,
  onToggle,
  onEdit,
  adaptedFor = null,
}: WorkspaceCardProps): React.JSX.Element {
  const { name, category, migration, knowledgeFiles, description } = workspace;
  const memoryNotes = projectMemoryEntryCount(workspace);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        accepted
          ? "border-gray-200 bg-white"
          : "border-gray-100 bg-gray-50 opacity-60"
      }`}
    >
      {/* Top row: name + toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium text-gray-900">
            {name}
          </h4>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
              {description}
            </p>
          )}
        </div>

        {/* Accept/reject toggle */}
        <button
          type="button"
          onClick={onToggle}
          role="switch"
          aria-checked={accepted}
          aria-label={`Include ${name}`}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            accepted ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              accepted ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Badges row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {CATEGORY_LABELS[category] ?? category}
        </span>
        <ConfidenceBadge confidence={migration.confidence} />
        <WarningBadge count={migration.warnings.length} />
        {knowledgeFiles.length > 0 && (
          <span className="text-xs text-gray-600">
            {knowledgeFiles.length} file{knowledgeFiles.length !== 1 ? "s" : ""}
          </span>
        )}
        {adaptedFor && (
          <span
            className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900"
            title="Open the workspace to compare with the original or undo the changes"
          >
            Instructions adjusted for {adaptedFor}
          </span>
        )}
        {memoryNotes > 0 && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
            Project memory: {memoryNotes} note{memoryNotes !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Warnings preview (collapsed) */}
      {migration.warnings.length > 0 && accepted && (
        <div className="mt-2 space-y-1">
          {migration.warnings.slice(0, 2).map((w, i) => (
            <p key={i} className="text-xs text-amber-800">
              {w}
            </p>
          ))}
          {migration.warnings.length > 2 && (
            <p className="text-xs text-gray-600">
              +{migration.warnings.length - 2} more
            </p>
          )}
        </div>
      )}

      {/* File compatibility */}
      {accepted && knowledgeFiles.length > 0 && (
        <FileCompatibilityList files={knowledgeFiles} />
      )}

      {/* Edit button */}
      {accepted && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-blue-800 hover:text-blue-900"
          >
            Review and edit
          </button>
        </div>
      )}
    </div>
  );
}
