import type { Workspace, MemoryItem } from "@/core/schema/types";
import type { MigrationStepFallback } from "@/shared/messaging";
import { getInstructionsForTarget } from "@/core/platforms";
import {
  hasProjectMemory,
  projectMemoryEntryCount,
  projectMemoryFileName,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import { buildDownloads } from "./manual-fallback";

// ─── Guided Mode Types ──────────────────────────────────────

export interface CopyBlockData {
  label: string;
  content: string;
}

/** A guided step. Same shape the orchestrator sends to the side panel. */
export type ImportStep = MigrationStepFallback;

export interface ImportInstructions {
  workspaceId: string;
  workspaceName: string;
  steps: ImportStep[];
  totalSteps: number;
}

// ─── Instruction Generation ─────────────────────────────────

/**
 * Build guided-mode steps for importing a single workspace as a Claude Project.
 *
 * Claude uses a two-phase creation flow:
 *   Phase 1 (creation page): Name + Description + "Create project"
 *   Phase 2 (project dashboard): Instructions + Files + Memory + Verify
 */
export function generateInstructions(
  workspace: Workspace,
  sourceLabel = "your previous assistant",
): ImportInstructions {
  const translatedInstructions = getInstructionsForTarget(workspace, "claude");

  // Use workspace name as fallback if description is empty
  const description =
    workspace.description.trim().length > 0
      ? workspace.description
      : workspace.name;

  const steps: ImportStep[] = [];
  let stepNum = 1;

  // ── Phase 1: Project creation page ─────────────────────────

  steps.push({
    id: `${workspace.id}-navigate`,
    title: "Open Claude Projects",
    description:
      "Open the link below. You should see your list of projects (or an empty page if you have none yet).",
    copyBlocks: [],
    link: "https://claude.ai/projects",
    actionHint: "Click the link to open Claude",
    stepNumber: stepNum++,
  });

  steps.push({
    id: `${workspace.id}-create`,
    title: "Start a new project",
    description:
      'Click the "New project" button at the top of the page. This will take you to a new page where you can set up your project.',
    copyBlocks: [],
    actionHint: 'Click "New project"',
    stepNumber: stepNum++,
  });

  steps.push({
    id: `${workspace.id}-name`,
    title: "Paste the project name",
    description:
      'You should see a form with a "Name" field. Click the Name field, then paste the project name below.',
    copyBlocks: [{ label: "Project name", content: workspace.name }],
    actionHint: "Click the Name field, then paste",
    stepNumber: stepNum++,
  });

  steps.push({
    id: `${workspace.id}-description`,
    title: "Paste the description",
    description:
      'In the same form, find the "Description" field below the name. Click it and paste the description.',
    copyBlocks: [{ label: "Description", content: description }],
    actionHint: "Click the Description field, then paste",
    stepNumber: stepNum++,
  });

  steps.push({
    id: `${workspace.id}-save`,
    title: 'Click "Create project"',
    description:
      "Click the \"Create project\" button at the bottom of the form. You'll be redirected to your new project's page, which may take a few seconds.",
    copyBlocks: [],
    actionHint: 'Click "Create project" and wait for redirect',
    stepNumber: stepNum++,
  });

  // ── Phase 2: Project dashboard ──────────────────────

  if (translatedInstructions.trim()) {
    steps.push({
      id: `${workspace.id}-open-instructions`,
      title: "Open the instructions editor",
      description:
        'On your new project\'s page, find the "Instructions" section and click it (or its pencil icon) to open the instructions editor.',
      copyBlocks: [],
      actionHint: 'Find "Instructions" and open the editor',
      stepNumber: stepNum++,
    });

    steps.push({
      id: `${workspace.id}-instructions`,
      title: "Paste the project instructions",
      description: `A text editor will appear. Click inside it and paste the instructions below. (${translatedInstructions.length.toLocaleString()} characters)`,
      copyBlocks: [
        { label: "Project instructions", content: translatedInstructions },
      ],
      actionHint: "Click the text area, then paste",
      stepNumber: stepNum++,
    });

    steps.push({
      id: `${workspace.id}-save-instructions`,
      title: "Save the instructions",
      description:
        'Click the "Save instructions" button to save your project instructions.',
      copyBlocks: [],
      actionHint: 'Click "Save instructions"',
      stepNumber: stepNum++,
    });
  }

  // Knowledge files step: show if workspace has any files
  const copiedFiles = workspace.knowledgeFiles.filter((f) => f.contentRef);
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  const needsConversion = workspace.knowledgeFiles.filter(
    (f) => !f.compatible && f.conversionNeeded,
  );
  const unsupported = workspace.knowledgeFiles.filter(
    (f) => !f.compatible && !f.conversionNeeded,
  );

  if (workspace.knowledgeFiles.length > 0) {
    let filesDescription =
      'Now add your files. On the project page, click the "+" in the "Context" section (the project\'s files) and upload each file.';

    if (copiedFiles.length > 0) {
      filesDescription +=
        "\n\nPortSmith copied the files below, so you can download them here first.";
    } else if (compatibleFiles.length > 0) {
      filesDescription += `\n\nDownload these files from ${sourceLabel} first if you don't have them.`;
    }

    if (needsConversion.length > 0) {
      filesDescription += `\n\nThese files need attention first:`;
      for (const f of needsConversion) {
        filesDescription += `\n• ${f.originalName}: ${f.conversionNeeded}`;
      }
    }

    if (unsupported.length > 0) {
      filesDescription += `\n\n${unsupported.length} file(s) can't be transferred (not supported by Claude):`;
      for (const f of unsupported) {
        filesDescription += `\n• ${f.originalName}`;
      }
    }

    steps.push({
      id: `${workspace.id}-files`,
      title: `Upload project files (${compatibleFiles.length} of ${workspace.knowledgeFiles.length} ready)`,
      description: filesDescription,
      copyBlocks: [],
      fileNames: compatibleFiles.map((f) => f.originalName),
      downloads: buildDownloads({ ...workspace, projectMemory: undefined }, sourceLabel),
      actionHint:
        compatibleFiles.length > 0
          ? 'Upload your files, then click "Mark as done"'
          : 'Handle the files above, then click "Mark as done"',
      stepNumber: stepNum++,
    });
  }

  if (hasProjectMemory(workspace)) {
    const content = renderProjectMemoryMarkdown(workspace, sourceLabel);
    const count = projectMemoryEntryCount(workspace);
    steps.push({
      id: `${workspace.id}-project-memory`,
      title: "Add the project memory",
      description:
        `${sourceLabel} remembered ${count} note${count === 1 ? "" : "s"} from chats in this project. ` +
        'Add them to the project so Claude can use them: click the "+" in the project\'s "Context" section and either upload the downloaded file or add it as text content.',
      copyBlocks: [{ label: "Project memory", content }],
      downloads: [
        {
          label: "Project memory",
          fileName: projectMemoryFileName(sourceLabel),
          mimeType: "text/markdown",
          content,
        },
      ],
      actionHint: "Upload or paste the project memory",
      stepNumber: stepNum++,
    });
  }

  steps.push({
    id: `${workspace.id}-verify`,
    title: "Verify your project",
    description:
      "Start a new chat inside this project and send a test message to confirm the instructions are working as expected.",
    copyBlocks: [],
    actionHint: "Send a test message in the project",
    stepNumber: stepNum++,
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    steps,
    totalSteps: stepNum - 1,
  };
}

/**
 * Guided steps for bringing global memory into Claude through
 * Settings > Memory > "Start import" (Claude reads the pasted text and
 * files it as memories).
 */
export function generateMemoryInstructions(
  items: MemoryItem[],
  sourceLabel = "your previous assistant",
  customInstructions = "",
): ImportStep[] {
  const block = renderMemoryImportText(items, sourceLabel, customInstructions);
  if (!block) return [];
  const what =
    items.length > 0
      ? `your ${items.length} memor${items.length === 1 ? "y" : "ies"}`
      : "your custom instructions";

  return [
    {
      id: "memory-open-import",
      title: "Open Claude's memory import",
      description:
        'Open Claude, go to Settings, then "Memory". Next to "Import memory from other AI providers", click "Start import". ' +
        "You can skip Claude's prompt step: PortSmith already has your memories.",
      copyBlocks: [],
      link: "https://claude.ai/settings",
      actionHint: 'Settings → Memory → "Start import"',
    },
    {
      id: "memory-paste",
      title: `Paste ${what}`,
      description:
        'Paste the text below into the "Paste your memory details here" box and click "Add to memory". ' +
        "Claude may take a while to process imports, and it may leave out details it considers unrelated.",
      copyBlocks: [{ label: "Memories", content: block }],
      actionHint: 'Paste, then click "Add to memory"',
    },
  ];
}
