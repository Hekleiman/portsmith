// ─── Leftover cards ─────────────────────────────────────────
// Automatic runs don't stop to ask. What they couldn't finish is shown on
// the results page as regular step cards, with the text and files needed.

import type { Workspace } from "@/core/schema/types";
import type { KnowledgeLeftover, MigrationStepFallback } from "@/shared/messaging";
import type { PlatformId } from "@/core/platforms";
import { buildGemKnowledgeStep } from "./gemini-guided";
import { buildDownloads, buildManualCreateFallback, fitForTarget } from "./manual-fallback";

/**
 * Files that didn't reach a ChatGPT project's Sources: the remaining
 * copied files, the project memory document and the full-instructions
 * file, each with its download.
 */
function buildChatGPTSourcesCard(
  workspace: Workspace,
  sourceLabel: string,
  leftover: KnowledgeLeftover,
): MigrationStepFallback | null {
  const wanted = new Set(leftover.fileNames);
  const scoped: Workspace = {
    ...workspace,
    knowledgeFiles: workspace.knowledgeFiles.filter(
      (f) => f.contentRef && wanted.has(f.originalName),
    ),
    ...(leftover.projectMemory ? {} : { projectMemory: undefined }),
  };
  const fit = fitForTarget(workspace, "chatgpt", sourceLabel);
  const overflow = leftover.instructionsFile ? fit.overflow : null;
  const downloads = [...(overflow ? [overflow] : []), ...buildDownloads(scoped, sourceLabel)];
  if (downloads.length === 0) return null;

  const lines = [
    'Open the project\'s Sources tab, click "Add sources" and add these files:',
    ...downloads.map((d) => `• ${d.fileName}`),
  ];
  if (overflow) {
    lines.push(
      "",
      `${overflow.fileName} holds the full instructions, which were too long for ChatGPT's instructions field.`,
    );
  }
  if (leftover.projectMemory) {
    lines.push(
      `The project memory file holds what ${sourceLabel} remembered from chats in this project.`,
    );
  }

  return {
    id: `${workspace.id}-sources`,
    title: `Add files to "${fit.name}"`,
    description: lines.join("\n"),
    copyBlocks: [],
    downloads,
    link: leftover.link,
    actionHint: 'Sources tab → "Add sources"',
  };
}

/**
 * Cards for what an automatic run left for the user: items to create by
 * hand, and files that didn't reach their Gem or project.
 */
export function buildLeftoverCards(
  workspaces: Workspace[],
  result: {
    completed: Set<string>;
    manual: Map<string, string>;
    knowledgeLeftovers: Map<string, KnowledgeLeftover>;
    leftoverSteps?: Map<string, MigrationStepFallback[]>;
  },
  target: PlatformId,
  sourceLabel: string,
): MigrationStepFallback[] {
  const cards: MigrationStepFallback[] = [];
  for (const ws of workspaces) {
    const reason = result.manual.get(ws.id);
    if (reason !== undefined && !result.completed.has(ws.id)) {
      cards.push(buildManualCreateFallback(ws, target, sourceLabel, reason));
      continue;
    }
    for (const card of result.leftoverSteps?.get(ws.id) ?? []) {
      cards.push({ ...card, title: `${card.title} ("${ws.name}")` });
    }
    const leftover = result.knowledgeLeftovers.get(ws.id);
    if (!leftover || !result.completed.has(ws.id)) continue;
    if (target === "chatgpt") {
      const card = buildChatGPTSourcesCard(ws, sourceLabel, leftover);
      if (card) cards.push(card);
      continue;
    }
    const card = buildGemKnowledgeStep(ws, sourceLabel, {
      link: leftover.link,
      remaining: { fileNames: leftover.fileNames, projectMemory: leftover.projectMemory },
    });
    if (card) cards.push({ ...card, title: `Add knowledge files to "${ws.name}"` });
  }
  return cards;
}
