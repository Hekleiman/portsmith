import { describe, it, expect } from "vitest";
import {
  PortsmithManifestSchema,
  WorkspaceSchema,
  type MemoryItem,
  type Workspace,
} from "@/core/schema/types";
import {
  buildManualProjectMemory,
  hasProjectMemory,
  parsePastedProjectMemory,
  projectMemoryCapturePrompt,
  projectMemoryFileName,
  projectMemoryToEditableText,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";
import { renderMemoryImportText } from "@/core/transform/memory-export";
import {
  buildWorkspaceFromProject,
  generateClaudeManifest,
} from "@/core/transform/claude-manifest";
import { categorize } from "@/core/transform/categorize";
import {
  getInstructionsForTarget,
  platformLabel,
  supportedModesForTarget,
  withInstructionsForTarget,
} from "@/core/platforms";
import { normalizeGizmoId, sameGizmo } from "@/shared/chatgpt-ids";
import {
  base64ToBytes,
  base64ToText,
  bytesToBase64,
  textToBase64,
} from "@/shared/encoding";
import { isTextLikeFile } from "@/core/transform/file-compatibility";
import type { ExtractedClaudeProject } from "@/core/adapters/claude-dom-types";

// ─── Fixtures ───────────────────────────────────────────────

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    sourceId: "src-1",
    name: "Trip planner",
    description: "",
    instructions: { raw: "Plan trips." },
    knowledgeFiles: [],
    category: "personal",
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 0.9, warnings: [], manualStepsRequired: [] },
    ...overrides,
  };
}

function memoryItem(
  fact: string,
  category: MemoryItem["category"],
  priority = 3,
): MemoryItem {
  return {
    id: `m-${fact}`,
    fact,
    category,
    confidence: 1,
    source: "explicit",
    workspaceIds: [],
    migration: { fitsConstraints: true, priority },
  };
}

function claudeProject(overrides: Partial<ExtractedClaudeProject> = {}): ExtractedClaudeProject {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Code helper",
    description: "Helps with code",
    instructions: "Write clean TypeScript.",
    createdAt: "2026-01-01T00:00:00.000000Z",
    updatedAt: "2026-09-01T12:30:00.123456Z",
    ...overrides,
  };
}

const NOW = new Date("2026-09-16T10:00:00.000Z");

// ─── Project memory ─────────────────────────────────────────

describe("renderProjectMemoryMarkdown", () => {
  it("returns an empty string when there is no memory", () => {
    expect(renderProjectMemoryMarkdown(workspace(), "Claude", NOW)).toBe("");
    expect(
      renderProjectMemoryMarkdown(
        workspace({ projectMemory: { source: "manual", capturedAt: "x", entries: [] } }),
        "Claude",
        NOW,
      ),
    ).toBe("");
  });

  it("renders each entry under its own heading with provenance", () => {
    const md = renderProjectMemoryMarkdown(
      workspace({
        projectMemory: {
          source: "claude_memory",
          capturedAt: NOW.toISOString(),
          entries: [
            { id: "1", title: "Decisions", summary: "Trip decisions", content: "We fly to Rome." },
            { id: "2", title: "  ", content: "Budget is $3k." },
            { id: "3", title: "Dup", summary: "Same text", content: "Same text and more" },
          ],
        },
      }),
      "Claude",
      NOW,
    );
    expect(md.startsWith("# Project memory: Trip planner\n")).toBe(true);
    expect(md).toContain("Carried over from Claude by PortSmith on 2026-09-16.");
    expect(md).toContain("## Decisions\n\n_Trip decisions_\n\nWe fly to Rome.");
    expect(md).toContain("## Notes\n\nBudget is $3k.");
    // a summary already contained in the body is not repeated
    expect(md).not.toContain("_Same text_");
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toContain("\u2014");
  });
});

