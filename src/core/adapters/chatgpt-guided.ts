// ─── ChatGPT Guided Instructions ────────────────────────────
// The guided route into ChatGPT (Autofill and Hybrid use the importer in
// content-scripts/chatgpt/importer.ts): create a project, paste the
// instructions, add the files and the project memory document. The name
// and instructions are fitted to ChatGPT's limits first, so the user is
// never asked to paste text ChatGPT refuses.
// UI labels as seen on chatgpt.com on 2026-10-30.

import type { MemoryItem, Workspace } from "@/core/schema/types";
import type {
  MigrationGuidedInstructions,
  MigrationStepFallback,
} from "@/shared/messaging";
import { hasProjectMemory } from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import { buildDownloads, fitForTarget } from "./manual-fallback";
import {
  CHATGPT_INSTRUCTIONS_MAX,
  CHATGPT_PROJECT_NAME_MAX,
} from "@/core/transform/chatgpt-limits";

const CHATGPT_URL = "https://chatgpt.com/";

export function generateChatGPTInstructions(
  workspace: Workspace,
  sourceLabel = "your previous assistant",
): MigrationGuidedInstructions {
  const fit = fitForTarget(workspace, "chatgpt", sourceLabel);
  const instructions = fit.instructions;
  const steps: MigrationStepFallback[] = [];
  const next = (): number => steps.length + 1;

  const createLines = [
    'Open ChatGPT, click the + next to "Projects" in the sidebar, paste the name below and click "Create project".',
  ];
  if (fit.nameTrimmed) {
    createLines.push(
      "",
      `ChatGPT allows ${CHATGPT_PROJECT_NAME_MAX} characters in a project name, so "${workspace.name.trim()}" is shortened to the name below.`,
    );
  }
  steps.push({
    id: `${workspace.id}-create`,
    title: "Create a project",
    description: createLines.join("\n"),
    copyBlocks: [{ label: "Project name", content: fit.name }],
    link: CHATGPT_URL,
    actionHint: 'Click the + next to "Projects", paste the name, click "Create project"',
    stepNumber: next(),
  });

  if (instructions.trim()) {
    const lines = [
      'In the project, click the three dots at the top right, choose "Project settings", paste the instructions and click "Save".',
    ];
    if (fit.overflow) {
      lines.push(
        "",
        `ChatGPT allows ${CHATGPT_INSTRUCTIONS_MAX} characters of instructions, so these are shortened at a paragraph break. The full text is in ${fit.overflow.fileName}, which you add with the files in the next step.`,
      );
    }
    steps.push({
      id: `${workspace.id}-instructions`,
      title: "Add the instructions",
      description: lines.join("\n"),
      copyBlocks: [{ label: "Project instructions", content: instructions }],
      actionHint: 'Three dots → "Project settings" → paste → save',
      stepNumber: next(),
    });
  }

  const downloads = [
    ...(fit.overflow ? [fit.overflow] : []),
    ...buildDownloads(workspace, sourceLabel),
  ];
  const notCopied = workspace.knowledgeFiles.filter((f) => !f.contentRef);
  if (downloads.length > 0 || notCopied.length > 0) {
    const lines = [
      'Open the project\'s Sources tab, click "Add sources" and add these files. Plans limit how many files a project can hold (Free 5, Plus/Go 25, Pro and business plans 40).',
    ];
    if (fit.overflow) {
      lines.push(`${fit.overflow.fileName} holds the full instructions.`);
    }
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
      actionHint: 'Sources tab → "Add sources"',
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
