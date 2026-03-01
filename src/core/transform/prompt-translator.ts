// ─── Prompt Translator ───────────────────────────────────────
// Rule-based translation of ChatGPT-style instructions to Claude-style.
// V1: no LLM — deterministic regex/string transforms only.

// ─── Types ───────────────────────────────────────────────────

export interface TranslationResult {
  translated: string;
  rulesApplied: string[];
}

export interface TranslationRule {
  name: string;
  apply: (text: string) => string | null;
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
  /\bdall-?e\b/i,
  /\bgenerate\s+(an?\s+)?images?\b/i,
  /\bcreate\s+(an?\s+)?images?\b/i,
  /\bimage\s+generation\b/i,
];

const CODE_INTERPRETER_PATTERNS = [
  /\bcode\s+interpreter\b/i,
  /\brun\s+(python|code)\b/i,
  /\bexecute\s+(python|code)\b/i,
];

const BROWSING_PATTERNS = [
  /\bbrowse\s+the\s+web\b/i,
  /\bweb\s+browsing\b/i,
  /\bsearch\s+the\s+(internet|web)\b/i,
  /\bbrowse\s+the\s+internet\b/i,
];

const CANVAS_PATTERNS = [
  /\buse\s+canvas\b/i,
  /\bcanvas\s+mode\b/i,
  /\bin\s+canvas\b/i,
];

const API_ACTIONS_PATTERNS = [
  /\bapi\s+actions?\b/i,
  /\bcall\s+(the\s+)?api\b/i,
  /\buse\s+(the\s+)?actions?\b/i,
];

export function detectCapabilities(instructions: string): DetectedCapabilities {
  return {
    usesDallE: DALLE_PATTERNS.some((p) => p.test(instructions)),
    usesCodeInterpreter: CODE_INTERPRETER_PATTERNS.some((p) =>
      p.test(instructions),
    ),
    usesBrowsing: BROWSING_PATTERNS.some((p) => p.test(instructions)),
    usesCanvas: CANVAS_PATTERNS.some((p) => p.test(instructions)),
    usesApiActions: API_ACTIONS_PATTERNS.some((p) => p.test(instructions)),
  };
}

// ─── Translation Rules ──────────────────────────────────────

/**
 * Rule 1: Remove role-play framing.
 * "Act as..." / "You are a..." → collaborative tone.
 */
const rolePlayRule: TranslationRule = {
  name: "remove_roleplay_framing",
  apply(text) {
    let result = text;
    let changed = false;

    // "Act as a senior engineer" → "Help as a senior engineer would"
    result = result.replace(
      /\bAct\s+as\s+(an?\s+)?/gi,
      (_, article?: string) => {
        changed = true;
        return `Help as ${article ?? "a "}`;
      },
    );

    // "You are a senior engineer" → "You have expertise as a senior engineer"
    // But only at sentence start or after period/newline
    result = result.replace(
      /(?:^|(?<=\.\s)|(?<=\n))You\s+are\s+(an?\s+)?(?!allowed|able|expected|free|welcome|encouraged)/gim,
      (_, article?: string) => {
        changed = true;
        return `You have expertise as ${article ?? "a "}`;
      },
    );

    return changed ? result : null;
  },
};

/**
 * Rule 2: Soften absolute directives.
 * "You MUST always" → "Please always"
 * "NEVER" → "Avoid"
 * "You MUST NOT" → "Please avoid"
 */
const softenDirectivesRule: TranslationRule = {
  name: "soften_directives",
  apply(text) {
    let result = text;
    let changed = false;

    // "You MUST always" / "You must always" → "Please always"
    result = result.replace(/\bYou\s+MUST\s+always\b/g, () => {
      changed = true;
      return "Please always";
    });
    result = result.replace(/\bYou\s+must\s+always\b/g, () => {
      changed = true;
      return "Please always";
    });

    // "You MUST NOT" / "You must not" → "Please avoid"
    result = result.replace(/\bYou\s+MUST\s+NOT\b/g, () => {
      changed = true;
      return "Please avoid";
    });
    result = result.replace(/\bYou\s+must\s+not\b/g, () => {
      changed = true;
      return "Please avoid";
    });

    // "You MUST" (without always/not) → "Please"
    result = result.replace(/\bYou\s+MUST\b/g, () => {
      changed = true;
      return "Please";
    });
    result = result.replace(/\bYou\s+must\b/g, () => {
      changed = true;
      return "Please";
    });

    // "NEVER do X" → "Avoid doing X" — but only standalone NEVER at word boundary
    result = result.replace(/\bNEVER\b/g, () => {
      changed = true;
      return "Avoid";
    });

    // "ALWAYS" → "Prefer to always"
    result = result.replace(/\bALWAYS\b/g, () => {
      changed = true;
      return "Prefer to always";
    });

    return changed ? result : null;
  },
};

/**
 * Rule 3: Code Interpreter → Artifacts.
 */
const codeInterpreterRule: TranslationRule = {
  name: "code_interpreter_to_artifacts",
  apply(text) {
    let result = text;
    let changed = false;

    result = result.replace(/\bCode\s+Interpreter\b/gi, () => {
      changed = true;
      return "Artifacts for code";
    });

    result = result.replace(
      /\b[Uu]se\s+(?:the\s+)?python\s+(?:environment|sandbox|tool)\b/gi,
      () => {
        changed = true;
        return "Use Artifacts for code execution";
      },
    );

    return changed ? result : null;
  },
};

