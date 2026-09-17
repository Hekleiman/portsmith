import { describe, it, expect } from "vitest";
import type { Workspace } from "@/core/schema/types";
import {
  buildKnowledgeField,
  buildProcessFileRequest,
  parseProcessFileResponse,
} from "@/content-scripts/gemini/knowledge";
import { buildGemKnowledgeStep, geminiGemEditUrl } from "@/core/adapters/gemini-guided";
import { buildLeftoverCards } from "@/core/adapters/leftover-cards";
import { decodeResponse, encodeRequest } from "@/content-scripts/gemini/batchexecute";
import {
  createSavedInfoRequest,
  listSavedInfoRequest,
  parseCreateSavedInfoRefusal,
  parseCreateSavedInfoResponse,
  splitSavedInfoText,
  SAVED_INFO_API_MAX_LENGTH,
  parseListSavedInfoResponse,
  savedInfoKey,
} from "@/content-scripts/gemini/saved-info";

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
      sizeBytes: 1,
      source: "exported" as const,
      contentRef: `file-${name}`,
      compatible: true,
    })),
    category: "other",
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
    projectMemory: {
      source: "claude_memory",
      capturedAt: "2026-09-01T00:00:00.000Z",
      entries: [{ id: "e", title: "Stack", content: "Vite" }],
    },
    ...overrides,
  };
}

describe("Gem knowledge payloads (recorded Sep 2026)", () => {
  it("builds ProcessFile's f.req like the Gem editor", () => {
    expect(
      buildProcessFileRequest(
        "/contrib_service/ttl_1d/abc",
        "portsmith-knowledge-test.md",
        "text/markdown",
        "en",
      ),
    ).toBe(
      String.raw`[null,"[[[\"/contrib_service/ttl_1d/abc\",null,1,\"text/markdown\"],\"portsmith-knowledge-test.md\",null,null,null,null,null,null,[1]],null,1,[\"en\"]]"]`,
    );
  });

  it("reads the handle from a streamed ProcessFile reply", () => {
    const record = (h: string) => [null, 16, "tsconfig.json", null, null, h, null, [], 1, [1, 2], null, "application/json", null, [true]];
    const frame = (body: unknown[]) => JSON.stringify([["wrb.fr", null, JSON.stringify(body)]]);
    const parts = [
      frame([record("$AXfirst"), [1], 2]),
      frame([record("$AXfinal"), null, 1]),
      JSON.stringify([["di", 810], ["af.httprm", 810, "5", 10]]),
      JSON.stringify([["e", 5, null, null, 10279]]),
    ];
    const text = ")]}'\n\n" + parts.map((p) => `${p.length + 1}\n${p}`).join("\n");
    expect(parseProcessFileResponse(text)).toBe("$AXfinal");
    expect(parseProcessFileResponse(")]}'\n\n")).toBeNull();
  });

  it("wraps handles the way the Gem record stores them", () => {
    expect(buildKnowledgeField([])).toEqual([]);
    expect(JSON.stringify(buildKnowledgeField(["$a", "$b"]))).toBe(
      '[[[null,null,null,null,null,"$a"],[null,null,null,null,null,"$b"]]]',
    );
  });
});

describe("geminiGemEditUrl", () => {
  it("opens the Gem editor on the run's account", () => {
    expect(geminiGemEditUrl("5c04ab988642", "/u/1/")).toBe(
      "https://gemini.google.com/u/1/gems/edit/5c04ab988642",
    );
    expect(geminiGemEditUrl("x", null)).toBe("https://gemini.google.com/gems/edit/x");
    expect(geminiGemEditUrl("x", "evil.com/")).toBe("https://gemini.google.com/gems/edit/x");
  });
});

describe("buildGemKnowledgeStep", () => {
  it("lists only what is left and links to the Gem editor", () => {
    const step = buildGemKnowledgeStep(ws(), "Claude", {
      link: "https://gemini.google.com/gems/edit/g1",
      remaining: { fileNames: ["two.md"], projectMemory: false },
    });
    expect(step?.link).toBe("https://gemini.google.com/gems/edit/g1");
    expect(step?.downloads?.map((d) => d.fileName)).toEqual(["two.md"]);
    expect(step?.description).toContain('"Update"');
    expect(step?.description).not.toContain("project memory");
  });

  it("keeps everything for the guided flow", () => {
    const step = buildGemKnowledgeStep(ws(), "Claude");
    expect(step?.link).toBe("https://gemini.google.com/gems/view");
    expect(step?.downloads?.map((d) => d.fileName)).toEqual([
      "project-memory-from-claude.md",
      "one.md",
      "two.md",
    ]);
  });
});

