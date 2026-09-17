// ─── Gemini Guided Instructions ─────────────────────────────
// Step-by-step manual instructions for creating Gems in Gemini,
// parallel to claude-adapter.generateInstructions().

import type {
  MemoryItem,
  PlatformIdentifier,
  Workspace,
} from "@/core/schema/types";
import type {
  MigrationGuidedInstructions,
  MigrationStepFallback,
} from "@/shared/messaging";
import { getInstructionsForTarget } from "@/core/platforms";
import { hasProjectMemory } from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import { buildDownloads } from "./manual-fallback";

export const GEMINI_GEM_MANAGER_URL = "https://gemini.google.com/gems/view";

/** Step for adding copied files and project memory to a Gem's Knowledge. */
export function buildGemKnowledgeStep(
  workspace: Workspace,
  sourceLabel: string,
  stepNumber?: number,
): MigrationStepFallback | null {
  const downloads = buildDownloads(workspace, sourceLabel);
  const notCopied = workspace.knowledgeFiles.filter((f) => !f.contentRef);
  if (downloads.length === 0 && notCopied.length === 0) return null;

  const lines = [
    'Open the Gem, find "Knowledge" and add the files below, then save the Gem.',
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

  return {
    id: `${workspace.id}-knowledge`,
    title: "Add knowledge files",
    description: lines.join("\n"),
    copyBlocks: [],
    downloads,
    fileNames: notCopied.map((f) => f.originalName),
    link: GEMINI_GEM_MANAGER_URL,
    actionHint: 'Add the files under "Knowledge", then save',
    ...(stepNumber !== undefined ? { stepNumber } : {}),
  };
}

/**
 * Generate guided (manual) instructions for creating a Gem
 * in Gemini from a workspace.
 */
export function generateGeminiInstructions(
  workspace: Workspace,
  sourceLabel = "your previous assistant",
): MigrationGuidedInstructions {
  const instructions = getInstructionsForTarget(workspace, "gemini");
  const steps: MigrationStepFallback[] = [];
  const next = (): number => steps.length + 1;

  steps.push({
    id: `${workspace.id}-navigate`,
    title: "Open the Gem manager",
    description:
      'Open the Gem manager and click "New Gem" in the "My Gems" section.',
    copyBlocks: [],
    link: GEMINI_GEM_MANAGER_URL,
    actionHint: 'Click "New Gem"',
    stepNumber: next(),
  });

  steps.push({
    id: `${workspace.id}-name`,
    title: "Enter the Gem name",
    description: 'Paste the name into the "Name" field.',
    copyBlocks: [{ label: "Gem name", content: workspace.name }],
    stepNumber: next(),
  });

  if (workspace.description.trim()) {
    steps.push({
      id: `${workspace.id}-description`,
      title: "Enter the description",
      description: 'Paste the description into the "Description" field.',
      copyBlocks: [{ label: "Description", content: workspace.description }],
      stepNumber: next(),
    });
  }

  if (instructions.trim()) {
    steps.push({
      id: `${workspace.id}-instructions`,
      title: "Paste the instructions",
      description: 'Paste the instructions into the "Instructions" field.',
      copyBlocks: [{ label: "Gem instructions", content: instructions }],
      stepNumber: next(),
    });
  }

  const knowledge = buildGemKnowledgeStep(workspace, sourceLabel, next());
  if (knowledge) steps.push(knowledge);

  steps.push({
    id: `${workspace.id}-save`,
    title: "Save the Gem",
    description: "Save your new Gem. It will appear under \"My Gems\".",
    copyBlocks: [],
    actionHint: "Save the Gem",
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
 * Global memory for Gemini goes through Settings & help >
 * "Import memory to Gemini" (personal accounts, 18+, not in the EEA,
 * Switzerland or the UK as of 2026).
 */
export function generateGeminiMemoryInstructions(
  items: MemoryItem[],
  sourceLabel = "your previous assistant",
  customInstructions = "",
  sourcePlatform?: SourcePlatform,
): MigrationStepFallback[] {
  const chatImport = buildGeminiChatImportStep(sourcePlatform);
  const block = renderMemoryImportText(items, sourceLabel, customInstructions);
  if (!block) return chatImport ? [chatImport] : [];
  const what =
    items.length > 0
      ? `your ${items.length} memor${items.length === 1 ? "y" : "ies"}`
      : "your custom instructions";
  return [
    {
      id: "memory-open-import",
      title: "Open Gemini's memory import",
      description:
        'In Gemini, click "Settings & help" at the bottom left, then "Import memory to Gemini". ' +
        "You can skip Gemini's prompt step: PortSmith already has your memories. " +
        "This option needs a personal Google account and isn't offered in the EEA, Switzerland or the UK.",
      copyBlocks: [],
      link: "https://gemini.google.com/app",
      actionHint: 'Settings & help → "Import memory to Gemini"',
    },
    {
      id: "memory-paste",
      title: `Paste ${what}`,
      description: 'Paste the text below into the text field and click "Add memory".',
      copyBlocks: [{ label: "Memories", content: block }],
      actionHint: 'Paste, then click "Add memory"',
    },
    ...(chatImport ? [chatImport] : []),
  ];
}

type SourcePlatform = PlatformIdentifier["platform"];

export const GEMINI_IMPORT_URL = "https://gemini.google.com/import";

const CHAT_EXPORT_STEPS: Partial<Record<SourcePlatform, string>> = {
  chatgpt:
    "In ChatGPT, click your name at the bottom left, then Settings and Data controls. " +
    'Next to "Export data", click "Export", then "Confirm Export". ' +
    "ChatGPT emails you a link to download a .zip file.",
  claude:
    "In Claude, click your name at the bottom left, then Settings and Privacy. " +
    'Next to "Export data", click "Export", choose the date range and click "Export" again. ' +
    "Claude emails you a download link for a .zip file. The link expires after 24 hours.",
};

/**
 * Optional last step: Gemini imports ChatGPT and Claude chat exports itself
 * (Settings & help > "Import memory to Gemini" > "Import chats").
 * PortSmith doesn't move chat history, so this only points the way.
 */
export function buildGeminiChatImportStep(
  sourcePlatform: SourcePlatform | undefined,
): MigrationStepFallback | null {
  const exportSteps = sourcePlatform ? CHAT_EXPORT_STEPS[sourcePlatform] : undefined;
  if (!exportSteps) return null;
  return {
    id: "memory-chat-history",
    title: "Bring your chat history (optional)",
    description: [
      "PortSmith doesn't move your chats, but Gemini can import them from an export.",
      "",
      `1. ${exportSteps}`,
      '2. When the .zip is ready, open Gemini, click "Settings & help" at the bottom left, then "Import memory to Gemini".',
      '3. Under "Import chats", click "Add" and choose the .zip file. Gemini can take up to a day to process it.',
      "",
      "Chat import needs a personal Google account and you must be 18 or older. It isn't available in the EEA, Switzerland or the UK.",
    ].join("\n"),
    copyBlocks: [],
    link: GEMINI_IMPORT_URL,
    actionHint: 'Under "Import chats", click "Add" and choose the .zip',
    optional: true,
  };
}
