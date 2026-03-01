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
}

export interface ImportInstructions {
  workspaceId: string;
  workspaceName: string;
  steps: ImportStep[];
}

// ─── Instruction Generation ─────────────────────────────────

/**
 * Build guided-mode steps for importing a single workspace as a Claude Project.
 *
 * Claude uses a two-phase creation flow:
 *   Phase 1 (creation modal): Name + Description + "Create project"
 *   Phase 2 (project dashboard): Instructions + Files + Verify
 */
export function generateInstructions(workspace: Workspace): ImportInstructions {
  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;

  // Use workspace name as fallback if description is empty
  const description =
    workspace.description.trim().length > 0
      ? workspace.description
      : workspace.name;

  const steps: ImportStep[] = [
    // ── Phase 1: Creation modal ─────────────────────────
    {
      id: `${workspace.id}-navigate`,
      title: "Go to Claude Projects",
      description: "Open the Claude Projects page in your browser.",
      copyBlocks: [],
      link: "https://claude.ai/projects",
    },
    {
      id: `${workspace.id}-create`,
      title: "Create a new project",
      description:
        'On the Projects page, click the "Create a project" button (or the + icon) to open the creation modal.',
      copyBlocks: [],
    },
    {
      id: `${workspace.id}-name`,
      title: "Enter the project name",
      description:
        "On the project creation screen, paste the project name into the Name field.",
      copyBlocks: [{ label: "Project name", content: workspace.name }],
    },
    {
      id: `${workspace.id}-description`,
      title: "Enter the description",
      description:
        "On the project creation screen, paste the description into the Description field.",
      copyBlocks: [{ label: "Description", content: description }],
    },
    {
      id: `${workspace.id}-save`,
      title: 'Click "Create project"',
      description:
        'Click the "Create project" button. After creation, you\'ll be taken to the project dashboard — this is a different page where you\'ll add instructions.',
      copyBlocks: [],
    },
  ];

  // ── Phase 2: Project dashboard ──────────────────────
  if (instructions.length > 0) {
    steps.push(
      {
        id: `${workspace.id}-open-instructions`,
        title: "Open the instructions editor",
        description:
          'After the project is created, you\'ll be on the project dashboard. Scroll down to the "Instructions" section and click "Set project instructions" or the "+" button to open the editor.',
        copyBlocks: [],
      },
      {
        id: `${workspace.id}-instructions`,
        title: "Paste the project instructions",
        description: `On the project dashboard, paste these instructions into the instructions editor (${instructions.length.toLocaleString()} chars). Note: instructions go on this second page, not the creation modal.`,
        copyBlocks: [
          { label: "Project instructions", content: instructions },
        ],
      },
      {
        id: `${workspace.id}-save-instructions`,
        title: "Save the instructions",
        description:
          'Click "Save" to save the project instructions on the dashboard.',
        copyBlocks: [],
      },
    );
  }

  // Knowledge files step — only if there are files to upload
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  if (compatibleFiles.length > 0) {
    steps.push({
      id: `${workspace.id}-files`,
      title: "Upload knowledge files",
      description:
        'On the project dashboard, upload the following files to the project knowledge base. You can drag and drop them or use the "Add content" button.',
      copyBlocks: [],
      fileNames: compatibleFiles.map((f) => f.originalName),
    });
  }

  steps.push({
    id: `${workspace.id}-verify`,
    title: "Verify the project",
    description: `Open the "${workspace.name}" project and send a test message to confirm everything is set up correctly.`,
    copyBlocks: [],
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    steps,
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
