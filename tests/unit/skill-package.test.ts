import { describe, it, expect } from "vitest";
import type { Workspace } from "@/core/schema/types";
import {
  GEMS_TO_SKILLS_DATE,
  beforeGemsRemoved,
  geminiUsesSkills,
  renderSkillMd,
  toSkillName,
} from "@/core/transform/skill-package";
import { buildManualCreateFallback } from "@/core/adapters/manual-fallback";

const BEFORE = new Date("2026-11-16T09:00:00-08:00");
const AFTER = new Date("2026-11-17T09:00:00-08:00");

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "a",
    sourceId: "a",
    name: "My Résumé Helper!!",
    description: "",
    instructions: { raw: "Be brief" },
    knowledgeFiles: ["one.md", "two.md"].map((name, i) => ({
      id: `k${i}`,
      originalName: name,
      mimeType: "text/markdown",
      sizeBytes: 3,
      source: "exported" as const,
      contentRef: `ref-${name}`,
      compatible: true,
    })),
    category: "other",
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-10-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
    projectMemory: {
      source: "claude_memory",
      capturedAt: "2026-10-01T00:00:00.000Z",
      entries: [{ id: "e1", title: "Stack", content: "Uses Vite" }],
    },
    ...overrides,
  };
}

const input = (over: Partial<Parameters<typeof renderSkillMd>[0]> = {}) => ({
  name: "My Résumé Helper!!",
  description: "Polishes résumés.",
  instructions: "Line one\n\nLine two",
  fileNames: [],
  sourceLabel: "Claude",
  ...over,
});

/** The frontmatter's description value, read as YAML double-quoted text. */
function descriptionOf(md: string): string {
  const line = md.split("\n").find((l) => l.startsWith("description: "));
  const raw = line!.slice("description: ".length);
  expect(raw.startsWith('"') && raw.endsWith('"')).toBe(true);
  // YAML's \" and \\ escapes match JSON's for this subset.
  return JSON.parse(raw) as string;
}

describe("toSkillName", () => {
  it("lowercases and transliterates accents", () => {
    expect(toSkillName("My Résumé Helper!!")).toBe("my-resume-helper");
  });

  it("cuts a long name to 64 without a trailing hyphen", () => {
    const name = `${"a".repeat(63)} ${"b".repeat(36)}`;
    expect(name).toHaveLength(100);
    const out = toSkillName(name);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).not.toMatch(/-$/);
    expect(out).toBe("a".repeat(63));
  });

  it("collapses runs and trims hyphens", () => {
    expect(toSkillName("  --Hello,   World--  ")).toBe("hello-world");
  });

  it("falls back when nothing is left", () => {
    expect(toSkillName("!!!")).toBe("imported-assistant");
    expect(toSkillName("日本語")).toBe("imported-assistant");
  });
});

describe("renderSkillMd", () => {
  it("writes frontmatter, a heading and the instructions verbatim", () => {
    const md = renderSkillMd(input());
    expect(md.startsWith("---\nname: ")).toBe(true);
    expect(md).toContain("name: my-resume-helper\n");
    expect(descriptionOf(md)).toBe("Polishes résumés.");
    expect(md).toContain("---\n\n# My Résumé Helper!!\n\nLine one\n\nLine two\n");
    expect(md).not.toContain("## Reference files");
  });

  it("lists reference files", () => {
    const md = renderSkillMd(input({ fileNames: ["one.md", "two.pdf"] }));
    expect(md).toContain("## Reference files\n\n- one.md\n- two.pdf\n");
  });

  it("fills an empty description", () => {
    const md = renderSkillMd(input({ description: "  " }));
    expect(descriptionOf(md)).toBe(
      "My Résumé Helper!!, imported from Claude. Use for the same tasks as the original assistant.",
    );
  });

  it("keeps a description with quotes and newlines on one valid line", () => {
    const md = renderSkillMd(input({ description: 'Says "hi"\nand C:\\path' }));
    const frontmatter = md.split("---")[1]!;
    expect(frontmatter.trim().split("\n")).toHaveLength(2);
    expect(descriptionOf(md)).toBe('Says "hi" and C:\\path');
  });

  it("cuts a long description to 1024 on a word boundary", () => {
    const long = "word ".repeat(450).trim();
    expect(long.length).toBeGreaterThan(2000);
    const out = descriptionOf(renderSkillMd(input({ description: long })));
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("Gems-to-skills date", () => {
  it("switches at midnight Pacific on Nov 17", () => {
    expect(GEMS_TO_SKILLS_DATE).toBe("2026-11-17");
    expect(geminiUsesSkills(new Date("2026-11-16T23:59:59-08:00"))).toBe(false);
    expect(geminiUsesSkills(new Date("2026-11-17T00:00:00-08:00"))).toBe(true);
    expect(geminiUsesSkills(BEFORE)).toBe(false);
    expect(geminiUsesSkills(AFTER)).toBe(true);
  });

  it("stops the notice when Gems are removed", () => {
    expect(beforeGemsRemoved(AFTER)).toBe(true);
    expect(beforeGemsRemoved(new Date("2026-12-17T00:00:00-08:00"))).toBe(false);
  });
});

describe("Gemini manual create card", () => {
  it("is a skill card from Nov 17", () => {
    const card = buildManualCreateFallback(ws(), "gemini", "Claude", undefined, AFTER);
    expect(card.link).toBe("https://gemini.google.com/customize/skills");
    expect(card.title).toBe('Create "My Résumé Helper!!" as a Gemini skill by hand');
    expect(card.description).toContain('choose "Create manually"');
    expect(card.description).toContain('Click "Add files"');
    expect(`${card.title}\n${card.description}`).not.toMatch(/\bGems?\b|\/gems\//);
    expect(card.copyBlocks[0]).toEqual({ label: "Name", content: "my-resume-helper" });
    expect(card.copyBlocks.find((b) => b.label === "Description")?.content).toContain(
      "imported from Claude",
    );
    const first = card.downloads?.[0];
    expect(first?.label).toBe('SKILL.md for "My Résumé Helper!!"');
    expect(first?.fileName).toBe("my-resume-helper-SKILL.md");
    expect(first?.mimeType).toBe("text/markdown");
    expect(first?.content).toMatch(/^---\nname: my-resume-helper\n/);
    expect(first?.content).toContain("- one.md\n- two.md\n- project-memory-from-claude.md");
    expect(card.downloads?.map((d) => d.fileName)).toEqual([
      "my-resume-helper-SKILL.md",
      "project-memory-from-claude.md",
      "one.md",
      "two.md",
    ]);
  });

  it("is the Gem card plus the SKILL.md before Nov 17", () => {
    const card = buildManualCreateFallback(ws(), "gemini", "Claude", undefined, BEFORE);
    expect(card.link).toBe("https://gemini.google.com/gems/view");
    expect(card.title).toBe('Create "My Résumé Helper!!" in Gemini by hand');
    expect(card.description).toContain('click "New Gem"');
    expect(card.copyBlocks[0]).toEqual({ label: "Name", content: "My Résumé Helper!!" });
    expect(card.copyBlocks.some((b) => b.label === "Description")).toBe(false);
    expect(card.downloads?.[0]?.fileName).toBe("my-resume-helper-SKILL.md");
    expect(card.downloads).toHaveLength(4);
  });

  it("leaves other targets without a SKILL.md", () => {
    const card = buildManualCreateFallback(ws(), "claude", "ChatGPT", undefined, AFTER);
    expect(card.downloads?.some((d) => d.fileName.endsWith("SKILL.md"))).toBe(false);
    expect(card.link).toBe("https://claude.ai/projects");
  });
});
