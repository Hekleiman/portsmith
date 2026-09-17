// ─── Global memory export ───────────────────────────────────
// Claude ("Start import") and Gemini ("Import memory to Gemini") both accept
// a pasted block of text and turn it into memories, so global memory is
// delivered as one block instead of one guided step per fact.

import type { MemoryItem } from "@/core/schema/types";

const CATEGORY_TITLES: Record<MemoryItem["category"], string> = {
  instruction: "How I want responses",
  identity: "About me",
  preference: "Preferences",
  project: "Projects",
  skill: "Skills",
  tool: "Tools I use",
  relationship: "People",
  context: "Other context",
};

const CATEGORY_ORDER: Array<MemoryItem["category"]> = [
  "instruction",
  "identity",
  "preference",
  "project",
  "skill",
  "tool",
  "relationship",
  "context",
];

/** Markdown block listing every memory, grouped by category. */
export function renderMemoryImportText(
  items: MemoryItem[],
  sourceLabel: string,
  customInstructions = "",
): string {
  const instructions = customInstructions.trim();
  if (items.length === 0 && !instructions) return "";

  const lines = [
    `These are the memories ${sourceLabel} kept about me. Please remember them.`,
  ];

  if (instructions) {
    lines.push("", `## My custom instructions from ${sourceLabel}`, instructions);
  }

  for (const category of CATEGORY_ORDER) {
    const group = items
      .filter((i) => i.category === category)
      .sort((a, b) => b.migration.priority - a.migration.priority);
    if (group.length === 0) continue;
    lines.push("", `## ${CATEGORY_TITLES[category]}`);
    for (const item of group) {
      lines.push(`- ${item.fact.replace(/\s+/g, " ").trim()}`);
    }
  }

  return lines.join("\n") + "\n";
}
