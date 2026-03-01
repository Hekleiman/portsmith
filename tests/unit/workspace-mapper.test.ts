import { describe, it, expect } from "vitest";
import {
  generateManifest,
  type ChatGPTDOMData,
} from "@/core/transform/workspace-mapper";
import { mapMemoryItems, CLAUDE_MAX_MEMORY_CHARS } from "@/core/transform/memory-mapper";
import { PortsmithManifestSchema } from "@/core/schema/types";
import type { RawChatGPTData, ParsedConversation } from "@/core/adapters/types";
import type { ExtractedCustomGPT } from "@/core/adapters/chatgpt-dom-types";

// ─── Helpers ─────────────────────────────────────────────────

function makeRawData(overrides?: Partial<RawChatGPTData>): RawChatGPTData {
  return {
    conversations: [],
    customGPTIds: [],
    stats: { totalConversations: 0, dateRange: null, topGPTs: [] },
    warnings: [],
    ...overrides,
  };
}

function makeConversation(
  overrides?: Partial<ParsedConversation>,
): ParsedConversation {
  return {
    id: "conv-1",
    title: "Test Conversation",
    createTime: 1705300000,
    updateTime: 1705303600,
    messages: [
      { role: "user", content: "Hello", timestamp: 1705300000 },
      { role: "assistant", content: "Hi there", timestamp: 1705300100 },
    ],
    ...overrides,
  };
}

function makeGPT(overrides?: Partial<ExtractedCustomGPT>): ExtractedCustomGPT {
  return {
    id: "g-test-123",
    name: "Test GPT",
    description: "A test GPT",
    instructions: "Help the user with coding tasks.",
    conversationStarters: ["How do I...?"],
    knowledgeFileNames: [],
    ...overrides,
  };
}

// ─── generateManifest ───────────────────────────────────────