describe("buildLeftoverCards", () => {
  it("shows manual creates and missing knowledge", () => {
    const a = ws();
    const b = ws({ id: "b", name: "Other" });
    const cards = buildLeftoverCards(
      [a, b],
      {
        completed: new Set(["a"]),
        manual: new Map([["b", "Not created in Gemini (HTTP 400)"]]),
        knowledgeLeftovers: new Map([
          ["a", { link: "https://gemini.google.com/gems/edit/g1", fileNames: [], projectMemory: true }],
        ]),
      },
      "gemini",
      "Claude",
    );
    expect(cards.map((c) => c.title)).toEqual([
      'Add knowledge files to "Site"',
      'Create "Other" in Gemini by hand',
    ]);
    expect(cards[0]?.downloads?.map((d) => d.fileName)).toEqual(["project-memory-from-claude.md"]);
    expect(cards[1]?.description).toContain("HTTP 400");
  });

  it("shows the cards an automatic Claude run skipped", () => {
    const cards = buildLeftoverCards(
      [ws()],
      {
        completed: new Set(["a"]),
        manual: new Map(),
        knowledgeLeftovers: new Map(),
        leftoverSteps: new Map([
          ["a", [{ id: "a-files", title: "Upload the remaining files", description: "x", copyBlocks: [] }]],
        ]),
      },
      "claude",
      "ChatGPT",
    );
    expect(cards.map((c) => c.title)).toEqual(['Upload the remaining files ("Site")']);
  });

  it("is empty after a clean run", () => {
    expect(
      buildLeftoverCards(
        [ws()],
        { completed: new Set(["a"]), manual: new Map(), knowledgeLeftovers: new Map() },
        "gemini",
        "Claude",
      ),
    ).toEqual([]);
  });
});

describe("Gemini saved info (recorded Sep 2026)", () => {
  it("builds the Add request like the saved-info page", () => {
    expect(encodeRequest([createSavedInfoRequest("i prefer short concise responses")])).toBe(
      String.raw`[[["xVRQX","[[null,\"i prefer short concise responses\"]]",null,"generic"]]]`,
    );
  });

  it("reads the saved entry from the reply", () => {
    const reply = String.raw`)]}'

294
[["wrb.fr","xVRQX","[null,null,null,[[[\"00065bb016e6aa7402ef18f66e168e2dea703354c7771a69\",\"I prefer short concise responses.\",[1789661716,849666000],null,[1789661716,849666000],null,null,null,null,2,1]]]]",null,null,null,"generic"],["di",4051],["af.httprm",4051,"-8797503184941870592",9]]
25
[["e",4,null,null,330]]
`;
    expect(parseCreateSavedInfoResponse(decodeResponse(reply))).toEqual({
      id: "00065bb016e6aa7402ef18f66e168e2dea703354c7771a69",
      text: "I prefer short concise responses.",
    });
    expect(parseCreateSavedInfoResponse(decodeResponse(")]}'\n\n25\n[[\"e\",4,null,null,330]]\n"))).toBeNull();
  });

  it("lists saved info page by page like the page does", () => {
    expect(listSavedInfoRequest().payload).toBe("[100]");
    expect(listSavedInfoRequest("tok").payload).toBe('[100,"tok"]');
    const first = String.raw`)]}'

387
[["wrb.fr","ZKcapf","[[[\"00065bb016e6aa7402ef18f66e168e2dea703354c7771a69\",\"I prefer short concise responses.\",[1789661716,849666000],null,[1789661716,849666000],null,null,null,null,2,1]],\"tCkwBQvCSjBxlmle7uW21HMatBrYxsTb7XtkGVXYhDpFz2GRwM85h+TLsV6/JkWSWTIoM771xmPDA3ovWi+sNR7FccSo2S+3tfJOeixxo\"]",null,null,null,"generic"],["di",154],["af.httprm",154,"-5012897955215166960",10]]
25
[["e",4,null,null,423]]
`;
    expect(parseListSavedInfoResponse(decodeResponse(first))).toEqual({
      entries: [{ id: "00065bb016e6aa7402ef18f66e168e2dea703354c7771a69", text: "I prefer short concise responses." }],
      nextPageToken: "tCkwBQvCSjBxlmle7uW21HMatBrYxsTb7XtkGVXYhDpFz2GRwM85h+TLsV6/JkWSWTIoM771xmPDA3ovWi+sNR7FccSo2S+3tfJOeixxo",
    });
    const last = String.raw`)]}'

108
[["wrb.fr","ZKcapf","[]",null,null,null,"generic"],["di",167],["af.httprm",167,"-2098518060154352639",10]]
25
[["e",4,null,null,144]]
`;
    expect(parseListSavedInfoResponse(decodeResponse(last))).toEqual({ entries: [], nextPageToken: null });
    // Signed out: no body, only an error code
    const signedOut = String.raw`)]}'

104
[["wrb.fr","ZKcapf",null,null,null,[7],"generic"],["di",41],["af.httprm",41,"1056582788776354194",11]]
`;
    expect(parseListSavedInfoResponse(decodeResponse(signedOut))).toBeNull();
  });

  it("compares entries the way Gemini rewrites them", () => {
    expect(savedInfoKey("i prefer short concise responses")).toBe(
      savedInfoKey("I prefer short concise responses."),
    );
  });
});

