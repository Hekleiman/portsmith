// ─── Project Memory ─────────────────────────────────────────
// Turns project-scoped memory into a portable markdown document, and
// parses memory that the user pastes in manually.
//
// Delivery strategy: none of the target platforms offer a reliable API for
// writing project memory directly (Claude only edits memory through an
// LLM instruction, ChatGPT project memory is not user-editable), so the
// memory travels as a project knowledge document that every chat in the
// new project can read.

import type {
  ProjectMemory,
  ProjectMemoryEntry,
  Workspace,
} from "@/core/schema/types";

export function hasProjectMemory(workspace: Workspace): boolean {
  return (workspace.projectMemory?.entries.length ?? 0) > 0;
}

export function projectMemoryEntryCount(workspace: Workspace): number {
  return workspace.projectMemory?.entries.length ?? 0;
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "source";
}

/** File name used when the memory is uploaded or downloaded. */
export function projectMemoryFileName(sourceLabel: string): string {
  return `project-memory-from-${slug(sourceLabel)}.md`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Render a workspace's project memory as a markdown document.
 * Returns an empty string when there is no memory to carry over.
 */
export function renderProjectMemoryMarkdown(
  workspace: Workspace,
  sourceLabel: string,
  now: Date = new Date(),
): string {
  const memory = workspace.projectMemory;
  if (!memory || memory.entries.length === 0) return "";

  const lines: string[] = [
    `# Project memory: ${workspace.name}`,
    "",
    `Carried over from ${sourceLabel} by PortSmith on ${isoDate(now)}. ` +
      `This is what ${sourceLabel} had learned from earlier chats in this project. ` +
      "Treat it as background context and double-check anything time-sensitive.",
  ];

  for (const entry of memory.entries) {
    lines.push("", `## ${entry.title.trim() || "Notes"}`);
    const summary = entry.summary?.trim();
    const content = entry.content.trim();
    if (summary && !content.includes(summary)) {
      lines.push("", `_${summary}_`);
    }
    if (content) {
      lines.push("", content);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Split pasted text into entries on markdown headings (`#` to `###`).
 * Text before the first heading, or text with no headings, becomes a
 * single "Project notes" entry.
 */
export function parsePastedProjectMemory(text: string): ProjectMemoryEntry[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const entries: ProjectMemoryEntry[] = [];
  let title = "Project notes";
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const content = buffer.join("\n").trim();
    if (content) {
      entries.push({
        id: `pm-${entries.length + 1}`,
        title,
        content,
      });
    }
    buffer = [];
  };

  for (const line of normalized.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence ? /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading?.[1]) {
      flush();
      title = heading[1];
      continue;
    }
    buffer.push(line);
  }
  flush();

  return entries;
}

/** Build a manual ProjectMemory from pasted text (null when empty). */
export function buildManualProjectMemory(
  text: string,
  now: Date = new Date(),
): ProjectMemory | null {
  const entries = parsePastedProjectMemory(text);
  if (entries.length === 0) return null;
  return { source: "manual", capturedAt: now.toISOString(), entries };
}

/** Plain-text view of existing memory, for editing in a textarea. */
export function projectMemoryToEditableText(memory: ProjectMemory | undefined): string {
  if (!memory) return "";
  return memory.entries
    .map((e) => {
      const summary = e.summary?.trim();
      const body = e.content.trim();
      const parts = [`## ${e.title}`];
      if (summary && !body.includes(summary)) parts.push(summary);
      if (body) parts.push(body);
      return parts.join("\n\n");
    })
    .join("\n\n");
}

/**
 * Prompt the user can paste into a chat inside the source project to get
 * the assistant to write out what it remembers. ChatGPT does not expose
 * project memory as a list, so this is the only way to capture it.
 */
export function projectMemoryCapturePrompt(projectName: string): string {
  return [
    `I'm moving the project "${projectName}" to another AI assistant.`,
    "Write out everything you know from the chats in this project so I can bring it along.",
    "Cover the project's goal and current status, key decisions and why they were made,",
    "facts, preferences and constraints I've given you, names and terminology, and open questions or next steps.",
    "Put each topic under its own '## ' heading with short bullet points.",
    "Quote my instructions word for word where you can, and leave out anything from outside this project.",
  ].join(" ");
}