describe("generateManifest", () => {
  it("produces a valid PortsmithManifest (Zod validation)", () => {
    const raw = makeRawData();
    const dom: ChatGPTDOMData = {
      customGPTs: [makeGPT()],
      memory: [{ content: "Prefers TypeScript" }],
      customInstructions: {
        aboutUser: "I am a software engineer.",
        responsePreferences: "Be concise.",
      },
    };
    const manifest = generateManifest(raw, dom);
    const result = PortsmithManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("sets correct source platform and metadata", () => {
    const manifest = generateManifest(makeRawData());
    expect(manifest.source.platform).toBe("chatgpt");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.metadata.generatedBy).toBe("portsmith/0.1.0");
  });

  it("sets exportMethod to official_export when no DOM data", () => {
    const manifest = generateManifest(makeRawData());
    expect(manifest.source.exportMethod).toBe("official_export");
  });

  it("sets exportMethod to dom_extraction when DOM data present", () => {
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [makeGPT()],
    });
    expect(manifest.source.exportMethod).toBe("dom_extraction");
  });

  it("creates workspaces from Custom GPTs", () => {
    const gpt = makeGPT({
      name: "Code Reviewer",
      instructions: "Review code for bugs and style issues.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });

    expect(manifest.workspaces).toHaveLength(1);
    expect(manifest.workspaces[0]!.name).toBe("Code Reviewer");
    expect(manifest.workspaces[0]!.instructions.raw).toBe(
      "Review code for bugs and style issues.",
    );
  });

  it("translates instructions for Claude", () => {
    const gpt = makeGPT({
      instructions:
        "Act as a senior code reviewer. You MUST always provide line numbers.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });

    const ws = manifest.workspaces[0]!;
    expect(ws.instructions.translated).toBeDefined();
    expect(ws.instructions.translated!.claude).toContain("Help as");
    expect(ws.instructions.translated!.claude).toContain("Please always");
  });

  it("does not add translated field when no rules applied", () => {
    const gpt = makeGPT({
      instructions: "Respond concisely with clear explanations.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });

    const ws = manifest.workspaces[0]!;
    expect(ws.instructions.translated).toBeUndefined();
  });

  it("categorizes coding workspaces correctly", () => {
    const gpt = makeGPT({
      name: "Code Reviewer",
      instructions: "Review code and debug software issues.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.category).toBe("coding");
  });

  it("categorizes writing workspaces correctly", () => {
    const gpt = makeGPT({
      name: "Blog Writer",
      instructions: "Write blog articles and proofread content.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.category).toBe("writing");
  });

  it("counts related conversations per workspace", () => {
    const gpt = makeGPT({ id: "g-reviewer" });
    const convs = [
      makeConversation({ id: "c1", gizmoId: "g-reviewer" }),
      makeConversation({ id: "c2", gizmoId: "g-reviewer" }),
      makeConversation({ id: "c3" }), // unrelated
    ];
    const manifest = generateManifest(makeRawData({ conversations: convs }), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.conversationCount).toBe(2);
  });

  it("extracts sample topics from related conversations", () => {
    const gpt = makeGPT({ id: "g-writer" });
    const convs = [
      makeConversation({
        id: "c1",
        gizmoId: "g-writer",
        title: "React Server Components",
      }),
      makeConversation({
        id: "c2",
        gizmoId: "g-writer",
        title: "GraphQL Migration",
      }),
    ];
    const manifest = generateManifest(makeRawData({ conversations: convs }), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.sampleTopics).toContain(
      "React Server Components",
    );
    expect(manifest.workspaces[0]!.sampleTopics).toContain(
      "GraphQL Migration",
    );
  });

  it("maps knowledge file names to KnowledgeFile objects", () => {
    const gpt = makeGPT({
      knowledgeFileNames: ["style-guide.md", "api-docs.pdf", "data.xlsx"],
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const files = manifest.workspaces[0]!.knowledgeFiles;
    expect(files).toHaveLength(3);
    expect(files[0]!.originalName).toBe("style-guide.md");
    expect(files[0]!.mimeType).toBe("text/markdown");
    expect(files[0]!.compatible).toBe(true);
    expect(files[2]!.originalName).toBe("data.xlsx");
    expect(files[2]!.compatible).toBe(false);
    expect(files[2]!.conversionNeeded).toContain("xlsx");
  });

  it("detects capabilities from instructions", () => {
    const gpt = makeGPT({
      instructions: "Use DALL-E to generate images. Browse the web for info.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const caps = manifest.workspaces[0]!.capabilities;
    const imageGen = caps.find((c) => c.type === "image_generation");
    expect(imageGen).toBeDefined();
    expect(imageGen!.available).toBe(false);

    const browsing = caps.find((c) => c.type === "web_browsing");
    expect(browsing).toBeDefined();
    expect(browsing!.available).toBe(true);
  });

  it("generates capability warnings", () => {
    const gpt = makeGPT({
      instructions: "Use DALL-E to create images for each response.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const warnings = manifest.workspaces[0]!.migration.warnings;
    expect(warnings.some((w) => w.includes("DALL-E"))).toBe(true);
  });

  it("adds manual steps for knowledge files and conversation starters", () => {
    const gpt = makeGPT({
      knowledgeFileNames: ["guide.md"],
      conversationStarters: ["How do I start?"],
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const steps = manifest.workspaces[0]!.migration.manualStepsRequired;
    expect(steps.some((s) => s.includes("knowledge file"))).toBe(true);
    expect(steps.some((s) => s.includes("conversation starters"))).toBe(true);
  });

  it("sets conversation starters as trigger phrases", () => {
    const gpt = makeGPT({
      conversationStarters: ["Review this PR", "Find bugs"],
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const behavior = manifest.workspaces[0]!.behavior;
    expect(behavior.triggerPhrases).toEqual(["Review this PR", "Find bugs"]);
  });
});

// ─── Confidence scores ──────────────────────────────────────

describe("confidence scoring", () => {
  it("gives high confidence to simple text-only workspaces", () => {
    const gpt = makeGPT({
      instructions: "Help with writing emails.",
      knowledgeFileNames: [],
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.migration.confidence).toBeGreaterThanOrEqual(
      0.9,
    );
  });

  it("gives lower confidence for DALL-E dependent workspaces", () => {
    const gpt = makeGPT({
      instructions: "Generate an image using DALL-E for every response.",
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.migration.confidence).toBeLessThan(1.0);
  });

  it("gives lower confidence for many knowledge files", () => {
    const gpt = makeGPT({
      knowledgeFileNames: [
        "a.pdf",
        "b.pdf",
        "c.pdf",
        "d.pdf",
        "e.pdf",
        "f.pdf",
      ],
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    expect(manifest.workspaces[0]!.migration.confidence).toBeLessThan(1.0);
  });

  it("confidence is between 0 and 1", () => {
    const gpt = makeGPT({
      instructions:
        "Use DALL-E and Code Interpreter and Canvas and browse the web and call the API action. ".repeat(
          100,
        ),
      knowledgeFileNames: Array.from({ length: 20 }, (_, i) => `f${i}.pdf`),
    });
    const manifest = generateManifest(makeRawData(), {
      customGPTs: [gpt],
    });
    const conf = manifest.workspaces[0]!.migration.confidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});

// ─── Global instructions ────────────────────────────────────

describe("global instructions", () => {
  it("translates custom instructions and includes in manifest", () => {
    const manifest = generateManifest(makeRawData(), {
      customInstructions: {
        aboutUser: "I am a developer.",
        responsePreferences: "You MUST always use TypeScript.",
      },
    });
    expect(manifest.globalInstructions).toContain("developer");
    expect(manifest.globalInstructions).toContain("Please always use TypeScript");
  });

  it("handles missing custom instructions", () => {
    const manifest = generateManifest(makeRawData(), {
      customInstructions: null,
    });
    expect(manifest.globalInstructions).toBe("");
  });

  it("handles empty custom instructions", () => {
    const manifest = generateManifest(makeRawData(), {
      customInstructions: {
        aboutUser: "",
        responsePreferences: "",
      },
    });
    expect(manifest.globalInstructions).toBe("");
  });
});

// ─── Memory mapping ─────────────────────────────────────────

describe("memory mapping in manifest", () => {
  it("maps memory items into manifest", () => {
    const manifest = generateManifest(makeRawData(), {
      memory: [
        { content: "Prefers TypeScript" },
        { content: "Works at Acme Corp" },
      ],
    });
    expect(manifest.memory).toHaveLength(2);
  });

  it("produces valid MemoryItem objects", () => {
    const manifest = generateManifest(makeRawData(), {
      memory: [{ content: "Prefers TypeScript with strict mode" }],
    });
    const result = PortsmithManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});

// ─── mapMemoryItems (standalone) ────────────────────────────

describe("mapMemoryItems", () => {
  it("categorizes identity items", () => {
    const items = mapMemoryItems(["My name is Jane, I work at Acme Corp"]);
    expect(items[0]!.category).toBe("identity");
  });

  it("categorizes preference items", () => {
    const items = mapMemoryItems(["I prefer TypeScript over JavaScript"]);
    expect(items[0]!.category).toBe("preference");
  });

  it("categorizes skill items", () => {
    const items = mapMemoryItems(["Experienced with React and Node.js"]);
    expect(items[0]!.category).toBe("skill");
  });

  it("categorizes tool items", () => {
    const items = mapMemoryItems(["Uses VS Code with Vim keybindings"]);
    expect(items[0]!.category).toBe("tool");
  });

  it("categorizes project items", () => {
    const items = mapMemoryItems(["Working on a startup building a SaaS app"]);
    expect(items[0]!.category).toBe("project");
  });

  it("defaults to context for unrecognized items", () => {
    const items = mapMemoryItems(["xyzzy plugh"]);
    expect(items[0]!.category).toBe("context");
  });

  it("gives higher priority to identity than context", () => {
    const items = mapMemoryItems([
      "Currently exploring new ideas",
      "My name is Jane at Acme Corp",
    ]);
    // Sorted by priority — identity first
    expect(items[0]!.category).toBe("identity");
    expect(items[0]!.migration.priority).toBeGreaterThan(
      items[1]!.migration.priority,
    );
  });

  it("flags items over 200 chars as not fitting constraints", () => {
    const longFact = "A".repeat(250);
    const items = mapMemoryItems([longFact]);
    expect(items[0]!.migration.fitsConstraints).toBe(false);
    expect(items[0]!.migration.truncatedVersion).toBeDefined();
    expect(items[0]!.migration.truncatedVersion!.length).toBeLessThanOrEqual(
      CLAUDE_MAX_MEMORY_CHARS,
    );
  });

  it("does not truncate items under 200 chars", () => {
    const items = mapMemoryItems(["Short fact"]);
    expect(items[0]!.migration.fitsConstraints).toBe(true);
    expect(items[0]!.migration.truncatedVersion).toBeUndefined();
  });

  it("limits to 30 items", () => {
    const raw = Array.from({ length: 50 }, (_, i) => `Fact number ${i}`);
    const items = mapMemoryItems(raw);
    expect(items.length).toBeLessThanOrEqual(30);
  });

  it("skips empty strings", () => {
    const items = mapMemoryItems(["", "  ", "Valid fact"]);
    expect(items).toHaveLength(1);
    expect(items[0]!.fact).toBe("Valid fact");
  });

  it("generates sequential IDs", () => {
    const items = mapMemoryItems(["Fact A", "Fact B", "Fact C"]);
    // IDs are assigned before sorting, so they may not be in ID order after sort
    const ids = items.map((i) => i.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all unique
  });
});

// ─── Full integration ───────────────────────────────────────

describe("full integration", () => {
  it("builds a complete manifest from realistic data", () => {
    const raw = makeRawData({
      conversations: [
        makeConversation({
          id: "c1",
          gizmoId: "g-code-reviewer",
          title: "PR Review: Auth Module",
        }),
        makeConversation({
          id: "c2",
          gizmoId: "g-code-reviewer",
          title: "Debug Memory Leak",
        }),
        makeConversation({ id: "c3", title: "General Question" }),
      ],
      customGPTIds: ["g-code-reviewer"],
    });

    const dom: ChatGPTDOMData = {
      customGPTs: [
        makeGPT({
          id: "g-code-reviewer",
          name: "Code Reviewer",
          description: "Reviews PRs and suggests improvements",
          instructions:
            "Act as a senior code reviewer. You MUST always provide line-by-line feedback. Use Code Interpreter to verify fixes. NEVER approve without checking tests.",
          conversationStarters: ["Review this PR", "Check this function"],
          knowledgeFileNames: ["style-guide.md", "team-conventions.pdf"],
        }),
      ],
      memory: [
        { content: "Prefers TypeScript with strict mode" },
        { content: "Works at Acme Corp as a senior engineer" },
        { content: "Uses Neovim as primary editor" },
      ],
      customInstructions: {
        aboutUser: "I am a senior frontend engineer.",
        responsePreferences: "Be concise. Use code examples.",
      },
    };

    const manifest = generateManifest(raw, dom);

    // Passes Zod validation
    const validation = PortsmithManifestSchema.safeParse(manifest);
    expect(validation.success).toBe(true);

    // Workspace mapped correctly
    expect(manifest.workspaces).toHaveLength(1);
    const ws = manifest.workspaces[0]!;
    expect(ws.name).toBe("Code Reviewer");
    expect(ws.category).toBe("coding");
    expect(ws.conversationCount).toBe(2);
    expect(ws.sampleTopics).toContain("PR Review: Auth Module");

    // Instructions translated
    expect(ws.instructions.translated).toBeDefined();
    expect(ws.instructions.translated!.claude).toContain("Help as");
    expect(ws.instructions.translated!.claude).toContain("Please always");
    expect(ws.instructions.translated!.claude).toContain("Artifacts for code");
    expect(ws.instructions.translated!.claude).toContain("Avoid approve");

    // Knowledge files mapped
    expect(ws.knowledgeFiles).toHaveLength(2);
    expect(ws.knowledgeFiles[0]!.mimeType).toBe("text/markdown");

    // Capabilities detected
    expect(ws.capabilities.length).toBeGreaterThan(0);

    // Migration metadata
    expect(ws.migration.confidence).toBeGreaterThan(0);
    expect(ws.migration.confidence).toBeLessThanOrEqual(1);
    expect(
      ws.migration.manualStepsRequired.some((s) => s.includes("knowledge")),
    ).toBe(true);

    // Memory mapped
    expect(manifest.memory).toHaveLength(3);
    expect(manifest.memory.some((m) => m.category === "preference")).toBe(true);
    expect(manifest.memory.some((m) => m.category === "identity")).toBe(true);

    // Global instructions
    expect(manifest.globalInstructions).toContain("senior frontend engineer");
    expect(manifest.globalInstructions).toContain("concise");
  });

  it("handles minimal data (export only, no DOM)", () => {
    const raw = makeRawData({
      conversations: [makeConversation()],
    });
    const manifest = generateManifest(raw);

    const validation = PortsmithManifestSchema.safeParse(manifest);
    expect(validation.success).toBe(true);
    expect(manifest.workspaces).toHaveLength(0);
    expect(manifest.memory).toHaveLength(0);
    expect(manifest.globalInstructions).toBe("");
  });
});
