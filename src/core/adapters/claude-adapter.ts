import type { Workspace, MemoryItem } from "@/core/schema/types";

// ─── Guided Mode Types ──────────────────────────────────────

export interface CopyBlockData {
  label: string;
  content: string;
}

export interface ImportStep {
  id: string;
  title: string;
  description: string;
  copyBlocks: CopyBlockData[];
  fileNames?: string[];
  link?: string;
  actionHint?: string;
  stepNumber?: number;
}

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
 *   Phase 2 (project dashboard): Instructions + Files + Verify
 */
export function generateInstructions(workspace: Workspace): ImportInstructions {
  const translatedInstructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;

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
      'Click the "Create project" button at the bottom of the form. You\'ll be redirected to your new project\'s page \u2014 this may take a few seconds.',
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
        'On your new project\'s page, find the "Instructions" section. Click the "+" button or "Add content" next to it to open the instructions editor.',
      copyBlocks: [],
      actionHint: 'Find "Instructions" and click "+" to add',
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
        'Click the "Save" button to save your project instructions.',
      copyBlocks: [],
      actionHint: 'Click "Save"',
      stepNumber: stepNum++,
    });
  }

  // Knowledge files step — show if workspace has any files
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  const needsConversion = workspace.knowledgeFiles.filter(
    (f) => !f.compatible && f.conversionNeeded,
  );
  const unsupported = workspace.knowledgeFiles.filter(
    (f) => !f.compatible && !f.conversionNeeded,
  );

  if (workspace.knowledgeFiles.length > 0) {
    let filesDescription =
      'Your project has been created! Now add your files.\n\n';

    if (compatibleFiles.length > 0) {
      filesDescription +=
        'On your project page, look for a "Knowledge" section or an "Add content" button. Click it and upload the files listed below.\n\nIf you haven\'t downloaded these from ChatGPT yet, open your ChatGPT project in another tab and download each file first.';
    }

    if (needsConversion.length > 0) {
      filesDescription += `\n\nThese files need to be converted first:`;
      for (const f of needsConversion) {
        filesDescription += `\n\u2022 ${f.originalName} \u2014 ${f.conversionNeeded}`;
      }
    }

    if (unsupported.length > 0) {
      filesDescription += `\n\n${unsupported.length} file(s) can't be transferred (not supported by Claude):`;
      for (const f of unsupported) {
        filesDescription += `\n\u2022 ${f.originalName}`;
      }
    }

    steps.push({
      id: `${workspace.id}-files`,
      title: `Upload project files (${compatibleFiles.length} of ${workspace.knowledgeFiles.length} ready)`,
      description: filesDescription,
      copyBlocks: [],
      fileNames: compatibleFiles.map((f) => f.originalName),
      actionHint: compatibleFiles.length > 0
        ? 'Upload your files, then click "Done" below'
        : 'Convert files first, then upload and click "Done"',
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

/** Build guided-mode steps for adding memory items to Claude. */
export function generateMemoryInstructions(
  items: MemoryItem[],
): ImportStep[] {
  if (items.length === 0) return [];

  const steps: ImportStep[] = [
    {
      id: "memory-navigate",
      title: "Go to Settings",
      description:
        'Open Claude Settings, then navigate to the "Memory" section to review and add memory items.',
      copyBlocks: [],
      link: "https://claude.ai/settings",
    },
  ];

  // Sort by priority descending so highest-priority items come first
  const sorted = [...items].sort(
    (a, b) => b.migration.priority - a.migration.priority,
  );

  for (const item of sorted) {
    const content = item.migration.truncatedVersion ?? item.fact;
    steps.push({
      id: `memory-${item.id}`,
      title: `Add memory: ${item.category}`,
      description: `Add this ${item.category} fact to Claude's memory.`,
      copyBlocks: [{ label: "Memory item", content }],
    });
  }

  return steps;
}
