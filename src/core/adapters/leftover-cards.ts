// ─── Leftover cards ─────────────────────────────────────────
// Automatic runs don't stop to ask. What they couldn't finish is shown on
// the results page as regular step cards, with the text and files needed.

import type { Workspace } from "@/core/schema/types";
import type { KnowledgeLeftover, MigrationStepFallback } from "@/shared/messaging";
import type { PlatformId } from "@/core/platforms";
import { buildGemKnowledgeStep } from "./gemini-guided";
import { buildManualCreateFallback } from "./manual-fallback";

/**
 * Cards for what an automatic run left for the user: items to create by
 * hand, and knowledge files that didn't reach their Gem.
 */
export function buildLeftoverCards(
  workspaces: Workspace[],
  result: {
    completed: Set<string>;
    manual: Map<string, string>;
    knowledgeLeftovers: Map<string, KnowledgeLeftover>;
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
    const leftover = result.knowledgeLeftovers.get(ws.id);
    if (leftover && result.completed.has(ws.id)) {
      const card = buildGemKnowledgeStep(ws, sourceLabel, {
        link: leftover.link,
        remaining: { fileNames: leftover.fileNames, projectMemory: leftover.projectMemory },
      });
      if (card) cards.push({ ...card, title: `Add knowledge files to "${ws.name}"` });
    }
  }
  return cards;
}
