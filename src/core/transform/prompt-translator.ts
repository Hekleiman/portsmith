// ─── Prompt Translator ───────────────────────────────────────
// Rule-based adaptation of ChatGPT instructions for Claude.
// No LLM: small, deterministic transforms that must never change what the
// instructions mean. Every rule skips fenced and inline code.
//
// Based on Anthropic's prompting guidance (platform.claude.com, "Prompting
// best practices", checked Sep 2026):
// - Role prompts ("You are a ...") work well, so they are left alone.
// - Newer Claude models over-apply shouted directives ("CRITICAL: You MUST"),
//   so all-caps directive words are written in normal case.
// Anything that could be a literal (quoted text, labels, RFC 2119 keywords,
// lists of capitalized options) is left exactly as written. Markdown
// structure is kept too: Claude reads headings well, and rewriting them
// into XML tags risked dropping words.

// ─── Types ───────────────────────────────────────────────────

export interface TranslationResult {
  translated: string;
  rulesApplied: string[];
}

export interface TranslationRule {
  name: string;
  /** Returns the new text, or null when the rule changed nothing. */
  apply: (text: string) => string | null;
}

// ─── Code masking ───────────────────────────────────────────
// Code is swapped for placeholders before the rules run and restored
// afterwards. Placeholders use private-use characters that no rule matches.

const MASK_OPEN = "\uE000";
const MASK_CLOSE = "\uE001";
const MASK_RE = new RegExp(`${MASK_OPEN}\\d+${MASK_CLOSE}`, "g");

interface Masked {
  masked: string;
  restore: (text: string) => string;
}