/**
 * Rule 4: DALL-E / image generation → warning flag.
 */
const dalleRule: TranslationRule = {
  name: "dalle_unavailable_warning",
  apply(text) {
    let result = text;
    let changed = false;

    result = result.replace(
      /\b[Uu]se\s+(?:the\s+)?DALL-?E\s+(?:to\s+)?/gi,
      () => {
        changed = true;
        return "[Note: Image generation is not available on Claude] ";
      },
    );

    result = result.replace(
      /\b[Gg]enerate\s+(?:an?\s+)?image(?:s)?\s+(?:using|with|via)\s+DALL-?E\b/gi,
      () => {
        changed = true;
        return "[Note: Image generation via DALL-E is not available on Claude]";
      },
    );

    return changed ? result : null;
  },
};

/**
 * Rule 5: "Browse the web" → "Use web search".
 */
const browsingRule: TranslationRule = {
  name: "browsing_to_web_search",
  apply(text) {
    let result = text;
    let changed = false;

    result = result.replace(/\b[Bb]rowse\s+the\s+web\b/g, () => {
      changed = true;
      return "Use web search";
    });

    result = result.replace(/\b[Bb]rowse\s+the\s+internet\b/g, () => {
      changed = true;
      return "Use web search";
    });

    result = result.replace(/\b[Ww]eb\s+browsing\b/g, () => {
      changed = true;
      return "web search";
    });

    return changed ? result : null;
  },
};

/**
 * Rule 6: Canvas → Artifacts.
 */
const canvasRule: TranslationRule = {
  name: "canvas_to_artifacts",
  apply(text) {
    let result = text;
    let changed = false;

    result = result.replace(/\b[Uu]se\s+[Cc]anvas\b/g, () => {
      changed = true;
      return "Use Artifacts";
    });

    result = result.replace(/\b[Cc]anvas\s+mode\b/g, () => {
      changed = true;
      return "Artifacts";
    });

    result = result.replace(/\bin\s+[Cc]anvas\b/g, () => {
      changed = true;
      return "in Artifacts";
    });

    return changed ? result : null;
  },
};

/**
 * Rule 7: Wrap structured sections in XML tags.
 * Detects sections like "## Guidelines:" or "Rules:" and wraps them.
 */
const xmlTagsRule: TranslationRule = {
  name: "wrap_xml_tags",
  apply(text) {
    // Only apply if text has clear sections (headings or labeled blocks)
    const hasSections =
      /^#{1,3}\s+\w+/m.test(text) ||
      /^[A-Z][a-zA-Z\s]+:\s*\n/m.test(text);
    if (!hasSections) return null;

    let result = text;

    // Wrap markdown heading sections: "## Rules\n..." → "<rules>\n...\n</rules>"
    result = result.replace(
      /^(#{1,3})\s+([A-Za-z\s]+?)\s*\n([\s\S]*?)(?=^#{1,3}\s|\z)/gm,
      (_match, _hashes: string, title: string, body: string) => {
        const tag = title.trim().toLowerCase().replace(/\s+/g, "-");
        return `<${tag}>\n${body.trimEnd()}\n</${tag}>\n`;
      },
    );

    return result !== text ? result : null;
  },
};

/**
 * Rule 8: Add Artifacts hint for code-heavy workspaces.
 */
const artifactsHintRule: TranslationRule = {
  name: "add_artifacts_hint",
  apply(text) {
    const codeIndicators = [
      /\bcode\b/i,
      /\bprogram/i,
      /\bfunction/i,
      /\bscript/i,
      /\bsnippet/i,
      /\bimplementation/i,
    ];
    const codeCount = codeIndicators.filter((p) => p.test(text)).length;

    // Only add hint if text is code-heavy (3+ code indicators)
    if (codeCount < 3) return null;

    const hint =
      "\n\nWhen producing code, use Artifacts to present complete, runnable code blocks.";

    // Don't add if already mentioned
    if (text.includes("Artifacts")) return null;

    return text + hint;
  },
};

// ─── Rule Registry ───────────────────────────────────────────

const ALL_RULES: TranslationRule[] = [
  rolePlayRule,
  softenDirectivesRule,
  codeInterpreterRule,
  dalleRule,
  browsingRule,
  canvasRule,
  xmlTagsRule,
  artifactsHintRule,
];

// ─── Public API ──────────────────────────────────────────────

export function translateForClaude(instructions: string): TranslationResult {
  if (!instructions.trim()) {
    return { translated: "", rulesApplied: [] };
  }

  let current = instructions;
  const rulesApplied: string[] = [];

  for (const rule of ALL_RULES) {
    const result = rule.apply(current);
    if (result !== null) {
      current = result;
      rulesApplied.push(rule.name);
    }
  }

  return { translated: current, rulesApplied };
}

/**
 * Generate warnings for capabilities that don't translate cleanly to Claude.
 */
export function generateCapabilityWarnings(
  capabilities: DetectedCapabilities,
): string[] {
  const warnings: string[] = [];

  if (capabilities.usesDallE) {
    warnings.push("Image generation (DALL-E) is not available on Claude");
  }
  if (capabilities.usesApiActions) {
    warnings.push(
      "API Actions are not available on Claude — consider MCP integrations",
    );
  }
  if (capabilities.usesCanvas) {
    warnings.push(
      "Canvas has been mapped to Artifacts — behavior may differ",
    );
  }

  return warnings;
}
