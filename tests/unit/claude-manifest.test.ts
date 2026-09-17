import { describe, it, expect } from "vitest";
import type { ExtractedClaudeMemoryEntry } from "@/core/adapters/claude-dom-types";
import { generateClaudeManifest, memoryNoteToFacts } from "@/core/transform/claude-manifest";
import { renderMemoryImportText } from "@/core/transform/memory-export";

function note(overrides: Partial<ExtractedClaudeMemoryEntry> = {}): ExtractedClaudeMemoryEntry {
  return { path: "/profile.md", title: "Profile", summary: "", body: "", updatedAt: "", ...overrides };
}

describe("memoryNoteToFacts", () => {
  it("makes one fact per line and drops headings, list markers and tags", () => {
    const facts = memoryNoteToFacts(
      note({
        body: [
          "# Profile",
          "",
          "## Work",
          "- [stated] Works as a nurse",
          "* [inferred] [recent]  Lives in Lisbon",
          "1. [stated] Works as a nurse",
          "2) Plays the cello",
          "#hashtag is not a heading",
        ].join("\n"),
      }),
    );
    expect(facts).toEqual([
      "Works as a nurse",
      "Lives in Lisbon",
      "Works as a nurse",
      "Plays the cello",
      "#hashtag is not a heading",
    ]);
  });

  it("only strips tags at the start of a line", () => {
    expect(memoryNoteToFacts(note({ body: "- Likes [brackets] in text\n- [2026] Moved house\n- [stated]" }))).toEqual([
      "Likes [brackets] in text",
      "[2026] Moved house",
    ]);
  });

  it("puts the note title before facts about people and areas", () => {
    const person = note({ path: "/people/sam.md", title: "Sam", body: "# Sam\n- [stated] Brother, lives in Porto\n- Birthday in May" });
    expect(memoryNoteToFacts(person)).toEqual(["Sam: Brother, lives in Porto", "Sam: Birthday in May"]);

    const area = note({ path: "/areas/garden.md", title: "Garden", body: "- Grows tomatoes" });
    expect(memoryNoteToFacts(area)).toEqual(["Garden: Grows tomatoes"]);

    const topic = note({ path: "/topics/cooking.md", title: "Cooking", body: "- Likes risotto" });
    expect(memoryNoteToFacts(topic)).toEqual(["Likes risotto"]);
  });

  it("falls back to the summary and returns nothing for an empty note", () => {
    expect(memoryNoteToFacts(note({ summary: "Who the user is" }))).toEqual(["Who the user is"]);
    expect(memoryNoteToFacts(note({ body: "# Only a heading\n\n" }))).toEqual([]);
    expect(memoryNoteToFacts(note())).toEqual([]);
  });
});

describe("generateClaudeManifest: global memory facts", () => {
  it("turns a tagged note with a heading and a duplicate into clean memory items", () => {
    const manifest = generateClaudeManifest([], [], {
      memory: [
        note({
          body: "# About me\n- [stated] Lives in Lisbon\n- [stated] Works as a nurse\n- [stated] Lives in Lisbon",
        }),
      ],
    });
    const facts = manifest.memory.map((m) => m.fact);
    expect(facts.sort()).toEqual(["Lives in Lisbon", "Works as a nurse"]);
    expect(facts.some((f) => f.includes("[stated]"))).toBe(false);
    expect(facts).not.toContain("About me");

    const text = renderMemoryImportText(manifest.memory, "Claude");
    expect(text).not.toContain("[stated]");
    expect(text).not.toMatch(/^- About me$/m);
    expect(text.match(/^- /gm)).toHaveLength(2);
  });

  it("removes duplicates across notes", () => {
    const manifest = generateClaudeManifest([], [], {
      memory: [
        note({ body: "- Lives in Lisbon" }),
        note({ path: "/preferences.md", title: "Preferences", body: "- [stated] lives in  lisbon" }),
      ],
    });
    expect(manifest.memory).toHaveLength(1);
  });
});