export function maskCode(text: string): Masked {
  const saved: string[] = [];
  const keep = (chunk: string): string => {
    saved.push(chunk);
    return `${MASK_OPEN}${saved.length - 1}${MASK_CLOSE}`;
  };

  const out: string[] = [];
  let fence: RegExp | null = null;
  let block: string[] = [];

  for (const line of text.split("\n")) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open?.[1]) {
        const marker = open[1];
        fence = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
        block = [line];
        continue;
      }
      // Inline code spans (`code`, ``code``)
      out.push(line.replace(/(`+)[^`\n]+?\1(?!`)/g, (m) => keep(m)));
    } else {
      block.push(line);
      if (fence.test(line)) {
        out.push(keep(block.join("\n")));
        fence = null;
        block = [];
      }
    }
  }
  // An unclosed fence runs to the end of the text
  if (fence !== null) out.push(keep(block.join("\n")));

  return {
    masked: out.join("\n"),
    restore: (t) => t.replace(MASK_RE, (m) => saved[Number(m.slice(1, -1))] ?? m),
  };
}

// ─── Capability Detection ────────────────────────────────────

export interface DetectedCapabilities {
  usesDallE: boolean;
  usesCodeInterpreter: boolean;
  usesBrowsing: boolean;
  usesCanvas: boolean;
  usesApiActions: boolean;
}

const DALLE_PATTERNS = [
  // DALL-E, DALLE, DALL E and the official "DALL·E"
  /\bdall[\s\-.\u00B7\u2022]?e\b/i,
  /\bgpt-image\b/i,
  /\bgenerate\s+(?:an?\s+)?images?\b/i,
  /\bcreate\s+(?:an?\s+)?images?\b/i,
  /\bimage\s+generation\b/i,
];

const CODE_INTERPRETER_PATTERNS = [
  /\bcode\s+interpreter\b/i,
  /\badvanced\s+data\s+analysis\b/i,
  /\b(?:run|execute)\s+(?:the\s+)?(?:python|code)\b/i,
];

const BROWSING_PATTERNS = [
  /\bbrowse\s+the\s+(?:web|internet)\b/i,
  /\bweb\s+browsing\b/i,
  /\bsearch\s+the\s+(?:internet|web)\b/i,
];

// "Canvas" is also a school platform, so only ChatGPT phrasing counts.
const CANVAS_PATTERNS = [
  /\bcanvas\s+(?:mode|tool|feature)\b/i,
  /\bchatgpt(?:['\u2019]s)?\s+canvas\b/i,
  /\b(?:open|use)\s+(?:a\s+|the\s+)?canvas\b(?!\s+(?:lms|course|assignment|page|module|quiz|app))/i,
];

// "Use action verbs" is not an API action, so require stronger wording.
const API_ACTIONS_PATTERNS = [
  /\b(?:api|custom|gpt)\s+actions?\b/i,
  /\bactions?\s+(?:schema|endpoints?)\b/i,
  /\bopenapi\b/i,
  /\bcall\s+(?:the\s+)?(?:[\w-]+\s+)?(?:api|endpoint)\b/i,
];

export function detectCapabilities(instructions: string): DetectedCapabilities {
  const text = maskCode(instructions).masked;
  return {
    usesDallE: DALLE_PATTERNS.some((p) => p.test(text)),
    usesCodeInterpreter: CODE_INTERPRETER_PATTERNS.some((p) => p.test(text)),
    usesBrowsing: BROWSING_PATTERNS.some((p) => p.test(text)),
    usesCanvas: CANVAS_PATTERNS.some((p) => p.test(text)),
    usesApiActions: API_ACTIONS_PATTERNS.some((p) => p.test(text)),
  };
}

// ─── Helpers ────────────────────────────────────────────────

/** Whether `offset` in `text` starts a sentence or a list item. */
function startsSentence(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  return (
    /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*|__)?$/.test(before) ||
    /[.!?:]\s*(?:\*\*|__)?$/.test(before) ||
    /[("\u201C]$/.test(before)
  );
}

function capitalize(word: string): string {
  return word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
}

// ─── Rules ──────────────────────────────────────────────────

/**
 * Rule 1: Write shouted directives in normal case.
 * "NEVER reveal" → "Never reveal", "you MUST cite" → "you must cite".
 * A word only changes when it reads as a directive: followed by a
 * lowercase word ("NEVER share"), outside quotes, not after words that
 * introduce a literal ("reply with", "set to", "the keyword"), and in a
 * sentence with no other capitalized words ("ALWAYS, SOMETIMES or NEVER").
 * Texts that cite RFC 2119 are skipped, because there the capitals carry
 * meaning. Labels such as "IMPORTANT:" are left as written.
 */
const EMPHASIS_RE =
  /(?<![A-Za-z0-9_'\u2019-])(?:MUST\s+NOT|DO\s+NOT|DON['\u2019]T|NEVER|ALWAYS|MUST)(?![A-Za-z0-9_'\u2019-])/g;
const CAPS_WORD_RE = /(?<![A-Za-z0-9_])[A-Z][A-Z'\u2019]+(?![A-Za-z0-9_])/g;
const DIRECTIVE_WORDS = new Set(["MUST", "NOT", "DO", "DON'T", "DON\u2019T", "NEVER", "ALWAYS"]);
// Shouted labels that often start a directive ("IMPORTANT: NEVER ...")
const LABEL_WORDS = new Set(["IMPORTANT", "CRITICAL", "NOTE", "WARNING", "REMEMBER"]);
// Short all-caps words that are usually acronyms, not shouting
const ACRONYMS = new Set([
  "AI", "API", "APIS", "CEO", "CSS", "CSV", "EU", "FAQ", "GPT", "HTML", "HTTP", "HTTPS",
  "ID", "IDS", "JSON", "KPI", "LLM", "OK", "PDF", "PM", "PR", "QA", "SEO", "SQL", "UI",
  "UK", "URL", "URLS", "US", "USA", "UX", "XML", "YAML",
]);

function mostlyUppercase(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.6;
}

/** The sentence around `offset` on this line. */
function sentenceAt(line: string, offset: number): string {
  const before = line.slice(0, offset);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
  const after = line.slice(offset);
  const endMatch = /[.!?](?:\s|$)/.exec(after);
  return line.slice(start < 0 ? 0 : start + 2, endMatch ? offset + endMatch.index : line.length);
}

function hasOtherCapitals(sentence: string): boolean {
  for (const m of sentence.matchAll(CAPS_WORD_RE)) {
    const word = m[0].replace(/\u2019/g, "'");
    if (!DIRECTIVE_WORDS.has(word) && !ACRONYMS.has(word) && !LABEL_WORDS.has(word)) return true;
  }
  return false;
}

// Words after which a capitalized word is a value, not a directive:
// "say NEVER", "the keyword ALWAYS", "reply with MUST", "set it to NEVER"
const LITERAL_BEFORE_RE = new RegExp(
  "(?:\\b(?:words?|terms?|keywords?|commands?|values?|options?|flags?|labels?|tags?|fields?|" +
    "status|state|mode|level|priority|code|token|string|literal|placeholder|setting|policy|" +
    "say|says|saying|type|types|typing|writes?|prints?|outputs?|reply|replies|respond|responds|" +
    "answer|answers|label(?:ed|led)|mark(?:ed)?|tag(?:ged)?|named|called|titled|" +
    "to|as|is|are|was|were|be|equals?|of|or|and|from|than|with)|=)\\s*:?\\s*$",
  "i",
);

/** A directive is followed by the (lowercase) action it governs. */
const ACTION_AFTER_RE = /^\s*(?:\*\*|__)?\s*[a-z]/;

/** Whether `offset` sits inside a quoted string on this line. */
function insideQuotes(line: string, offset: number, length: number): boolean {
  const before = line.slice(0, offset);
  const after = line.slice(offset + length);
  if (/["'`\u201C\u2018]\s*$/.test(before) || /^\s*["'`\u201D\u2019]/.test(after)) return true;
  const straight = (before.match(/"/g) ?? []).length;
  const curlyOpen = (before.match(/\u201C/g) ?? []).length;
  const curlyClose = (before.match(/\u201D/g) ?? []).length;
  return straight % 2 === 1 || curlyOpen > curlyClose;
}

const normalizeEmphasisRule: TranslationRule = {
  name: "normalize_emphasis",
  apply(text) {
    if (/\bRFC\s*2119\b|\bBCP\s*14\b|\bRFC\s*8174\b/i.test(text)) return null;
    let changed = false;
    const lines = text.split("\n").map((line) => {
      // Judge the line without the directive words themselves
      if (mostlyUppercase(line.replace(EMPHASIS_RE, " "))) return line;
      return line.replace(EMPHASIS_RE, (word: string, offset: number) => {
        const before = line.slice(0, offset);
        const after = line.slice(offset + word.length);
        if (!ACTION_AFTER_RE.test(after)) return word;
        if (LITERAL_BEFORE_RE.test(before)) return word;
        if (insideQuotes(line, offset, word.length)) return word;
        if (hasOtherCapitals(sentenceAt(line, offset))) return word;
        const lower = word.toLowerCase();
        const next = startsSentence(line, offset) ? capitalize(lower) : lower;
        if (next !== word) changed = true;
        return next;
      });
    });
    return changed ? lines.join("\n") : null;
  },
};

/**
 * Rule 2: Use Claude's names for ChatGPT tools, keeping the grammar.
 * Only unambiguous product names are renamed.
 */
function replaceTerm(
  text: string,
  re: RegExp,
  replacement: string,
  onChange: () => void,
): string {
  return text.replace(re, (...args: unknown[]) => {
    const offset = args[args.length - 2] as number;
    onChange();
    return startsSentence(text, offset) ? capitalize(replacement) : replacement;
  });
}

const toolNamesRule: TranslationRule = {
  name: "claude_tool_names",
  apply(text) {
    let changed = false;
    const mark = (): void => {
      changed = true;
    };
    let result = text;
    // ChatGPT's product names, written as names (capitalized). Lowercase
    // "a code interpreter" could be something the user is building.
    result = replaceTerm(result, /\b(?:[Tt]he\s+)?Code Interpreter(?:\s+tool)?\b/g, "code execution", mark);
    result = replaceTerm(result, /\b(?:[Tt]he\s+)?Advanced Data Analysis(?:\s+tool)?\b/g, "code execution", mark);
    // Only canvas that is clearly ChatGPT's
    result = replaceTerm(
      result,
      /\b(?:(?:[Tt]he|[Aa])\s+)?ChatGPT(?:['\u2019]s)?\s+[Cc]anvas\b/g,
      "an artifact",
      mark,
    );
    return changed ? result : null;
  },
};

/**
 * Rule 3: For clearly code-focused instructions, mention artifacts.
 */
const CODE_INDICATORS = [
  /\bcode\b/i,
  /\bprogramm(?:ing|er)s?\b/i,
  /\bfunctions?\b/i,
  /\bscripts?\b/i,
  /\bsnippets?\b/i,
  /\bimplementations?\b/i,
  /\brefactor\w*/i,
  /\bdebug\w*/i,
  /\b(?:typescript|javascript|python|java|golang|rust|sql|react)\b/i,
];

const artifactsHintRule: TranslationRule = {
  name: "add_artifacts_hint",
  apply(text) {
    const hits = CODE_INDICATORS.filter((p) => p.test(text)).length;
    if (hits < 4 || /\bartifacts?\b/i.test(text)) return null;
    return `${text.trimEnd()}\n\nWhen you write complete programs or long code, put them in an artifact so they're easy to copy and run.`;
  },
};

// ─── Rule Registry ───────────────────────────────────────────

const ALL_RULES: TranslationRule[] = [
  normalizeEmphasisRule,
  toolNamesRule,
  artifactsHintRule,
];

// ─── Public API ──────────────────────────────────────────────

export function translateForClaude(instructions: string): TranslationResult {
  if (!instructions.trim()) {
    return { translated: "", rulesApplied: [] };
  }

  const { masked, restore } = maskCode(instructions);
  let current = masked;
  const rulesApplied: string[] = [];

  for (const rule of ALL_RULES) {
    const result = rule.apply(current);
    if (result !== null && result !== current) {
      current = result;
      rulesApplied.push(rule.name);
    }
  }

  const translated = restore(current);
  return translated === instructions
    ? { translated: instructions, rulesApplied: [] }
    : { translated, rulesApplied };
}

/**
 * Warnings for capabilities that don't carry over to Claude as they are.
 */
export function generateCapabilityWarnings(
  capabilities: DetectedCapabilities,
): string[] {
  const warnings: string[] = [];

  if (capabilities.usesDallE) {
    warnings.push(
      "These instructions mention image generation (DALL\u00B7E). Check how the new assistant should handle those requests.",
    );
  }
  if (capabilities.usesApiActions) {
    warnings.push(
      "These instructions use GPT Actions (API calls). Claude reaches other services through connectors (MCP) instead, so set those up separately.",
    );
  }
  if (capabilities.usesCanvas) {
    warnings.push(
      "ChatGPT's canvas is called an artifact in Claude, and the two work a little differently.",
    );
  }

  return warnings;
}
