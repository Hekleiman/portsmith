import { describe, it, expect } from "vitest";
import type { MemoryItem, Workspace } from "@/core/schema/types";
import {
  GEMINI_IMPORT_URL,
  buildGeminiChatImportStep,
  generateGeminiInstructions,
  generateGeminiMemoryInstructions,
} from "@/core/adapters/gemini-guided";
import { buildMemoryStepsForTarget } from "@/core/adapters/memory-steps";
import { generateClaudeManifest } from "@/core/transform/claude-manifest";

function memoryItem(fact: string): MemoryItem {
  return {
    id: `m-${fact}`,
    fact,
    category: "preference",
    confidence: 1,
    source: "explicit",
    workspaceIds: [],
    migration: { fitsConstraints: true, priority: 3 },
  };
}

const ITEMS = [memoryItem("Likes short answers")];

describe("buildGeminiChatImportStep", () => {
  it("gives ChatGPT users a button per page instead of directions", () => {
    const step = buildGeminiChatImportStep("chatgpt");
    expect(step?.title).toBe("Bring your chat history (optional)");
    expect(step?.optional).toBe(true);
    expect(step?.actions?.map((a) => a.label)).toEqual([
      "Open ChatGPT's data export",
      "Open Gemini's import page",
    ]);
    expect(step?.actions?.[0]?.url).toContain("chatgpt.com");
    expect(step?.actions?.[0]?.note).toContain('"Confirm export"');
    expect(step?.actions?.[0]?.note).toContain("up to 7 days");
    expect(step?.actions?.[1]?.url).toBe(GEMINI_IMPORT_URL);
    expect(step?.actions?.[1]?.note).toContain('Under "Import chats", click "Add"');
  });

  it("points Claude users at Claude's export page", () => {
    const step = buildGeminiChatImportStep("claude");
    expect(step?.actions?.[0]?.label).toBe("Open Claude's data export");
    expect(step?.actions?.[0]?.url).toContain("claude.ai/settings");
    expect(step?.actions?.[0]?.note).toContain("expires after 24 hours");
    expect(step?.link).toBe(GEMINI_IMPORT_URL);
  });

  it("returns nothing for sources Gemini can't import", () => {
    expect(buildGeminiChatImportStep("gemini")).toBeNull();
    expect(buildGeminiChatImportStep("copilot")).toBeNull();
    expect(buildGeminiChatImportStep(undefined)).toBeNull();
  });
});
describe("generateGeminiMemoryInstructions with chat history", () => {
  it("adds the chat step after the memory steps", () => {
    const steps = generateGeminiMemoryInstructions(ITEMS, "ChatGPT", "", "chatgpt");
    expect(steps.map((s) => s.id)).toEqual(["memory-paste", "memory-chat-history"]);
    expect(steps.filter((s) => s.optional)).toHaveLength(1);
  });

  it("still offers the chat step when there is no memory", () => {
    const steps = generateGeminiMemoryInstructions([], "Claude", "", "claude");
    expect(steps.map((s) => s.id)).toEqual(["memory-chat-history"]);
  });

  it("leaves the memory steps unchanged without a source platform", () => {
    const steps = generateGeminiMemoryInstructions(ITEMS, "ChatGPT");
    expect(steps.map((s) => s.id)).toEqual(["memory-paste"]);
    expect(generateGeminiMemoryInstructions([], "ChatGPT")).toEqual([]);
  });
});

describe("buildMemoryStepsForTarget", () => {
  const claudeManifest = generateClaudeManifest([]);
  const chatgptManifest = {
    ...claudeManifest,
    source: { ...claudeManifest.source, platform: "chatgpt" as const },
    memory: ITEMS,
  };

  it("adds the chat step only for the Gemini target", () => {
    const gemini = buildMemoryStepsForTarget(chatgptManifest, "gemini");
    const last = gemini[gemini.length - 1];
    expect(last?.id).toBe("memory-chat-history");
    expect(last?.actions?.[0]?.url).toContain("chatgpt.com");

    const claude = buildMemoryStepsForTarget(chatgptManifest, "claude");
    expect(claude.some((s) => s.id === "memory-chat-history")).toBe(false);
  });

  it("uses the Claude export path for a Claude manifest", () => {
    const steps = buildMemoryStepsForTarget(claudeManifest, "gemini");
    expect(steps.map((s) => s.id)).toEqual(["memory-chat-history"]);
    expect(steps[0]?.actions?.[0]?.url).toContain("claude.ai");
  });
});

describe("generateGeminiInstructions and the Gems-to-skills switch", () => {
  const workspace: Workspace = {
    id: "w",
    sourceId: "w",
    name: "Trip Planner",
    description: "",
    instructions: { raw: "Plan trips" },
    knowledgeFiles: [
      {
        id: "k",
        originalName: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 3,
        source: "exported",
        contentRef: "ref-notes",
        compatible: true,
      },
    ],
    category: "other",
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-10-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
  };

  it("walks through creating a skill from Nov 17", () => {
    const { steps } = generateGeminiInstructions(
      workspace,
      "ChatGPT",
      new Date("2026-11-17T09:00:00-08:00"),
    );
    expect(steps.map((s) => s.title)).toEqual([
      "Open Skills",
      "Enter the skill name",
      "Enter the description",
      "Paste the instructions",
      "Add knowledge files",
      "Create the skill",
    ]);
    expect(steps[0]?.link).toBe("https://gemini.google.com/customize/skills");
    expect(steps[0]?.description).toContain('"Create manually"');
    expect(steps[0]?.downloads?.[0]?.fileName).toBe("trip-planner-SKILL.md");
    expect(steps[1]?.copyBlocks[0]).toEqual({ label: "Name", content: "trip-planner" });
    expect(steps[2]?.copyBlocks[0]?.label).toBe("Description");
    expect(steps[3]?.copyBlocks[0]).toEqual({ label: "Instructions", content: "Plan trips" });
    expect(steps[4]?.description).toContain('"Add files"');
    expect(steps[4]?.link).toBe("https://gemini.google.com/customize/skills");
    expect(steps[5]?.description).toContain('Click "Create"');
    const text = JSON.stringify(
      steps.map((s) => [s.title, s.description, s.actionHint, s.link, s.copyBlocks]),
    );
    expect(text).not.toMatch(/\bGems?\b|\/gems\//);
  });

  it("keeps the Gem steps before Nov 17", () => {
    const { steps } = generateGeminiInstructions(
      workspace,
      "ChatGPT",
      new Date("2026-11-16T09:00:00-08:00"),
    );
    expect(steps[0]?.title).toBe("Open the Gem manager");
    expect(steps[0]?.link).toBe("https://gemini.google.com/gems/view");
    expect(steps[1]?.copyBlocks[0]).toEqual({ label: "Gem name", content: "Trip Planner" });
    expect(steps[steps.length - 1]?.title).toBe("Save the Gem");
  });
});
