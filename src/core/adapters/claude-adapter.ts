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

/** Build guided-mode steps for importing a single workspace as a Claude Project. */
export function generateInstructions(workspace: Workspace): ImportInstructions {
  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;

  const steps: ImportStep[] = [
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
        'Click the "Create a project" button (or the + icon) to start a new project.',
      copyBlocks: [],
    },
    {
      id: `${workspace.id}-name`,
      title: "Enter the project name",
      description: "Paste the project name into the name field.",
      copyBlocks: [{ label: "Project name", content: workspace.name }],
    },
    {
      id: `${workspace.id}-description`,
      title: "Enter the description",
      description: "Paste the project description.",
      copyBlocks: [
        { label: "Description", content: workspace.description },
      ],
    },
    {
      id: `${workspace.id}-instructions`,
      title: "Paste the project instructions",
      description: `Paste these instructions into the project instructions field (${instructions.length.toLocaleString()} chars).`,
      copyBlocks: [
        { label: "Project instructions", content: instructions },
      ],
    },
  ];

  // Knowledge files step — only if there are files to upload
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  if (compatibleFiles.length > 0) {
    steps.push({
      id: `${workspace.id}-files`,
      title: "Upload knowledge files",
      description:
        "Upload the following files to the project knowledge base. You can drag and drop them into the project.",
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
