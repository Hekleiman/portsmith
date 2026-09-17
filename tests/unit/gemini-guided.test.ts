import { describe, it, expect } from "vitest";
import type { MemoryItem } from "@/core/schema/types";
import {
  GEMINI_IMPORT_URL,
  buildGeminiChatImportStep,
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
  it("names ChatGPT's export path for a ChatGPT source", () => {
    const step = buildGeminiChatImportStep("chatgpt");
    expect(step).not.toBeNull();
    expect(step?.title).toBe("Bring your chat history (optional)");
    expect(step?.optional).toBe(true);
    expect(step?.description).toContain("In ChatGPT");
    expect(step?.description).toContain("Data controls");
    expect(step?.description).toContain('"Confirm export"');
    expect(step?.description).not.toContain("Confirm Export");
    expect(step?.description).toContain("by email or text message");
    expect(step?.description).toContain("up to 7 days");
    expect(step?.description).toContain("expires 24 hours after you receive it");
    expect(step?.description).not.toContain("Privacy");
  });

  it("names Claude's export path for a Claude source", () => {
    const step = buildGeminiChatImportStep("claude");
    expect(step?.description).toContain("In Claude");
    expect(step?.description).toContain("Settings and Privacy");
    expect(step?.description).toContain("expires after 24 hours");
    expect(step?.description).not.toContain("Data controls");
  });

  it("explains the upload and where import isn't available", () => {
    const step = buildGeminiChatImportStep("claude");
    expect(step?.link).toBe(GEMINI_IMPORT_URL);
    expect(step?.description).toContain('"Import memory to Gemini"');
    expect(step?.description).toContain('Under "Import chats", click "Add"');
    expect(step?.description).toContain(".zip");
    expect(step?.description).toContain("EEA, Switzerland or the UK");
    expect(step?.description).not.toContain("\u2014");
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
    expect(steps.map((s) => s.id)).toEqual([
      "memory-open-import",
      "memory-paste",
      "memory-chat-history",
    ]);
    expect(steps.filter((s) => s.optional)).toHaveLength(1);
  });

  it("still offers the chat step when there is no memory", () => {
    const steps = generateGeminiMemoryInstructions([], "Claude", "", "claude");
    expect(steps.map((s) => s.id)).toEqual(["memory-chat-history"]);
  });

  it("leaves the memory steps unchanged without a source platform", () => {
    const steps = generateGeminiMemoryInstructions(ITEMS, "ChatGPT");
    expect(steps.map((s) => s.id)).toEqual(["memory-open-import", "memory-paste"]);
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
    expect(last?.description).toContain("In ChatGPT");

    const claude = buildMemoryStepsForTarget(chatgptManifest, "claude");
    expect(claude.some((s) => s.id === "memory-chat-history")).toBe(false);
  });

  it("uses the Claude export path for a Claude manifest", () => {
    const steps = buildMemoryStepsForTarget(claudeManifest, "gemini");
    expect(steps.map((s) => s.id)).toEqual(["memory-chat-history"]);
    expect(steps[0]?.description).toContain("In Claude");
  });
});