describe("parsePastedProjectMemory", () => {
  it("splits on headings and keeps text before the first heading", () => {
    const entries = parsePastedProjectMemory(
      "Intro line\r\n\r\n## Goals\n- Ship v2\n### Decisions ###\n- Use Postgres\n",
    );
    expect(entries).toEqual([
      { id: "pm-1", title: "Project notes", content: "Intro line" },
      { id: "pm-2", title: "Goals", content: "- Ship v2" },
      { id: "pm-3", title: "Decisions", content: "- Use Postgres" },
    ]);
  });

  it("ignores headings inside code fences and drops empty sections", () => {
    const entries = parsePastedProjectMemory(
      "## Setup\n```sh\n# not a heading\nnpm i\n```\n## Empty\n\n## End\ndone",
    );
    expect(entries.map((e) => e.title)).toEqual(["Setup", "End"]);
    expect(entries[0]!.content).toContain("# not a heading");
  });

  it("returns nothing for blank input", () => {
    expect(parsePastedProjectMemory("  \n\n ")).toEqual([]);
    expect(buildManualProjectMemory("   ", NOW)).toBeNull();
  });

  it("builds a manual memory that round-trips through the editor text", () => {
    const memory = buildManualProjectMemory("## Goals\nShip v2\n\n## People\nAna leads design", NOW)!;
    expect(memory.source).toBe("manual");
    expect(memory.capturedAt).toBe(NOW.toISOString());
    const text = projectMemoryToEditableText(memory);
    expect(text).toBe("## Goals\n\nShip v2\n\n## People\n\nAna leads design");
    expect(parsePastedProjectMemory(text).map((e) => [e.title, e.content])).toEqual([
      ["Goals", "Ship v2"],
      ["People", "Ana leads design"],
    ]);
  });

  it("produces a workspace that still validates", () => {
    const ws = workspace({ projectMemory: buildManualProjectMemory("## A\nb", NOW)! });
    expect(WorkspaceSchema.safeParse(ws).success).toBe(true);
    expect(hasProjectMemory(ws)).toBe(true);
  });
});

describe("project memory helpers", () => {
  it("builds a safe file name from the source label", () => {
    expect(projectMemoryFileName("ChatGPT")).toBe("project-memory-from-chatgpt.md");
    expect(projectMemoryFileName("!!!")).toBe("project-memory-from-source.md");
  });

  it("writes a capture prompt without em dashes", () => {
    const prompt = projectMemoryCapturePrompt("Trip planner");
    expect(prompt).toContain('"Trip planner"');
    expect(prompt).toContain("## ");
    expect(prompt).not.toContain("\u2014");
  });
});

// ─── Global memory export ───────────────────────────────────

describe("renderMemoryImportText", () => {
  it("returns an empty string when there is nothing to import", () => {
    expect(renderMemoryImportText([], "ChatGPT", "   ")).toBe("");
  });

  it("groups memories by category in a fixed order, highest priority first", () => {
    const text = renderMemoryImportText(
      [
        memoryItem("Uses neovim", "tool"),
        memoryItem("Name is Sam", "identity", 1),
        memoryItem("Lives in\n  Lisbon", "identity", 5),
        memoryItem("Prefers short answers", "instruction"),
      ],
      "ChatGPT",
      "Be direct.",
    );
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("These are the memories ChatGPT kept about me. Please remember them.");
    const headings = lines.filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## My custom instructions from ChatGPT",
      "## How I want responses",
      "## About me",
      "## Tools I use",
    ]);
    const about = lines.indexOf("## About me");
    expect(lines.slice(about + 1, about + 3)).toEqual(["- Lives in Lisbon", "- Name is Sam"]);
  });
});

// ─── Claude manifest ────────────────────────────────────────

