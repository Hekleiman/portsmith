// ─── Gemini skill package ───────────────────────────────────
// Google is turning Gems into skills. Personal accounts switch on
// 2026-11-17 (Gems go read-only) and lose Gems on 2026-12-17. This builds
// a SKILL.md (Agent Skills format: YAML frontmatter, then Markdown) for a
// workspace, and tells callers which route to show.

export const GEMS_TO_SKILLS_DATE = "2026-11-17";
/** Midnight Pacific on the switch date. */
const GEMS_TO_SKILLS_CUTOFF = Date.parse(`${GEMS_TO_SKILLS_DATE}T00:00:00-08:00`);

export const GEMS_REMOVED_DATE = "2026-12-17";
const GEMS_REMOVED_CUTOFF = Date.parse(`${GEMS_REMOVED_DATE}T00:00:00-08:00`);

export const GEMINI_SKILLS_URL = "https://gemini.google.com/customize/skills";

const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_NAME_DEFAULT = "imported-assistant";

/** True once personal Gemini accounts make skills instead of Gems. */
export function geminiUsesSkills(now: Date = new Date()): boolean {
  return now.getTime() >= GEMS_TO_SKILLS_CUTOFF;
}

/** True until Gems are removed for personal accounts. */
export function beforeGemsRemoved(now: Date = new Date()): boolean {
  return now.getTime() < GEMS_REMOVED_CUTOFF;
}

/**
 * A skill name: lowercase a-z, 0-9 and single hyphens, at most 64
 * characters. Accented letters lose their accents ("Résumé" → "resume");
 * anything else becomes a hyphen.
 */
export function toSkillName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/, "");
  return slug || SKILL_NAME_DEFAULT;
}

/** Collapse whitespace and cut to `max` characters on a word boundary. */
function cutOnWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const head = chars.slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head).trimEnd();
}

/** The skill's description, with a fallback when the source had none. */
export function skillDescription(
  name: string,
  description: string,
  sourceLabel: string,
): string {
  const text = description.trim()
    ? description
    : `${name.trim() || "Assistant"}, imported from ${sourceLabel}. Use for the same tasks as the original assistant.`;
  return cutOnWord(text, SKILL_DESCRIPTION_MAX);
}

/** A double-quoted, single-line YAML scalar. */
function yamlQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, " ");
  return `"${escaped}"`;
}

export interface SkillMdInput {
  name: string;
  description: string;
  instructions: string;
  fileNames: string[];
  sourceLabel: string;
}

/** SKILL.md for one workspace. */
export function renderSkillMd(input: SkillMdInput): string {
  const lines = [
    "---",
    `name: ${toSkillName(input.name)}`,
    `description: ${yamlQuote(skillDescription(input.name, input.description, input.sourceLabel))}`,
    "---",
    "",
    `# ${input.name.replace(/\s+/g, " ").trim() || "Imported assistant"}`,
    "",
    input.instructions,
  ];
  if (input.fileNames.length > 0) {
    lines.push("", "## Reference files", "", ...input.fileNames.map((f) => `- ${f}`));
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** File name for a workspace's SKILL.md download. */
export function skillFileName(name: string): string {
  return `${toSkillName(name)}-SKILL.md`;
}
