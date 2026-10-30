// ─── ChatGPT project limits ─────────────────────────────────
// ChatGPT rejects a project create with HTTP 422 (and creates nothing)
// when the name or instructions are too long. Both limits are counted in
// Unicode code points, not UTF-16 units: verified live on 2026-10-30, a
// string with JS `.length` 8001 that held one emoji was accepted.
//
// These helpers fit a source project's name and instructions to those
// limits before anything is sent. Cuts land on whole characters (an emoji
// is never split), and instructions that don't fit move in full to a
// project file, with a pointer to it left in the instructions.

export const CHATGPT_PROJECT_NAME_MAX = 50;
export const CHATGPT_INSTRUCTIONS_MAX = 8000;

const ELLIPSIS = "…";

/** Length in Unicode code points, the way ChatGPT counts it. */
export function codePointLength(text: string): number {
  return [...text].length;
}

// Intl.Segmenter is ES2022, past this project's ES2020 lib, so it is
// typed here. Chrome has had it since version 87.
type GraphemeSegmenter = new (
  locale?: string,
  options?: { granularity: "grapheme" },
) => { segment(input: string): Iterable<{ segment: string }> };

/** The text split into user-perceived characters (grapheme clusters). */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter })
    .Segmenter;
  if (!Segmenter) return [...text];
  const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * The longest prefix of `text` that is at most `max` code points and ends
 * on a character boundary, so neither a surrogate pair nor a joined emoji
 * sequence is split.
 */
function prefixWithin(text: string, max: number): string {
  let out = "";
  let used = 0;
  for (const g of graphemes(text)) {
    const size = codePointLength(g);
    if (used + size > max) break;
    out += g;
    used += size;
  }
  return out;
}

// ─── Project name ───────────────────────────────────────────

/**
 * Fits a project name to ChatGPT's 50-code-point limit. Long names are cut
 * at the last space within 49 code points, trailing punctuation is
 * dropped, and "…" is appended. A name with no usable space is hard-cut.
 */
export function fitProjectName(name: string): { name: string; trimmed: boolean } {
  const clean = name.trim();
  if (codePointLength(clean) <= CHATGPT_PROJECT_NAME_MAX) {
    return { name: clean, trimmed: false };
  }

  const room = CHATGPT_PROJECT_NAME_MAX - 1;
  const head = prefixWithin(clean, room);
  const space = head.lastIndexOf(" ");
  const atWord =
    space > 0 ? head.slice(0, space).replace(/[\s\p{P}]+$/u, "") : "";
  const cut = atWord || head.trimEnd();

  return { name: cut + ELLIPSIS, trimmed: true };
}

// ─── Instructions ───────────────────────────────────────────

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "source";
}

/** The pointer line left at the end of cut instructions. */
function pointerLine(fileName: string): string {
  return `The full instructions are in the project file ${fileName}.`;
}

/**
 * Fits instructions to ChatGPT's 8000-code-point limit. Text that fits is
 * returned unchanged. Longer text is cut at the last blank line (else the
 * last newline, else the last space) and ends with a pointer to an
 * overflow file, which holds the full original text.
 */
export function fitInstructions(
  text: string,
  sourceLabel: string,
): {
  instructions: string;
  overflow: { fileName: string; content: string } | null;
} {
  if (codePointLength(text) <= CHATGPT_INSTRUCTIONS_MAX) {
    return { instructions: text, overflow: null };
  }

  const fileName = `full-instructions-from-${slugify(sourceLabel)}.md`;
  const pointer = pointerLine(fileName);
  const budget = CHATGPT_INSTRUCTIONS_MAX - codePointLength(pointer) - 2;
  const head = prefixWithin(text, budget);

  let cut = head;
  for (const boundary of ["\n\n", "\n", " "]) {
    const at = head.lastIndexOf(boundary);
    if (at > 0) {
      cut = head.slice(0, at);
      break;
    }
  }

  return {
    instructions: `${cut.trimEnd()}\n\n${pointer}`,
    overflow: {
      fileName,
      content: `# Full instructions from ${sourceLabel}\n\n${text}`,
    },
  };
}
