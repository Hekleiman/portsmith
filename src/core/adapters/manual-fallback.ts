// ─── Manual fallback cards ──────────────────────────────────
// One consolidated "do it by hand" card per workspace, used when
// automation can't create the project/Gem. Shared by all targets so the
// user always gets the name, description, instructions, project memory
// and downloadable files in one place.

import type { Workspace } from "@/core/schema/types";
import type { MigrationStepFallback, StepDownload } from "@/shared/messaging";
import {
  getInstructionsForTarget,
  platformLabel,
  type PlatformId,
} from "@/core/platforms";
import {
  hasProjectMemory,
  projectMemoryFileName,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";

const CREATE_STEPS: Record<PlatformId, { link: string; steps: string[] }> = {
  claude: {
    link: "https://claude.ai/projects",
    steps: [
      'Open Claude Projects and click "New project".',
      "Paste the name and description, then create the project.",
      'On the project page, open "Instructions" and paste the instructions.',
      'Use the "+" in the project\'s "Context" section to add the files and the project memory document.',
    ],
  },
  gemini: {
    link: "https://gemini.google.com/gems/view",
    steps: [
      'Open the Gem manager in Gemini and click "New Gem" under "My Gems".',
      "Paste the name, description and instructions.",
      'Under "Knowledge", add the files and the project memory document.',
      "Save the Gem.",
    ],
  },
  chatgpt: {
    link: "https://chatgpt.com/",
    steps: [
      'In the ChatGPT sidebar, click "New project" and paste the name.',
      'Open the project\'s menu (three dots), choose "Project settings" and paste the instructions.',
      "Add the files and the project memory document to the project.",
    ],
  },
};

/** Downloads for files we copied from the source (and project memory). */
export function buildDownloads(
  workspace: Workspace,
  sourceLabel: string,
): StepDownload[] {
  const downloads: StepDownload[] = [];
  if (hasProjectMemory(workspace)) {
    downloads.push({
      label: "Project memory",
      fileName: projectMemoryFileName(sourceLabel),
      mimeType: "text/markdown",
      content: renderProjectMemoryMarkdown(workspace, sourceLabel),
    });
  }
  for (const file of workspace.knowledgeFiles) {
    if (file.contentRef) {
      downloads.push({
        label: file.originalName,
        fileName: file.originalName,
        mimeType: file.mimeType,
        contentRef: file.contentRef,
      });
    }
  }
  return downloads;
}

export function buildManualCreateFallback(
  workspace: Workspace,
  target: PlatformId,
  sourceLabel: string,
  reason?: string,
): MigrationStepFallback {
  const plan = CREATE_STEPS[target];
  const instructions = getInstructionsForTarget(workspace, target);
  const description = workspace.description.trim();
  const referenced = workspace.knowledgeFiles.filter((f) => !f.contentRef);

  const lines = [
    ...(reason ? [`${reason}`, ""] : []),
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (referenced.length > 0) {
    lines.push(
      "",
      `These files weren't copied, so upload them from ${sourceLabel} yourself:`,
      ...referenced.map((f) => `• ${f.originalName}`),
    );
  }

  return {
    id: `${workspace.id}-manual-create`,
    title: `Create "${workspace.name}" in ${platformLabel(target)} by hand`,
    description: lines.join("\n"),
    copyBlocks: [
      { label: "Name", content: workspace.name },
      ...(description ? [{ label: "Description", content: description }] : []),
      ...(instructions.trim()
        ? [{ label: "Instructions", content: instructions }]
        : []),
    ],
    downloads: buildDownloads(workspace, sourceLabel),
    link: plan.link,
  };
}

/** What a project created by hand still needs, as one reminder. */
export function handOverNote(
  workspace: Workspace,
  instructions: string,
  memoryDoc: string,
): string {
  const parts: string[] = [];
  if (instructions.trim()) parts.push("the instructions");
  const files = workspace.knowledgeFiles.length;
  if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (memoryDoc) parts.push("the project memory document");
  if (parts.length === 0) return "Created by hand";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Created by hand: check that it has ${list}`;
}
