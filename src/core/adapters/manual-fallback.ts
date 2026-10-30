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
import {
  CHATGPT_INSTRUCTIONS_MAX,
  CHATGPT_PROJECT_NAME_MAX,
  fitInstructions,
  fitProjectName,
} from "@/core/transform/chatgpt-limits";

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
      'In the ChatGPT sidebar, click the + next to "Projects", paste the name and click "Create project".',
      'Open the project\'s menu (three dots), choose "Project settings", paste the instructions and click "Save".',
      'Open the project\'s Sources tab, click "Add sources" and add the files and the project memory document.',
    ],
  },
};

/**
 * The name and instructions to paste into a target, fitted to its limits.
 * Only ChatGPT has limits PortSmith knows of: a longer name is trimmed,
 * and instructions over the limit are cut with the full text moved to a
 * file to add alongside the others.
 */
export function fitForTarget(
  workspace: Workspace,
  target: PlatformId,
  sourceLabel: string,
): {
  name: string;
  nameTrimmed: boolean;
  instructions: string;
  overflow: StepDownload | null;
} {
  const instructions = getInstructionsForTarget(workspace, target);
  if (target !== "chatgpt") {
    return { name: workspace.name, nameTrimmed: false, instructions, overflow: null };
  }
  const name = fitProjectName(workspace.name);
  const fitted = fitInstructions(instructions, sourceLabel);
  return {
    name: name.name,
    nameTrimmed: name.trimmed,
    instructions: fitted.instructions,
    overflow: fitted.overflow
      ? {
          label: "Full instructions",
          fileName: fitted.overflow.fileName,
          mimeType: "text/markdown",
          content: fitted.overflow.content,
        }
      : null,
  };
}

/** Notes on what fitting changed, for the step's description. */
export function fitNotes(fit: ReturnType<typeof fitForTarget>): string[] {
  const notes: string[] = [];
  if (fit.nameTrimmed) {
    notes.push(
      `ChatGPT allows ${CHATGPT_PROJECT_NAME_MAX} characters in a project name, so the name below is shortened.`,
    );
  }
  if (fit.overflow) {
    notes.push(
      `ChatGPT allows ${CHATGPT_INSTRUCTIONS_MAX} characters of instructions, so they are shortened at a paragraph break. Add ${fit.overflow.fileName}, which holds the full text, with the other files.`,
    );
  }
  return notes;
}

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
  const fit = fitForTarget(workspace, target, sourceLabel);
  const instructions = fit.instructions;
  const description = workspace.description.trim();
  const referenced = workspace.knowledgeFiles.filter((f) => !f.contentRef);
  const notes = fitNotes(fit);

  const lines = [
    ...(reason ? [`${reason}`, ""] : []),
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(notes.length > 0 ? ["", ...notes] : []),
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
      { label: "Name", content: fit.name },
      ...(description ? [{ label: "Description", content: description }] : []),
      ...(instructions.trim()
        ? [{ label: "Instructions", content: instructions }]
        : []),
    ],
    downloads: [
      ...(fit.overflow ? [fit.overflow] : []),
      ...buildDownloads(workspace, sourceLabel),
    ],
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
