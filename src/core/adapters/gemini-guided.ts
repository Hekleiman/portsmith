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
import { getInstructionsForTarget, platformLabel } from "@/core/platforms";
import { hasProjectMemory } from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import { buildDownloads } from "./manual-fallback";

export const GEMINI_GEM_MANAGER_URL = "https://gemini.google.com/gems/view";

/** Gem editor URL, on the Google account the run used ("/u/1/"). */
export function geminiGemEditUrl(gemId: string, account?: string | null): string {
  const path = account && /^\/u\/\d+\/$/.test(account) ? account : "/";
  return `https://gemini.google.com${path}gems/edit/${encodeURIComponent(gemId)}`;
}

export interface GemKnowledgeStepOptions {
  stepNumber?: number;
  /** Where the user adds the files (the Gem editor when the Gem is known) */
  link?: string;
  /**
   * Only these copied files still need adding (by name), and whether the
   * project memory document does. Omit to list everything.
   */
  remaining?: { fileNames: string[]; projectMemory: boolean };
}

/** Step for adding copied files and project memory to a Gem's Knowledge. */
export function buildGemKnowledgeStep(
  workspace: Workspace,
  sourceLabel: string,
  options: GemKnowledgeStepOptions = {},
): MigrationStepFallback | null {
  const { stepNumber, remaining } = options;
  const wanted = remaining ? new Set(remaining.fileNames) : null;
  const memoryNeeded = hasProjectMemory(workspace) && (remaining?.projectMemory ?? true);
  const scoped: Workspace = {
    ...workspace,
    knowledgeFiles: wanted
      ? workspace.knowledgeFiles.filter((f) => f.contentRef && wanted.has(f.originalName))
      : workspace.knowledgeFiles,
    ...(memoryNeeded ? {} : { projectMemory: undefined }),
  };
  const downloads = buildDownloads(scoped, sourceLabel);
  const notCopied = workspace.knowledgeFiles.filter((f) => !f.contentRef);
  if (downloads.length === 0 && notCopied.length === 0) return null;

  const lines = [
    options.link
      ? 'Open the Gem, click the "+" under "Knowledge" and add the files below, then click "Update".'
      : 'Open the Gem, find "Knowledge" and add the files below, then save the Gem.',
  ];
  if (memoryNeeded) {
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
    link: options.link ?? GEMINI_GEM_MANAGER_URL,
    actionHint: options.link
      ? 'Add the files under "Knowledge", then click "Update"'
      : 'Add the files under "Knowledge", then save',
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

  const knowledge = buildGemKnowledgeStep(workspace, sourceLabel, { stepNumber: next() });
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
  /** What Gemini said about the entries it refused, most common first. */
  refusalReasons: string[] = [],
): MigrationStepFallback[] {
  const chatImport = buildGeminiChatImportStep(sourcePlatform);
  const block = renderMemoryImportText(items, sourceLabel, customInstructions);
  if (!block) return chatImport ? [chatImport] : [];

  // Name what is missing, so it's clear this is the leftover and not
  // everything. The first lines of each memory are the recognisable part.
  const preview = items.slice(0, 5).map((i) => `• ${firstLine(i.fact)}`);
  const more = items.length - preview.length;
  const what =
    items.length > 0
      ? `${items.length} memor${items.length === 1 ? "y" : "ies"}`
      : "your custom instructions";

  return [
    {
      id: "memory-paste",
      title: `Add the ${what} Gemini didn't take`,
      description: [
        items.length > 0
          ? `These ${items.length} didn't save one by one. Everything else is already in Gemini.`
          : "Your custom instructions didn't save on their own.",
        ...(refusalReasons.length > 0 ? [`Gemini's reason: ${refusalReasons[0]}`] : []),
        ...(preview.length > 0
          ? ["", "What's missing:", ...preview, ...(more > 0 ? [`• and ${more} more`] : [])]
          : []),
      ].join("\n"),
      copyBlocks: [{ label: `Missing ${what}`, content: block }],
      actions: [
        {
          label: "Copy, then open Gemini's import page",
          url: GEMINI_IMPORT_URL,
          note: 'Copy the text above, paste it into "Paste the response here" and click "Add memory". PortSmith already has your memories, so Gemini\'s prompt step can be skipped. Import needs a personal Google account and isn\'t offered in the EEA, Switzerland or the UK.',
        },
      ],
      link: GEMINI_IMPORT_URL,
      actionHint: 'Paste, then click "Add memory"',
    },
    ...(chatImport ? [chatImport] : []),
  ];
}

/** First sentence or line of a memory, trimmed for a list. */
function firstLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  const cut = line.length > max ? `${line.slice(0, max - 1).trimEnd()}\u2026` : line;
  return cut;
}


type SourcePlatform = PlatformIdentifier["platform"];

export const GEMINI_IMPORT_URL = "https://gemini.google.com/import";

const CHAT_EXPORT_PAGES: Partial<
  Record<SourcePlatform, { url: string; note: string }>
> = {
  chatgpt: {
    url: "https://chatgpt.com/#settings/DataControls",
    note: 'Under "Export data", click "Export", then "Confirm export". ChatGPT emails or texts a download link when the .zip is ready, which can take up to 7 days. The link expires 24 hours after you get it.',
  },
  claude: {
    url: "https://claude.ai/settings/data-privacy-controls",
    note: 'Next to "Export data", click "Export", choose the date range and click "Export" again. Claude emails a download link for a .zip, and the link expires after 24 hours.',
  },
};


/**
 * Optional last step: Gemini imports ChatGPT and Claude chat exports itself
 * (Settings & help > "Import memory to Gemini" > "Import chats").
 * PortSmith doesn't move chat history, so this only points the way.
 */
export function buildGeminiChatImportStep(
  sourcePlatform: SourcePlatform | undefined,
): MigrationStepFallback | null {
  const exportPage = sourcePlatform ? CHAT_EXPORT_PAGES[sourcePlatform] : undefined;
  if (!exportPage) return null;
  const label = platformLabel(sourcePlatform);
  return {
    id: "memory-chat-history",
    title: "Bring your chat history (optional)",
    description: `PortSmith doesn't move your chats, but Gemini can import them from a ${label} export. Each button below opens the page for that part.`,
    copyBlocks: [],
    actions: [
      {
        label: `Open ${label}'s data export`,
        url: exportPage.url,
        note: exportPage.note,
      },
      {
        label: "Open Gemini's import page",
        url: GEMINI_IMPORT_URL,
        note: 'Under "Import chats", click "Add" and choose the .zip. Gemini can take up to a day to process it.',
      },
    ],
    link: GEMINI_IMPORT_URL,
    optional: true,
  };
}