describe("buildWorkspaceFromProject", () => {
  it("maps a project and keeps the raw instructions", () => {
    const ws = buildWorkspaceFromProject(claudeProject(), NOW.toISOString());
    expect(ws.id).toBe("ws-claude-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(ws.instructions).toEqual({ raw: "Write clean TypeScript." });
    expect(ws.category).toBe("coding");
    expect(ws.lastActiveAt).toBe("2026-09-01T12:30:00.123Z");
    expect(ws.migration.warnings).toEqual([]);
    expect(WorkspaceSchema.safeParse(ws).success).toBe(true);
  });

  it("marks copied docs as ready and binary files as manual", () => {
    const ws = buildWorkspaceFromProject(
      claudeProject({
        docs: [
          { uuid: "d1", fileName: "notes.md", mimeType: "text/markdown", sizeBytes: 12, contentRef: "file-claude-doc-d1" },
          { uuid: "d2", fileName: "big.md", mimeType: "text/markdown", sizeBytes: 99 },
        ],
        files: [{ uuid: "f1", fileName: "diagram.png", kind: "image" }],
      }),
      NOW.toISOString(),
    );
    const byName = Object.fromEntries(ws.knowledgeFiles.map((f) => [f.originalName, f]));
    expect(byName["notes.md"]).toMatchObject({ compatible: true, source: "exported", contentRef: "file-claude-doc-d1" });
    expect(byName["big.md"]).toMatchObject({ compatible: false, source: "referenced" });
    expect(byName["diagram.png"]).toMatchObject({ compatible: false, mimeType: "image/png" });
    expect(ws.migration.warnings[0]).toContain("2 file(s)");
    expect(ws.migration.confidence).toBeLessThan(0.95);
  });

  it("carries project memory and labels the legacy summary", () => {
    const entries = [
      { path: "/projects/x/a.md", title: "A", summary: "", body: "Body A", updatedAt: "2026-09-10T00:00:00Z" },
    ];
    const current = buildWorkspaceFromProject(claudeProject({ memory: entries, memorySource: "entries" }));
    const legacy = buildWorkspaceFromProject(claudeProject({ memory: entries, memorySource: "summary" }));
    expect(current.projectMemory?.source).toBe("claude_memory");
    expect(legacy.projectMemory?.source).toBe("claude_memory_summary");
    expect(current.projectMemory?.entries[0]).toEqual({
      id: "pm-1",
      title: "A",
      content: "Body A",
      updatedAt: "2026-09-10T00:00:00Z",
    });
    expect(buildWorkspaceFromProject(claudeProject({ memory: [] })).projectMemory).toBeUndefined();
  });

  it("warns about empty instructions and survives a bad date", () => {
    const ws = buildWorkspaceFromProject(
      claudeProject({ instructions: "  ", updatedAt: "not a date" }),
      NOW.toISOString(),
    );
    expect(ws.migration.warnings).toContain("This project has no instructions");
    expect(ws.lastActiveAt).toBe(NOW.toISOString());
  });
});

describe("generateClaudeManifest", () => {
  it("produces a valid manifest with extraction warnings", () => {
    const manifest = generateClaudeManifest(
      [claudeProject(), claudeProject({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Blog", instructions: "Write posts." })],
      [{ context: "memory", message: "Memory could not be read" }],
    );
    expect(PortsmithManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.source.platform).toBe("claude");
    expect(manifest.workspaces).toHaveLength(2);
    expect(manifest.metadata.extractionWarnings).toEqual(["Memory could not be read"]);
  });

  it("omits extractionWarnings when there are none", () => {
    expect(generateClaudeManifest([]).metadata.extractionWarnings).toBeUndefined();
  });
});

describe("categorize", () => {
  it("matches word stems", () => {
    expect(categorize("Writing coach", "")).toBe("writing");
    expect(categorize("Blog", "drafting posts")).toBe("writing");
    expect(categorize("Helper", "debugging python")).toBe("coding");
    expect(categorize("Market analysis", "")).toBe("research");
  });

  it("does not match inside other words", () => {
    expect(categorize("Rapid notes", "")).toBe("other");
  });
});

// ─── Platforms ──────────────────────────────────────────────

describe("platform helpers", () => {
  it("labels platforms with a neutral fallback", () => {
    expect(platformLabel("gemini")).toBe("Gemini");
    expect(platformLabel(null)).toBe("the target platform");
    expect(platformLabel("bing")).toBe("the target platform");
  });

  it("offers only guided delivery for ChatGPT", () => {
    expect(supportedModesForTarget("chatgpt")).toEqual(["guided"]);
    expect(supportedModesForTarget("claude")).toEqual(["autofill", "guided", "hybrid"]);
  });

  it("uses the per-target text and falls back to the original", () => {
    const base = workspace();
    const edited = withInstructionsForTarget(base, "gemini", "Gemini text");
    expect(getInstructionsForTarget(edited, "gemini")).toBe("Gemini text");
    expect(getInstructionsForTarget(edited, "claude")).toBe("Plan trips.");
    expect(getInstructionsForTarget(edited, null)).toBe("Plan trips.");
    // the original workspace is not mutated
    expect(base.instructions.translated).toBeUndefined();
    const both = withInstructionsForTarget(edited, "claude", "Claude text");
    expect(both.instructions.translated).toEqual({ gemini: "Gemini text", claude: "Claude text" });
  });
});

// ─── ChatGPT IDs ────────────────────────────────────────────

describe("normalizeGizmoId", () => {
  const hex = "0123456789abcdef0123456789abcdef";

  it("strips the readable slug from project and GPT IDs", () => {
    expect(normalizeGizmoId(`g-p-${hex}-trip-planning`)).toBe(`g-p-${hex}`);
    expect(normalizeGizmoId(`G-P-${hex.toUpperCase()}`)).toBe(`g-p-${hex}`);
    expect(normalizeGizmoId("g-2fkFE8rbu-dall-e")).toBe("g-2fkFE8rbu");
    expect(normalizeGizmoId(" g-2fkFE8rbu ")).toBe("g-2fkFE8rbu");
  });

  it("passes through unfamiliar gizmo IDs and rejects everything else", () => {
    expect(normalizeGizmoId("g-abcdefghijkl")).toBe("g-abcdefghijkl");
    expect(normalizeGizmoId("../../backend-api")).toBeNull();
    expect(normalizeGizmoId("g-abc/../x")).toBeNull();
    expect(normalizeGizmoId("")).toBeNull();
  });

  it("compares IDs with and without slugs", () => {
    expect(sameGizmo(`g-p-${hex}`, `g-p-${hex}-slug`)).toBe(true);
    expect(sameGizmo("g-2fkFE8rbu", "g-2fkFE8rbX")).toBe(false);
    expect(sameGizmo(undefined, "g-2fkFE8rbu")).toBe(false);
  });
});

// ─── Encoding ───────────────────────────────────────────────

describe("base64 helpers", () => {
  it("round-trips UTF-8 text", () => {
    const text = "Café ☕ 日本語 🚀";
    expect(base64ToText(textToBase64(text))).toBe(text);
  });

  it("handles large buffers without overflowing the stack", () => {
    const bytes = new Uint8Array(300_000).map((_, i) => i % 256);
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[299_999]).toBe(299_999 % 256);
    expect(decoded.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("returns null for bytes that are not UTF-8", () => {
    expect(base64ToText(bytesToBase64(new Uint8Array([0xff, 0xfe, 0x00])))).toBeNull();
  });
});

describe("isTextLikeFile", () => {
  it("accepts text MIME types, including parameters", () => {
    expect(isTextLikeFile("a", "text/plain; charset=utf-8")).toBe(true);
    expect(isTextLikeFile("a", "application/json")).toBe(true);
  });

  it("falls back to the extension", () => {
    expect(isTextLikeFile("notes.MD", "application/octet-stream")).toBe(true);
    expect(isTextLikeFile("script.py")).toBe(true);
  });

  it("rejects binary files", () => {
    expect(isTextLikeFile("report.pdf", "application/pdf")).toBe(false);
    expect(isTextLikeFile("photo.png", "image/png")).toBe(false);
    expect(isTextLikeFile("archive.zip")).toBe(false);
  });
});
