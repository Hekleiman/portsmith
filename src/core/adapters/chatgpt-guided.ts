// ─── ChatGPT Guided Instructions ────────────────────────────
// ChatGPT has no automated importer yet, so ChatGPT as a target is a
// guided flow: create a project, paste the instructions, add the files
// and the project memory document.
// UI labels follow OpenAI's "Projects in ChatGPT" help article (2026).

import type { MemoryItem, Workspace } from "@/core/schema/types";
import type {
  MigrationGuidedInstructions,
  MigrationStepFallback,
} from "@/shared/messaging";
import { getInstructionsForTarget } from "@/core/platforms";
import { hasProjectMemory } from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import { buildDownloads } from "./manual-fallback";

const CHATGPT_URL = "https://chatgpt.com/";

export function generateChatGPTInstructions(
  workspace: Workspace,
  sourceLabel = "your previous assistant",
): MigrationGuidedInstructions {
  const instructions = getInstructionsForTarget(workspace, "chatgpt");
  const steps: MigrationStepFallback[] = [];
  const next = (): number => steps.length + 1;

  steps.push({
    id: `${workspace.id}-create`,
    title: "Create a project",
    description:
      'Open ChatGPT, click "New project" in the sidebar and paste the name below. You can also pick an icon and color.',
    copyBlocks: [{ label: "Project name", content: workspace.name }],
    link: CHATGPT_URL,
    actionHint: 'Click "New project", paste the name, create it',
    stepNumber: next(),
  });

  if (instructions.trim()) {
    steps.push({
      id: `${workspace.id}-instructions`,
      title: "Add the instructions",
      description:
        'In the project, click the three dots at the top right, choose "Project settings", paste the instructions and save.',
      copyBlocks: [{ label: "Project instructions", content: instructions }],
      actionHint: 'Three dots → "Project settings" → paste → save',
      stepNumber: next(),
    });
  }

  const downloads = buildDownloads(workspace, sourceLabel);
  const notCopied = workspace.knowledgeFiles.filter((f) => !f.contentRef);
  if (downloads.length > 0 || notCopied.length > 0) {
    const lines = [
      "Add these to the project's files (sources). Plans limit how many files a project can hold (Free 5, Plus/Go 25, Pro and business plans 40).",
    ];
    if (hasProjectMemory(workspace)) {
      lines.push(
        `The project memory file holds what ${sourceLabel} remembered from chats in this project.`,
      );
    }
    if (notCopied.length > 0) {
      lines.push(
        "",
        `Download these from ${sourceLabel} first, since PortSmith couldn't copy them:`,
        ...notCopied.map((f) => `• ${f.originalName}`),
      );
    }
    steps.push({
      id: `${workspace.id}-files`,
      title: "Add files",
      description: lines.join("\n"),
      copyBlocks: [],
      downloads,
      fileNames: notCopied.map((f) => f.originalName),
      actionHint: "Upload the files to the project",
      stepNumber: next(),
    });
  }

  if (workspace.description.trim()) {
    steps.push({
      id: `${workspace.id}-description`,
      title: "Keep the description (optional)",
      description:
        "ChatGPT projects don't have a description field. If it matters, add it to the top of the instructions.",
      copyBlocks: [{ label: "Description", content: workspace.description }],
      stepNumber: next(),
    });
  }

  steps.push({
    id: `${workspace.id}-verify`,
    title: "Try it out",
    description:
      "Start a chat inside the project and send a test message to check the instructions are applied.",
    copyBlocks: [],
    actionHint: "Send a test message in the project",
    stepNumber: next(),
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    steps,
    totalSteps: steps.length,
  };
}

/**
 * ChatGPT saves memories when asked to remember something, so the
 * memories are pasted into a new chat as one request.
 */
export function generateChatGPTMemoryInstructions(
  items: MemoryItem[],
  sourceLabel = "your previous assistant",
  customInstructions = "",
): MigrationStepFallback[] {
  const steps: MigrationStepFallback[] = [];
  if (customInstructions.trim()) {
    steps.push({
      id: "custom-instructions-chatgpt",
      title: "Set your custom instructions",
      description:
        "In ChatGPT, open Settings \u2192 Personalization \u2192 Custom instructions and paste the relevant parts into the matching fields.",
      copyBlocks: [{ label: "Custom instructions", content: customInstructions.trim() }],
      link: CHATGPT_URL,
      actionHint: "Settings \u2192 Personalization \u2192 Custom instructions",
    });
  }
  if (items.length === 0) return steps;
  const block = renderMemoryImportText(items, sourceLabel);
  return [
    ...steps,
    {
      id: "memory-chatgpt",
      title: `Ask ChatGPT to remember ${items.length} thing${items.length === 1 ? "" : "s"}`,
      description:
        "Make sure memory is turned on in ChatGPT's settings (Personalization), then start a new chat outside any project, paste the text below and send it. " +
        "Check Settings → Personalization → Manage memories afterwards to confirm what was saved.",
      copyBlocks: [{ label: "Memories", content: block }],
      link: CHATGPT_URL,
      actionHint: "Paste into a new chat and send",
    },
  ];
}
