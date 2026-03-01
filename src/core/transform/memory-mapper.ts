// ─── Memory Mapper ───────────────────────────────────────────
// Maps raw memory strings (from ChatGPT DOM extraction) into
// typed MemoryItem objects with category, priority, and constraint checks.

import type { MemoryItem } from "@/core/schema/types";

// ─── Constants ───────────────────────────────────────────────

const CLAUDE_MAX_MEMORY_CHARS = 200;
const CLAUDE_MAX_MEMORY_ITEMS = 30;

// ─── Category Detection ─────────────────────────────────────

type MemoryCategory = MemoryItem["category"];

interface CategoryPattern {
  category: MemoryCategory;
  patterns: RegExp[];
  priority: number;
}

const CATEGORY_PATTERNS: CategoryPattern[] = [
  {
    category: "identity",
    priority: 9,
    patterns: [
      /\b(?:name\s+is|I\s+am|works?\s+(?:at|for)|job|role\s+is|position)\b/i,
      /\b(?:lives?\s+in|from|born|age|years?\s+old)\b/i,
      /\b(?:my\s+name|call\s+me)\b/i,
    ],
  },
  {
    category: "preference",
    priority: 8,
    patterns: [
      /\b(?:prefer|like|dislike|favorite|rather|want|enjoy|love|hate)/i,
      /\b(?:always\s+use|never\s+use|don't\s+like)\b/i,
      /\b(?:style|format|tone)\b/i,
    ],
  },
  {
    category: "instruction",
    priority: 7,
    patterns: [
      /\b(?:always|never|should|must|don't|do\s+not|please)\b/i,
      /\b(?:respond|answer|reply|format|write)\b/i,
    ],
  },
  {
    category: "skill",
    priority: 6,
    patterns: [
      /\b(?:knows?|experienced?|expert|proficient|familiar|fluent)\b/i,
      /\b(?:learned|studied|certified|degree)\b/i,
      /\b(?:can\s+(?:code|program|write|speak))\b/i,
    ],
  },
  {
    category: "project",
    priority: 5,
    patterns: [
      /\b(?:project|working\s+on|building|developing|creating)\b/i,
      /\b(?:app|application|website|service|tool|product)\b/i,
      /\b(?:startup|company|team)\b/i,
    ],
  },
  {
    category: "tool",
    priority: 5,
    patterns: [
      /\b(?:uses?|editor|IDE|framework|library|stack|language)\b/i,
      /\b(?:VS\s*Code|Vim|Neovim|Emacs|IntelliJ|WebStorm)\b/i,
      /\b(?:React|Vue|Angular|Node|Python|Rust|Go|Java)\b/i,
    ],
  },
  {
    category: "relationship",
    priority: 4,
    patterns: [
      /\b(?:spouse|partner|wife|husband|child|parent|friend|colleague)\b/i,
      /\b(?:family|team\s+member|manager|boss|mentor)\b/i,
    ],
  },
  {
    category: "context",
    priority: 3,
    patterns: [
      /\b(?:currently|recently|today|this\s+week|right\s+now)\b/i,
      /\b(?:timezone|location|schedule|meeting)\b/i,
    ],
  },
];

function categorize(fact: string): { category: MemoryCategory; priority: number } {
  for (const cp of CATEGORY_PATTERNS) {
    if (cp.patterns.some((p) => p.test(fact))) {
      return { category: cp.category, priority: cp.priority };
    }
  }
  return { category: "context", priority: 3 };
}

// ─── Truncation ──────────────────────────────────────────────

function truncateToLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  // Try to break at a word boundary
  const truncated = text.slice(0, maxChars - 3);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

// ─── Public API ──────────────────────────────────────────────

export function mapMemoryItems(rawMemory: string[]): MemoryItem[] {
  const items: MemoryItem[] = [];

  // Limit to Claude's max items
  const capped = rawMemory.slice(0, CLAUDE_MAX_MEMORY_ITEMS);

  for (let i = 0; i < capped.length; i++) {
    const fact = capped[i]!.trim();
    if (!fact) continue;

    const { category, priority } = categorize(fact);
    const fitsConstraints = fact.length <= CLAUDE_MAX_MEMORY_CHARS;

    const item: MemoryItem = {
      id: `mem-${String(i + 1).padStart(3, "0")}`,
      fact,
      category,
      confidence: 0.8,
      source: "explicit",
      workspaceIds: [],
      migration: {
        fitsConstraints,
        priority,
        ...(fitsConstraints
          ? {}
          : {
              truncatedVersion: truncateToLimit(
                fact,
                CLAUDE_MAX_MEMORY_CHARS,
              ),
            }),
      },
    };

    items.push(item);
  }

  // Sort by priority descending so highest-priority items are first
  items.sort((a, b) => b.migration.priority - a.migration.priority);

  return items;
}

export { CLAUDE_MAX_MEMORY_CHARS, CLAUDE_MAX_MEMORY_ITEMS };
