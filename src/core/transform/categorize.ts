// ─── Category Detection ─────────────────────────────────────
// Keyword-based category guess for Claude projects and Gemini Gems.
// Stems are matched as word prefixes ("writ" matches "writing"), which the
// previous per-file copies got wrong by requiring a word boundary after
// the stem.

import type { Workspace } from "@/core/schema/types";

const CATEGORY_PATTERNS: Array<{ category: Workspace["category"]; re: RegExp }> = [
  { category: "coding", re: /\b(code|coding|program\w*|debug\w*|develop\w*|software|api|typescript|python|javascript)\b/i },
  { category: "writing", re: /\b(writ\w*|blog\w*|article\w*|essay\w*|copywrit\w*|edit(?:or|ing)?|proofread\w*|draft\w*)\b/i },
  { category: "research", re: /\b(research\w*|analy[sz]\w*|investigat\w*|stud(?:y|ies)|explor\w*|paper\w*)\b/i },
  { category: "data_analysis", re: /\b(data|statistic\w*|chart\w*|csv|excel|dashboard\w*)\b/i },
  { category: "creative", re: /\b(creativ\w*|design\w*|art|artist\w*|stor(?:y|ies)|fiction|brainstorm\w*|muse)\b/i },
  { category: "business", re: /\b(business\w*|strateg\w*|marketing|sales|financ\w*|advisor)\b/i },
  { category: "education", re: /\b(teach\w*|tutor\w*|learn\w*|explain\w*|lesson\w*|student\w*|coach\w*)\b/i },
  { category: "personal", re: /\b(personal|life|health\w*|fitness|recipe\w*|travel\w*)\b/i },
  { category: "customer_support", re: /\b(support|customer\w*|help\s*desk|ticket\w*|faq\w*)\b/i },
];

export function categorize(name: string, instructions: string): Workspace["category"] {
  const text = `${name} ${instructions}`;
  for (const { category, re } of CATEGORY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return "other";
}
