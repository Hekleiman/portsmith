import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { Workspace } from "@/core/schema/types";
import {
  GPT_RETIREMENT_DATE,
  buildGptBackupZip,
  gptBackupFileName,
  gptsRetired,
  isGptWorkspace,
  type GptBackupEntry,
} from "@/core/transform/gpt-backup";

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-g-abc123",
    sourceId: "g-abc123",
    name: "Helper",
    description: "Helps with things",
    instructions: { raw: "BE BRIEF.\nAlways cite sources.", translated: { claude: "Be brief." } },
    knowledgeFiles: ["guide.pdf"].map((name, i) => ({
      id: `k${i}`,
      originalName: name,
      mimeType: "application/pdf",
      sizeBytes: 0,
      source: "referenced" as const,
      compatible: true,
    })),
    category: "other",
    tags: [],
    behavior: { triggerPhrases: ["Summarize this", "Draft a reply"] },
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-10-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
    ...overrides,
  };
}

const NOW = new Date("2026-11-09T15:00:00-08:00");

function unzip(workspaces: Workspace[]): Record<string, string> {
  const raw = unzipSync(buildGptBackupZip(workspaces, NOW));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
}

function file(files: Record<string, string>, path: string): string {
  const text = files[path];
  if (text === undefined) throw new Error(`missing ${path}`);
  return text;
}

describe("gptsRetired", () => {
  it("uses Dec 11, 2026 as the date", () => {
    expect(GPT_RETIREMENT_DATE).toBe("2026-12-11");
  });
  it("is false just before midnight Pacific on Dec 11", () => {
    expect(gptsRetired(new Date("2026-12-10T23:59:00-08:00"))).toBe(false);
  });
  it("is true just after midnight Pacific on Dec 11", () => {
    expect(gptsRetired(new Date("2026-12-11T00:01:00-08:00"))).toBe(true);
  });
});

describe("isGptWorkspace", () => {
  it("accepts GPT ids and rejects project ids", () => {
    expect(isGptWorkspace({ sourceId: "g-abc123" })).toBe(true);
    expect(isGptWorkspace({ sourceId: "g-p-0123456789abcdef0123456789abcdef" })).toBe(false);
    expect(isGptWorkspace({ sourceId: "proj-1" })).toBe(false);
    expect(isGptWorkspace({ sourceId: undefined })).toBe(false);
  });
});

describe("buildGptBackupZip", () => {
  const project = ws({
    id: "ws-g-p-0123456789abcdef0123456789abcdef",
    sourceId: "g-p-0123456789abcdef0123456789abcdef",
    name: "My Project",
  });

  it("writes README, gpts.json and one SKILL.md per GPT, without projects", () => {
    const files = unzip([ws(), ws({ id: "ws-g-x", sourceId: "g-x", name: "Writer" }), project]);
    expect(Object.keys(files).sort()).toEqual([
      "README.md",
      "gpts.json",
      "skills/helper/SKILL.md",
      "skills/writer/SKILL.md",
    ]);
    expect(files["README.md"]).not.toContain("My Project");
    expect(files["README.md"]).toContain("Knowledge files are not included");
    expect(files["README.md"]).toContain("- guide.pdf");
    expect(files["README.md"]).toContain("- Summarize this");
  });

  it("gives duplicate names unique folders and matching skill names", () => {
    const files = unzip([ws(), ws({ id: "ws-g-two", sourceId: "g-two" })]);
    expect(files["skills/helper/SKILL.md"]).toBeDefined();
    expect(files["skills/helper-2/SKILL.md"]).toMatch(/^---\nname: helper-2\n/);
  });

  it("writes SKILL.md files with frontmatter and a starters section", () => {
    const files = unzip([ws(), ws({ id: "ws-g-y", sourceId: "g-y", name: "Quiet", behavior: {} })]);
    const helper = file(files, "skills/helper/SKILL.md");
    expect(helper.startsWith("---\nname: ")).toBe(true);
    expect(helper).toContain("## Conversation starters\n\n- Summarize this\n- Draft a reply");
    expect(helper).toContain("BE BRIEF.");
    const quiet = file(files, "skills/quiet/SKILL.md");
    expect(quiet.startsWith("---\nname: ")).toBe(true);
    expect(quiet).not.toContain("## Conversation starters");
  });

  it("stores the raw instructions in gpts.json", () => {
    const files = unzip([ws(), project]);
    const parsed = JSON.parse(file(files, "gpts.json")) as GptBackupEntry[];
    expect(parsed).toEqual([
      {
        id: "g-abc123",
        name: "Helper",
        description: "Helps with things",
        instructions: "BE BRIEF.\nAlways cite sources.",
        conversationStarters: ["Summarize this", "Draft a reply"],
        knowledgeFileNames: ["guide.pdf"],
      },
    ]);
  });

  it("fences instructions that contain backticks safely", () => {
    const files = unzip([ws({ instructions: { raw: "Use ```js blocks```" } })]);
    expect(files["README.md"]).toContain("````\nUse ```js blocks```\n````");
  });
});

describe("gptBackupFileName", () => {
  it("uses the Pacific date", () => {
    expect(gptBackupFileName(new Date("2026-11-10T06:30:00Z"))).toBe(
      "portsmith-gpt-backup-2026-11-09.zip",
    );
  });
});
