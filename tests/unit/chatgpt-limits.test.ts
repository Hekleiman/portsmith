import { describe, it, expect } from "vitest";
import {
  CHATGPT_INSTRUCTIONS_MAX,
  CHATGPT_PROJECT_NAME_MAX,
  codePointLength,
  fitInstructions,
  fitProjectName,
} from "@/core/transform/chatgpt-limits";

const EMOJI = "😀"; // one code point, two UTF-16 units
const FAMILY = "👨‍👩‍👧"; // five code points joined into one character

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(EMOJI.length).toBe(2);
    expect(codePointLength(EMOJI)).toBe(1);
    expect(codePointLength("abc")).toBe(3);
  });
});

// ─── fitProjectName ─────────────────────────────────────────

describe("fitProjectName", () => {
  it("leaves a 50-code-point name unchanged", () => {
    const name = "a".repeat(50);
    expect(fitProjectName(name)).toEqual({ name, trimmed: false });
  });

  it("counts an emoji as one, so a 50-code-point name with one passes", () => {
    const name = "a".repeat(49) + EMOJI;
    expect(name.length).toBe(51);
    expect(fitProjectName(name)).toEqual({ name, trimmed: false });
  });

  it("trims surrounding whitespace without calling it trimmed", () => {
    expect(fitProjectName("  Research  ")).toEqual({ name: "Research", trimmed: false });
  });

  it("shortens a 51-code-point name to 50 or fewer", () => {
    const result = fitProjectName("a".repeat(51));
    expect(result.trimmed).toBe(true);
    expect(codePointLength(result.name)).toBeLessThanOrEqual(CHATGPT_PROJECT_NAME_MAX);
    expect(result.name).toBe("a".repeat(49) + "…");
  });

  it("cuts at the last space and drops trailing punctuation", () => {
    const name = "Quarterly planning, budgets, and hiring: the big one for 2027";
    const result = fitProjectName(name);
    expect(result.trimmed).toBe(true);
    expect(result.name).toBe("Quarterly planning, budgets, and hiring: the big…");
    expect(codePointLength(result.name)).toBeLessThanOrEqual(CHATGPT_PROJECT_NAME_MAX);
  });

  it("drops punctuation left before the cut", () => {
    const name = "Alpha beta gamma delta epsilon zeta eta theta, iota kappa";
    const result = fitProjectName(name);
    expect(result.name).toBe("Alpha beta gamma delta epsilon zeta eta theta…");
  });

  it("never splits an emoji at the cut", () => {
    const name = "a".repeat(48) + EMOJI + EMOJI + "bbb";
    const result = fitProjectName(name);
    expect(result.name).toBe("a".repeat(48) + EMOJI + "…");
    expect(result.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(codePointLength(result.name)).toBe(50);
  });

  it("never splits a joined emoji sequence at the cut", () => {
    const name = "a".repeat(46) + FAMILY + "bbb";
    const result = fitProjectName(name);
    expect(result.name).toBe("a".repeat(46) + "…");
  });
});

// ─── fitInstructions ────────────────────────────────────────

describe("fitInstructions", () => {
  it("passes 8000 code points with one emoji (JS length 8001) through unchanged", () => {
    const text = "a".repeat(7999) + EMOJI;
    expect(text.length).toBe(8001);
    expect(fitInstructions(text, "ChatGPT")).toEqual({ instructions: text, overflow: null });
  });

  it("cuts 9000 code points to 8000 or fewer, ending in the pointer line", () => {
    const paragraph = "word ".repeat(99) + "end.";
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n").slice(0, 9000);
    expect(codePointLength(text)).toBe(9000);

    const result = fitInstructions(text, "My Research GPT");
    const fileName = "full-instructions-from-my-research-gpt.md";

    expect(codePointLength(result.instructions)).toBeLessThanOrEqual(CHATGPT_INSTRUCTIONS_MAX);
    expect(
      result.instructions.endsWith(
        `\n\nThe full instructions are in the project file ${fileName}.`,
      ),
    ).toBe(true);
    expect(result.overflow?.fileName).toBe(fileName);
    expect(result.overflow?.content).toContain(text);
    expect(result.overflow?.content.split("\n")[0]).toMatch(/^# /);
  });

  it("cuts at the last blank line when there is one", () => {
    const text = "a".repeat(5000) + "\n\n" + "b".repeat(5000);
    const result = fitInstructions(text, "x");
    expect(result.instructions.startsWith("a".repeat(5000) + "\n\nThe full")).toBe(true);
  });

  it("falls back to the last newline, then the last space", () => {
    const newline = fitInstructions("a".repeat(5000) + "\n" + "b".repeat(5000), "x");
    expect(newline.instructions.startsWith("a".repeat(5000) + "\n\nThe full")).toBe(true);

    const space = fitInstructions("a".repeat(5000) + " " + "b".repeat(5000), "x");
    expect(space.instructions.startsWith("a".repeat(5000) + "\n\nThe full")).toBe(true);
  });

  it("never splits a surrogate pair when there is no boundary to cut at", () => {
    const text = EMOJI.repeat(9000);
    const result = fitInstructions(text, "Gemini");
    expect(codePointLength(result.instructions)).toBeLessThanOrEqual(CHATGPT_INSTRUCTIONS_MAX);
    expect(result.instructions).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result.instructions).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