describe("Gemini saved-info length limit (measured Sep 2026)", () => {
  const within = (parts: string[]): boolean =>
    parts.every(
      (p) => p.length <= SAVED_INFO_API_MAX_LENGTH &&
        new TextEncoder().encode(p).length <= SAVED_INFO_API_MAX_LENGTH,
    );

  it("leaves text that already fits alone", () => {
    expect(splitSavedInfoText("I prefer short answers.")).toEqual(["I prefer short answers."]);
    expect(splitSavedInfoText("   ")).toEqual([]);
    expect(splitSavedInfoText("  padded  ")).toEqual(["padded"]);
  });

  it("splits at 1500 characters, not at the editor's 10,000", () => {
    const exact = "a".repeat(SAVED_INFO_API_MAX_LENGTH);
    expect(splitSavedInfoText(exact)).toEqual([exact]);
    expect(splitSavedInfoText("a".repeat(SAVED_INFO_API_MAX_LENGTH + 1))).toHaveLength(2);
  });

  it("prefers line breaks, then sentence ends, then word boundaries", () => {
    const sentence = `${"word ".repeat(200).trim()}.`;
    const parts = splitSavedInfoText(`${sentence}\n${sentence}`);
    expect(parts.length).toBeGreaterThan(1);
    expect(within(parts)).toBe(true);
    // Nothing is cut mid-word when a word boundary was available.
    expect(parts.every((p) => !p.startsWith("ord") && !p.endsWith("wor"))).toBe(true);
  });

  it("cuts inside a word only when one word is longer than the limit", () => {
    const parts = splitSavedInfoText("x".repeat(3200));
    expect(parts).toHaveLength(3);
    expect(within(parts)).toBe(true);
    expect(parts.join("")).toBe("x".repeat(3200));
  });

  it("keeps multi-byte characters whole and inside the byte budget", () => {
    // Emoji are 4 UTF-8 bytes and 2 UTF-16 units each.
    const parts = splitSavedInfoText("\u{1F6A7}".repeat(800));
    expect(within(parts)).toBe(true);
    expect(parts.join("")).toBe("\u{1F6A7}".repeat(800));
    expect(parts.every((p) => !p.includes("�"))).toBe(true);
  });
});

describe("Gemini saved-info refusals", () => {
  const frames = (envelope: unknown[]): unknown[] =>
    decodeResponse(
      (() => {
        const json = JSON.stringify([envelope]);
        return `)]}'\n\n${1 + json.length}\n${json}`;
      })(),
    );

  it("reads the error code off a refusal", () => {
    expect(parseCreateSavedInfoRefusal(frames(["wrb.fr", "xVRQX", null, null, null, [13], "generic"])))
      .toEqual([13]);
  });

  it("reports no code when the frame carries none", () => {
    expect(parseCreateSavedInfoRefusal(frames(["wrb.fr", "xVRQX", null, null, null, null, "generic"])))
      .toEqual([]);
  });

  it("is not a refusal when the reply has a body", () => {
    const saved = frames([
      "wrb.fr",
      "xVRQX",
      JSON.stringify([null, null, null, [[["id-1", "Saved.", [1, 2]]]]]),
      null,
      null,
      null,
      "generic",
    ]);
    expect(parseCreateSavedInfoRefusal(saved)).toBeNull();
    expect(parseCreateSavedInfoResponse(saved)).toEqual({ id: "id-1", text: "Saved." });
  });

  it("is null when there is no create frame at all", () => {
    expect(parseCreateSavedInfoRefusal(frames(["e", 4, null, null, 330]))).toBeNull();
  });
});
