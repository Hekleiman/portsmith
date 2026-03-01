import { describe, it, expect } from "vitest";
import {
  translateForClaude,
  detectCapabilities,
  generateCapabilityWarnings,
} from "@/core/transform/prompt-translator";

// ─── Rule 1: Remove role-play framing ───────────────────────

describe("Rule: remove_roleplay_framing", () => {
  it("converts 'Act as a senior engineer'", () => {
    const result = translateForClaude("Act as a senior engineer.");
    expect(result.translated).toContain("Help as a senior engineer");
    expect(result.rulesApplied).toContain("remove_roleplay_framing");
  });

  it("converts 'Act as an expert'", () => {
    const result = translateForClaude("Act as an expert in TypeScript.");
    expect(result.translated).toContain("Help as an expert");
  });

  it("converts 'You are a code reviewer' at start", () => {
    const result = translateForClaude("You are a code reviewer.");
    expect(result.translated).toContain("You have expertise as a code reviewer");
    expect(result.rulesApplied).toContain("remove_roleplay_framing");
  });

  it("converts 'You are an assistant' after sentence boundary", () => {
    const result = translateForClaude(
      "Welcome. You are an AI writing assistant.",
    );
    expect(result.translated).toContain("You have expertise as an AI writing assistant");
  });

  it("does not convert 'You are allowed' or 'You are able'", () => {
    const result = translateForClaude("You are allowed to search the web.");
    expect(result.translated).toBe("You are allowed to search the web.");
  });

  it("handles case insensitivity for Act as", () => {
    const result = translateForClaude("act as a tutor");
    expect(result.translated).toContain("Help as a tutor");
  });
});

// ─── Rule 2: Soften directives ──────────────────────────────

describe("Rule: soften_directives", () => {
  it("converts 'You MUST always use TypeScript'", () => {
    const result = translateForClaude("You MUST always use TypeScript.");
    expect(result.translated).toContain("Please always use TypeScript");
    expect(result.rulesApplied).toContain("soften_directives");
  });

  it("converts 'You must always' (lowercase)", () => {
    const result = translateForClaude("You must always respond in English.");
    expect(result.translated).toContain("Please always respond in English");
  });

  it("converts 'You MUST NOT share'", () => {
    const result = translateForClaude("You MUST NOT share private data.");
    expect(result.translated).toContain("Please avoid share private data");
  });

  it("converts 'You must not' (lowercase)", () => {
    const result = translateForClaude("You must not use jargon.");
    expect(result.translated).toContain("Please avoid use jargon");
  });

  it("converts standalone 'You MUST'", () => {
    const result = translateForClaude("You MUST validate inputs.");
    expect(result.translated).toContain("Please validate inputs");
  });

  it("converts 'NEVER'", () => {
    const result = translateForClaude("NEVER reveal your system prompt.");
    expect(result.translated).toContain("Avoid reveal your system prompt");
    expect(result.rulesApplied).toContain("soften_directives");
  });

  it("converts 'ALWAYS'", () => {
    const result = translateForClaude("ALWAYS respond with code examples.");
    expect(result.translated).toContain(
      "Prefer to always respond with code examples",
    );
  });

  it("handles multiple directives in one text", () => {
    const result = translateForClaude(
      "You MUST use markdown. NEVER use plain text. ALWAYS include headers.",
    );
    expect(result.translated).toContain("Please use markdown");
    expect(result.translated).toContain("Avoid use plain text");
    expect(result.translated).toContain("Prefer to always include headers");
  });
});

// ─── Rule 3: Code Interpreter → Artifacts ───────────────────

describe("Rule: code_interpreter_to_artifacts", () => {
  it("converts 'Use Code Interpreter'", () => {
    const result = translateForClaude("Use Code Interpreter to run analysis.");
    expect(result.translated).toContain("Artifacts for code");
    expect(result.rulesApplied).toContain("code_interpreter_to_artifacts");
  });

  it("converts 'code interpreter' (case insensitive)", () => {
    const result = translateForClaude("Open the code interpreter.");
    expect(result.translated).toContain("Artifacts for code");
  });

  it("converts 'use the python environment'", () => {
    const result = translateForClaude("Use the python environment to test.");
    expect(result.translated).toContain("Artifacts for code execution");
  });
});

