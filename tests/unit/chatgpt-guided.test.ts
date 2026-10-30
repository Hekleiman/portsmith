import { describe, it, expect } from "vitest";
import type { Workspace } from "@/core/schema/types";
import { generateChatGPTInstructions } from "@/core/adapters/chatgpt-guided";
import { buildLeftoverCards } from "@/core/adapters/leftover-cards";
import { buildManualCreateFallback } from "@/core/adapters/manual-fallback";
import { CLAUDE_PROJECT_FILE_LIMIT_BYTES } from "@/core/adapters/claude-autofill";
import { MAX_MESSAGE_FILE_BYTES } from "@/shared/constants";

const LONG_NAME = "A project name that is much longer than fifty characters allows";
const SHORT_NAME = "A project name that is much longer than fifty…";
const LONG_INSTRUCTIONS = Array.from({ length: 12 }, () =>
  "Follow the house style. ".repeat(40).trim(),
).join("\n\n");

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "a",
    sourceId: "a",
    name: "Site",
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

describe("ChatGPT guided steps", () => {
  it("points at the + next to Projects and the Sources tab", () => {
    const { steps } = generateChatGPTInstructions(ws(), "Claude");
    const create = steps.find((s) => s.id === "a-create");
    expect(create?.description).toContain('click the + next to "Projects"');
    expect(create?.description).toContain('click "Create project"');
    expect(create?.copyBlocks).toEqual([{ label: "Project name", content: "Site" }]);
    const files = steps.find((s) => s.id === "a-files");
    expect(files?.description).toContain('click "Add sources"');
    expect(files?.downloads?.map((d) => d.fileName)).toEqual([
      "project-memory-from-claude.md",
      "one.md",
      "two.md",
    ]);
  });

  it("gives a name ChatGPT accepts and says it was shortened", () => {
    const { steps } = generateChatGPTInstructions(ws({ name: LONG_NAME }), "Claude");
    const create = steps.find((s) => s.id === "a-create");
    expect(create?.copyBlocks).toEqual([{ label: "Project name", content: SHORT_NAME }]);
    expect(create?.description).toContain(`ChatGPT allows 50 characters in a project name, so "${LONG_NAME}"`);
  });

  it("shortens long instructions and adds the full text as a download", () => {
    const { steps } = generateChatGPTInstructions(
      ws({ instructions: { raw: LONG_INSTRUCTIONS } }),
      "Claude",
    );
    const instructions = steps.find((s) => s.id === "a-instructions");
    const text = instructions?.copyBlocks[0]?.content ?? "";
    expect([...text].length).toBeLessThanOrEqual(8000);
    expect(text).toContain("full-instructions-from-claude.md");
    expect(instructions?.description).toContain("shortened at a paragraph break");

    const files = steps.find((s) => s.id === "a-files");
    const overflow = files?.downloads?.[0];
    expect(overflow?.fileName).toBe("full-instructions-from-claude.md");
    expect(overflow?.content).toContain(LONG_INSTRUCTIONS);
    expect(overflow?.contentRef).toBeUndefined();
  });

  it("leaves instructions within the limit alone", () => {
    const { steps } = generateChatGPTInstructions(ws(), "Claude");
    expect(steps.find((s) => s.id === "a-instructions")?.copyBlocks[0]?.content).toBe("Be brief");
    expect(steps.find((s) => s.id === "a-files")?.downloads?.[0]?.fileName).toBe(
      "project-memory-from-claude.md",
    );
  });
});

describe("ChatGPT manual create card", () => {
  it("uses the current labels and fitted text", () => {
    const card = buildManualCreateFallback(
      ws({ name: LONG_NAME, instructions: { raw: LONG_INSTRUCTIONS } }),
      "chatgpt",
      "Claude",
    );
    expect(card.description).toContain('click the + next to "Projects"');
    expect(card.description).toContain('click "Add sources"');
    expect(card.copyBlocks[0]).toEqual({ label: "Name", content: SHORT_NAME });
    const instructions = card.copyBlocks.find((b) => b.label === "Instructions")?.content ?? "";
    expect([...instructions].length).toBeLessThanOrEqual(8000);
    expect(card.downloads?.[0]?.fileName).toBe("full-instructions-from-claude.md");
  });

  it("leaves other targets' text untouched", () => {
    const card = buildManualCreateFallback(ws({ name: LONG_NAME }), "claude", "ChatGPT");
    expect(card.copyBlocks[0]).toEqual({ label: "Name", content: LONG_NAME });
  });
});

describe("ChatGPT leftover card", () => {
  const link = `https://chatgpt.com/g/g-p-${"0".repeat(31)}1/project?tab=sources`;

  it("lists the remaining Sources files with their downloads", () => {
    const cards = buildLeftoverCards(
      [ws()],
      {
        completed: new Set(["a"]),
        manual: new Map(),
        knowledgeLeftovers: new Map([["a", { link, fileNames: ["two.md"], projectMemory: true }]]),
      },
      "chatgpt",
      "Claude",
    );
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.title).toBe('Add files to "Site"');
    expect(card.link).toBe(link);
    expect(card.description).toContain('"Add sources"');
    expect(card.description).not.toMatch(/Gem/);
    expect(card.downloads?.map((d) => d.fileName)).toEqual(["project-memory-from-claude.md", "two.md"]);
  });

  it("includes the full-instructions file when it didn't arrive", () => {
    const cards = buildLeftoverCards(
      [ws({ name: LONG_NAME, instructions: { raw: LONG_INSTRUCTIONS } })],
      {
        completed: new Set(["a"]),
        manual: new Map(),
        knowledgeLeftovers: new Map([
          [
            "a",
            { link, fileNames: [], projectMemory: false, instructionsFile: "full-instructions-from-claude.md" },
          ],
        ]),
      },
      "chatgpt",
      "Claude",
    );
    expect(cards[0]?.title).toBe(`Add files to "${SHORT_NAME}"`);
    expect(cards[0]?.downloads?.map((d) => d.fileName)).toEqual(["full-instructions-from-claude.md"]);
    expect(cards[0]?.downloads?.[0]?.content).toContain(LONG_INSTRUCTIONS);
  });

  it("keeps Gemini's card as it was", () => {
    const cards = buildLeftoverCards(
      [ws()],
      {
        completed: new Set(["a"]),
        manual: new Map(),
        knowledgeLeftovers: new Map([["a", { link: "https://gemini.google.com/gems/edit/g1", fileNames: [], projectMemory: true }]]),
      },
      "gemini",
      "Claude",
    );
    expect(cards[0]?.title).toBe('Add knowledge files to "Site"');
  });
});

describe("message size cap", () => {
  it("keeps Claude's file limit under what one message can carry", () => {
    expect(CLAUDE_PROJECT_FILE_LIMIT_BYTES).toBeLessThanOrEqual(MAX_MESSAGE_FILE_BYTES);
    // base64 grows bytes by a third; Chrome caps a message at 64 MiB, and
    // the JSON envelope around the file needs room too (1 MiB of headroom).
    expect(Math.ceil(MAX_MESSAGE_FILE_BYTES / 3) * 4 + 1024 * 1024).toBeLessThanOrEqual(
      64 * 1024 * 1024,
    );
  });
});
