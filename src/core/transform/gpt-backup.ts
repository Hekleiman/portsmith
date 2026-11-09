// ─── Custom GPT backup ──────────────────────────────────────
// OpenAI retires custom GPTs on 2026-12-11 for all standard plans
// (FedRAMP and Enterprise workspaces with an approved deferral keep them
// until 2027-02-11). OpenAI offers no GPT export, so this builds a zip with
// everything PortSmith read for each GPT: a README, a gpts.json and a
// SKILL.md per GPT. Knowledge files are not downloaded, only their names.

import { strToU8, zipSync, type Zippable } from "fflate";
import type { Workspace } from "@/core/schema/types";
import { renderSkillMd, toSkillName } from "./skill-package";

export const GPT_RETIREMENT_DATE = "2026-12-11";
/** Midnight Pacific on the retirement date. */
const GPT_RETIREMENT_CUTOFF = Date.parse(`${GPT_RETIREMENT_DATE}T00:00:00-08:00`);

const SOURCE_LABEL = "ChatGPT";

/** True once OpenAI has retired custom GPTs on standard plans. */
export function gptsRetired(now: Date = new Date()): boolean {
  return now.getTime() >= GPT_RETIREMENT_CUTOFF;
}

/** True for a custom GPT workspace (`g-...`), false for projects (`g-p-...`). */
export function isGptWorkspace(ws: Pick<Workspace, "sourceId">): boolean {
  return /^g-(?!p-)[A-Za-z0-9]+/.test(ws.sourceId ?? "");
}

export interface GptBackupEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  conversationStarters: string[];
  knowledgeFileNames: string[];
}

function toEntry(ws: Workspace): GptBackupEntry {
  return {
    id: ws.sourceId ?? ws.id,
    name: ws.name,
    description: ws.description,
    instructions: ws.instructions.raw,
    conversationStarters: ws.behavior.triggerPhrases ?? [],
    knowledgeFileNames: ws.knowledgeFiles.map((f) => f.originalName),
  };
}

/** A fence longer than any backtick run in the text, so it can't close early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function renderReadme(entries: GptBackupEntry[], now: Date): string {
  const lines = [
    "# Custom GPT backup",
    "",
    `Made by PortSmith on ${pacificDate(now)} before OpenAI retires custom GPTs on Dec 11, 2026. ` +
      "For each GPT it holds the name, description, instructions and conversation starters " +
      "as PortSmith read them from your ChatGPT account, in this file, in gpts.json and as a " +
      "skill file in skills/<name>/SKILL.md. Knowledge files are not included: only their " +
      "names are listed under each GPT, so download the files themselves from ChatGPT if " +
      "you still have access.",
  ];
  for (const e of entries) {
    lines.push("", `## ${oneLine(e.name) || "Untitled GPT"}`, "", `ID: ${e.id}`);
    if (e.description.trim()) lines.push("", oneLine(e.description));
    lines.push("", "### Instructions", "");
    if (e.instructions.trim()) {
      const fence = fenceFor(e.instructions);
      lines.push(fence, e.instructions, fence);
    } else {
      lines.push("(none)");
    }
    lines.push("", "### Conversation starters", "");
    lines.push(
      ...(e.conversationStarters.length > 0
        ? e.conversationStarters.map((s) => `- ${oneLine(s)}`)
        : ["(none)"]),
    );
    lines.push("", "### Knowledge files (not included)", "");
    lines.push(
      ...(e.knowledgeFileNames.length > 0
        ? e.knowledgeFileNames.map((f) => `- ${f}`)
        : ["(none)"]),
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderGptSkill(e: GptBackupEntry, skillName: string): string {
  let md = renderSkillMd({
    name: e.name,
    description: e.description,
    instructions: e.instructions,
    fileNames: e.knowledgeFileNames,
    sourceLabel: SOURCE_LABEL,
  });
  // Keep the frontmatter name in step with a de-duplicated folder name.
  md = md.replace(/^name: .*$/m, `name: ${skillName}`);
  if (e.conversationStarters.length > 0) {
    md = `${md.replace(/\n+$/, "")}\n\n## Conversation starters\n\n${e.conversationStarters
      .map((s) => `- ${oneLine(s)}`)
      .join("\n")}\n`;
  }
  return md;
}

/** Unique skill folder names: "helper", "helper-2", "helper-3", ... */
function uniqueSkillNames(entries: GptBackupEntry[]): string[] {
  const used = new Set<string>();
  return entries.map((e) => {
    const base = toSkillName(e.name);
    let name = base;
    for (let n = 2; used.has(name); n++) {
      const suffix = `-${n}`;
      name = `${base.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}`;
    }
    used.add(name);
    return name;
  });
}

/** The backup zip for every custom GPT in `workspaces` (projects are skipped). */
export function buildGptBackupZip(
  workspaces: Workspace[],
  now: Date = new Date(),
): Uint8Array {
  const entries = workspaces.filter(isGptWorkspace).map(toEntry);
  const names = uniqueSkillNames(entries);
  const files: Zippable = {
    "README.md": strToU8(renderReadme(entries, now)),
    "gpts.json": strToU8(`${JSON.stringify(entries, null, 2)}\n`),
  };
  entries.forEach((e, i) => {
    const name = names[i] ?? toSkillName(e.name);
    files[`skills/${name}/SKILL.md`] = strToU8(renderGptSkill(e, name));
  });
  return zipSync(files, { mtime: now });
}

/** YYYY-MM-DD in America/Los_Angeles. */
function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function gptBackupFileName(now: Date = new Date()): string {
  return `portsmith-gpt-backup-${pacificDate(now)}.zip`;
}