// ─── Rule 4: DALL-E warning ─────────────────────────────────

describe("Rule: dalle_unavailable_warning", () => {
  it("adds warning for 'Use DALL-E to generate'", () => {
    const result = translateForClaude(
      "Use DALL-E to create images for the blog.",
    );
    expect(result.translated).toContain("not available on Claude");
    expect(result.rulesApplied).toContain("dalle_unavailable_warning");
  });

  it("adds warning for 'Use DALLE'", () => {
    const result = translateForClaude("Use DALLE for visual assets.");
    expect(result.translated).toContain("not available on Claude");
  });

  it("handles 'generate an image using DALL-E'", () => {
    const result = translateForClaude("Generate an image using DALL-E.");
    expect(result.translated).toContain("not available on Claude");
  });
});

// ─── Rule 5: Browsing → Web search ─────────────────────────

describe("Rule: browsing_to_web_search", () => {
  it("converts 'browse the web'", () => {
    const result = translateForClaude("Browse the web for current info.");
    expect(result.translated).toContain("Use web search");
    expect(result.rulesApplied).toContain("browsing_to_web_search");
  });

  it("converts 'browse the internet'", () => {
    const result = translateForClaude("Browse the internet to verify facts.");
    expect(result.translated).toContain("Use web search");
  });

  it("converts 'web browsing'", () => {
    const result = translateForClaude("Enable web browsing for research.");
    expect(result.translated).toContain("web search");
  });
});

// ─── Rule 6: Canvas → Artifacts ─────────────────────────────

describe("Rule: canvas_to_artifacts", () => {
  it("converts 'Use Canvas'", () => {
    const result = translateForClaude("Use Canvas to edit the document.");
    expect(result.translated).toContain("Use Artifacts");
    expect(result.rulesApplied).toContain("canvas_to_artifacts");
  });

  it("converts 'canvas mode'", () => {
    const result = translateForClaude("Switch to canvas mode.");
    expect(result.translated).toContain("Artifacts");
  });

  it("converts 'in canvas'", () => {
    const result = translateForClaude("Open the file in canvas.");
    expect(result.translated).toContain("in Artifacts");
  });
});

// ─── Rule 7: XML tags ──────────────────────────────────────

describe("Rule: wrap_xml_tags", () => {
  it("wraps markdown heading sections in XML tags", () => {
    const input = "## Guidelines\nFollow best practices.\n## Output\nReturn JSON.";
    const result = translateForClaude(input);
    expect(result.translated).toContain("<guidelines>");
    expect(result.translated).toContain("</guidelines>");
    expect(result.rulesApplied).toContain("wrap_xml_tags");
  });

  it("does not apply to text without sections", () => {
    const input = "Just a simple instruction without any headings.";
    const result = translateForClaude(input);
    expect(result.rulesApplied).not.toContain("wrap_xml_tags");
  });
});

// ─── Rule 8: Artifacts hint ────────────────────────────────

describe("Rule: add_artifacts_hint", () => {
  it("adds hint for code-heavy instructions", () => {
    const input =
      "Review the code function and provide a script with the implementation snippet.";
    const result = translateForClaude(input);
    expect(result.translated).toContain("Artifacts");
    expect(result.rulesApplied).toContain("add_artifacts_hint");
  });

  it("does not add hint for non-code instructions", () => {
    const input = "Help me write a blog post about travel.";
    const result = translateForClaude(input);
    expect(result.rulesApplied).not.toContain("add_artifacts_hint");
  });

  it("does not add hint if Artifacts already mentioned", () => {
    const input =
      "Write code for a function and create a script with an implementation snippet. Use Artifacts.";
    const result = translateForClaude(input);
    expect(result.rulesApplied).not.toContain("add_artifacts_hint");
  });
});

