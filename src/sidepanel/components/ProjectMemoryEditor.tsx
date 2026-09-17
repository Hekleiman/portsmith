import { useMemo } from "react";
import type { ProjectMemory } from "@/core/schema/types";
import {
  parsePastedProjectMemory,
  projectMemoryCapturePrompt,
} from "@/core/transform/project-memory";
import CopyBlock from "./CopyBlock";

export interface ProjectMemoryEditorProps {
  workspaceName: string;
  sourcePlatform: string;
  sourceLabel: string;
  targetLabel: string;
  original: ProjectMemory | undefined;
  /** Editable text (entries as "## Title" sections) */
  value: string;
  onChange: (value: string) => void;
  /** Link to the project on the source platform, when known */
  sourceUrl?: string;
}

const SOURCE_HINT: Record<string, string> = {
  claude: "Claude remembered these notes from chats in this project.",
  chatgpt:
    "ChatGPT doesn't let apps read project memory, so capture it with the prompt below: open the project in ChatGPT, start a new chat inside it, paste the prompt, and paste the answer here.",
  gemini:
    "Gems don't have their own memory. If you have notes that belong with this Gem, paste them here.",
};

export default function ProjectMemoryEditor({
  workspaceName,
  sourcePlatform,
  sourceLabel,
  targetLabel,
  original,
  value,
  onChange,
  sourceUrl,
}: ProjectMemoryEditorProps): React.JSX.Element {
  const entryCount = useMemo(() => parsePastedProjectMemory(value).length, [value]);
  const prompt = projectMemoryCapturePrompt(workspaceName);
  const capturedFrom =
    original?.source === "manual" ? "added by you" : `from ${sourceLabel}`;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-700">
        {SOURCE_HINT[sourcePlatform] ?? SOURCE_HINT.gemini}
      </p>

      {sourcePlatform === "chatgpt" && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-2">
          <p className="text-xs font-medium text-violet-900">
            Capture it from ChatGPT
          </p>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs font-medium text-blue-800 hover:underline"
            >
              Open ChatGPT, then this project from the sidebar &rarr;
            </a>
          )}
          <CopyBlock label="prompt" content={prompt} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="project-memory" className="text-xs font-medium text-gray-600">
            Project memory for {targetLabel}
          </label>
          <span className="text-xs text-gray-600">
            {entryCount} note{entryCount === 1 ? "" : "s"}
            {original && original.entries.length > 0 ? ` (${capturedFrom})` : ""}
          </span>
        </div>
        <textarea
          id="project-memory"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={value ? 10 : 5}
          placeholder={"## Goals\n- ...\n\n## Decisions\n- ..."}
          className="mt-1 w-full resize-y rounded-lg border border-violet-200 bg-white p-3 font-mono text-xs text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-1 text-[11px] text-gray-600">
          Delete anything you don&apos;t want to carry over. Each &quot;## &quot;
          heading becomes one note. It&apos;s added to the new project as a
          document named after {sourceLabel}.
        </p>
      </div>
    </div>
  );
}