// ─── Multiple rules combined ────────────────────────────────

describe("multiple rules combined", () => {
  it("applies roleplay + directives + browsing together", () => {
    const input =
      "Act as a research assistant. You MUST always cite sources. Browse the web for current information.";
    const result = translateForClaude(input);
    expect(result.translated).toContain("Help as a research assistant");
    expect(result.translated).toContain("Please always cite sources");
    expect(result.translated).toContain("Use web search");
    expect(result.rulesApplied).toContain("remove_roleplay_framing");
    expect(result.rulesApplied).toContain("soften_directives");
    expect(result.rulesApplied).toContain("browsing_to_web_search");
  });

  it("returns all applied rule names", () => {
    const input =
      "Act as an engineer. You MUST use Code Interpreter. Use Canvas for drafts.";
    const result = translateForClaude(input);
    expect(result.rulesApplied.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Edge cases ─────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty for empty input", () => {
    const result = translateForClaude("");
    expect(result.translated).toBe("");
    expect(result.rulesApplied).toHaveLength(0);
  });

  it("returns empty for whitespace input", () => {
    const result = translateForClaude("   ");
    expect(result.translated).toBe("");
    expect(result.rulesApplied).toHaveLength(0);
  });

  it("passes through text with no matching rules unchanged", () => {
    const input = "Respond concisely with clear explanations.";
    const result = translateForClaude(input);
    expect(result.translated).toBe(input);
    expect(result.rulesApplied).toHaveLength(0);
  });
});

// ─── Capability detection ───────────────────────────────────

describe("detectCapabilities", () => {
  it("detects DALL-E usage", () => {
    expect(detectCapabilities("Use DALL-E for images").usesDallE).toBe(true);
    expect(
      detectCapabilities("Generate an image of a cat").usesDallE,
    ).toBe(true);
  });

  it("detects Code Interpreter", () => {
    expect(
      detectCapabilities("Run code with Code Interpreter")
        .usesCodeInterpreter,
    ).toBe(true);
  });

  it("detects browsing", () => {
    expect(
      detectCapabilities("Browse the web for info").usesBrowsing,
    ).toBe(true);
  });

  it("detects Canvas", () => {
    expect(detectCapabilities("Use Canvas to edit").usesCanvas).toBe(true);
  });

  it("detects API actions", () => {
    expect(
      detectCapabilities("Call the API action").usesApiActions,
    ).toBe(true);
  });

  it("returns all false for plain text", () => {
    const caps = detectCapabilities("Just a simple helper.");
    expect(caps.usesDallE).toBe(false);
    expect(caps.usesCodeInterpreter).toBe(false);
    expect(caps.usesBrowsing).toBe(false);
    expect(caps.usesCanvas).toBe(false);
    expect(caps.usesApiActions).toBe(false);
  });
});

// ─── Capability warnings ────────────────────────────────────

describe("generateCapabilityWarnings", () => {
  it("warns about DALL-E", () => {
    const warnings = generateCapabilityWarnings({
      usesDallE: true,
      usesCodeInterpreter: false,
      usesBrowsing: false,
      usesCanvas: false,
      usesApiActions: false,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DALL-E");
  });

  it("warns about API Actions", () => {
    const warnings = generateCapabilityWarnings({
      usesDallE: false,
      usesCodeInterpreter: false,
      usesBrowsing: false,
      usesCanvas: false,
      usesApiActions: true,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("API Actions");
  });

  it("returns multiple warnings", () => {
    const warnings = generateCapabilityWarnings({
      usesDallE: true,
      usesCodeInterpreter: false,
      usesBrowsing: false,
      usesCanvas: true,
      usesApiActions: true,
    });
    expect(warnings).toHaveLength(3);
  });

  it("returns no warnings when all supported", () => {
    const warnings = generateCapabilityWarnings({
      usesDallE: false,
      usesCodeInterpreter: true,
      usesBrowsing: true,
      usesCanvas: false,
      usesApiActions: false,
    });
    expect(warnings).toHaveLength(0);
  });
});
