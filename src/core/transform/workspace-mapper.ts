// ─── Workspace Mapper ────────────────────────────────────────
// Converts raw ChatGPT data (ZIP parse + DOM extraction) into
// a complete PortsmithManifest.

import type {
  PortsmithManifest,
  Workspace,
  WorkspaceCapability,
  KnowledgeFile,
} from "@/core/schema/types";
import type {
  RawChatGPTData,
  ParsedConversation,
} from "@/core/adapters/types";
import type {
  ExtractedCustomGPT,
  ExtractedCustomInstructions,
  ExtractedMemoryItem,
} from "@/core/adapters/chatgpt-dom-types";
import {
  translateForClaude,
  detectCapabilities,
  generateCapabilityWarnings,
} from "./prompt-translator";
import { mapMemoryItems } from "./memory-mapper";

// ─── DOM Data Input Type ─────────────────────────────────────

export interface ChatGPTDOMData {
  customGPTs?: ExtractedCustomGPT[];
  memory?: ExtractedMemoryItem[];
  customInstructions?: ExtractedCustomInstructions | null;
}

// ─── Category Detection ──────────────────────────────────────

type WorkspaceCategory = Workspace["category"];

interface CategoryKeywords {
  category: WorkspaceCategory;
  keywords: RegExp[];
}

const CATEGORY_KEYWORDS: CategoryKeywords[] = [
  {
    category: "coding",
    keywords: [
      /\bcode\b/i,
      /\bprogram/i,
      /\bdebug/i,
      /\breview/i,
      /\brefactor/i,
      /\bcompile/i,
      /\bscript/i,
      /\bdevelop/i,
      /\bsoftware/i,
      /\bengine/i,
      /\bapi\b/i,
      /\btypeScript\b/i,
      /\bpython\b/i,
      /\bjavascript\b/i,
      /\breact\b/i,
    ],
  },
  {
    category: "writing",
    keywords: [
      /\bwrit/i,
      /\bblog/i,
      /\barticle/i,
      /\bessay/i,
      /\bcopy/i,
      /\bedit/i,
      /\bproofread/i,
      /\bdraft/i,
      /\bcontent\s+creat/i,
    ],
  },
  {
    category: "research",
    keywords: [
      /\bresearch/i,
      /\banalyz/i,
      /\binvestigat/i,
      /\bstudy/i,
      /\bexplor/i,
      /\bliterature/i,
      /\bpaper/i,
      /\bsurvey/i,
    ],
  },
  {
    category: "data_analysis",
    keywords: [
      /\bdata\b/i,
      /\bstatistic/i,
      /\bchart/i,
      /\bgraph/i,
      /\bvisuali/i,
      /\bcsv\b/i,
      /\bexcel/i,
      /\bspreadsheet/i,
      /\bdashboard/i,
    ],
  },
  {
    category: "creative",
    keywords: [
      /\bcreat/i,
      /\bdesign/i,
      /\bart\b/i,
      /\bstory/i,
      /\bfiction/i,
      /\bpoem/i,
      /\bmusic/i,
      /\bbrainstorm/i,
      /\bideate/i,
    ],
  },
  {
    category: "business",
    keywords: [
      /\bbusiness/i,
      /\bstrateg/i,
      /\bmarketing/i,
      /\bsales/i,
      /\bpresent/i,
      /\bproposal/i,
      /\breport/i,
      /\bfinance/i,
    ],
  },
  {
    category: "education",
    keywords: [
      /\bteach/i,
      /\btutor/i,
      /\blearn/i,
      /\bexplain/i,
      /\blesson/i,
      /\bcourse/i,
      /\bstudent/i,
      /\bquiz/i,
    ],
  },
  {
    category: "personal",
    keywords: [
      /\bpersonal/i,
      /\blife/i,
      /\bhealth/i,
      /\bfitness/i,
      /\brecipe/i,
      /\btravel/i,
      /\bjournal/i,
      /\bhabit/i,
    ],
  },
  {
    category: "customer_support",
    keywords: [
      /\bsupport/i,
      /\bcustomer/i,
      /\bhelp\s*desk/i,
      /\bticket/i,
      /\bfaq/i,
      /\btroubleshoot/i,
    ],
  },
];

function categorizeWorkspace(
  name: string,
  instructions: string,
  topics: string[],
): WorkspaceCategory {
  const combined = `${name} ${instructions} ${topics.join(" ")}`;
  let bestCategory: WorkspaceCategory = "other";
  let bestScore = 0;

  for (const ck of CATEGORY_KEYWORDS) {
    const score = ck.keywords.filter((kw) => kw.test(combined)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = ck.category;
    }
  }

  return bestCategory;
}

// ─── Confidence Scoring ──────────────────────────────────────

function calculateConfidence(
  instructions: string,
  knowledgeFiles: KnowledgeFile[],
  capabilities: WorkspaceCapability[],
): number {
  let score = 1.0;

  // Penalty for instruction complexity (very long → harder to migrate well)
  if (instructions.length > 2000) score -= 0.05;
  if (instructions.length > 5000) score -= 0.1;

  // Penalty for unsupported features
  const unsupported = capabilities.filter((c) => !c.available);
  score -= unsupported.length * 0.08;

  // Penalty for required unsupported features
  const requiredUnsupported = unsupported.filter((c) => c.required);
  score -= requiredUnsupported.length * 0.1;

  // Penalty for knowledge files (need manual upload)
  if (knowledgeFiles.length > 0) score -= 0.03;
  if (knowledgeFiles.length > 5) score -= 0.05;

  // Bonus for simple, text-only workspaces
  if (
    instructions.length < 500 &&
    knowledgeFiles.length === 0 &&
    capabilities.length === 0
  ) {
    score += 0.05;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// ─── Capability Mapping ─────────────────────────────────────

function mapCapabilities(instructions: string): WorkspaceCapability[] {
  const detected = detectCapabilities(instructions);
  const capabilities: WorkspaceCapability[] = [];

  if (detected.usesCodeInterpreter) {
    capabilities.push({
      type: "code_execution",
      required: false,
      equivalent: "artifacts",
      available: true,
    });
  }

  if (detected.usesDallE) {
    capabilities.push({
      type: "image_generation",
      required: false,
      platformSpecific: "DALL-E integration",
      available: false,
    });
  }

  if (detected.usesBrowsing) {
    capabilities.push({
      type: "web_browsing",
      required: false,
      equivalent: "web_search",
      available: true,
    });
  }

  if (detected.usesCanvas) {
    capabilities.push({
      type: "canvas",
      required: false,
      equivalent: "artifacts",
      available: true,
    });
  }

  if (detected.usesApiActions) {
    capabilities.push({
      type: "api_actions",
      required: false,
      available: false,
    });
  }

  return capabilities;
}

// ─── Knowledge File Mapping ─────────────────────────────────

function mapKnowledgeFileNames(fileNames: string[]): KnowledgeFile[] {
  return fileNames.map((name, i) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
    const compatible = COMPATIBLE_EXTENSIONS.has(ext);

    return {
      id: `kf-${String(i + 1).padStart(3, "0")}`,
      originalName: name,
      mimeType,
      sizeBytes: 0, // Unknown from DOM extraction
      source: "referenced" as const,
      compatible,
      ...(compatible ? {} : { conversionNeeded: `Convert .${ext} to supported format` }),
    };
  });
}

const MIME_MAP: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/typescript",
  html: "text/html",
  xml: "text/xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const COMPATIBLE_EXTENSIONS = new Set([
  "txt",
  "md",
  "pdf",
  "csv",
  "json",
  "py",
  "js",
  "ts",
  "html",
  "xml",
  "docx",
]);

// ─── Topic Extraction ────────────────────────────────────────

function extractTopicsFromConversations(
  conversations: ParsedConversation[],
): string[] {
  const titles = conversations.map((c) => c.title).filter(Boolean);
  // Use titles as topic proxies — deduplicate and take top 5
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const title of titles) {
    if (!seen.has(title) && topics.length < 5) {
      seen.add(title);
      topics.push(title);
    }
  }
  return topics;
}

// ─── Timestamp Helpers ───────────────────────────────────────

function unixToISO(unix: number): string {
  if (unix <= 0) return new Date().toISOString();
  return new Date(unix * 1000).toISOString();
}

// ─── Workspace Building ─────────────────────────────────────

function buildWorkspaceFromGPT(
  gpt: ExtractedCustomGPT,
  conversations: ParsedConversation[],
): Workspace {
  const relatedConvs = conversations.filter((c) => c.gizmoId === gpt.id);
  const topics = extractTopicsFromConversations(relatedConvs);
  const translation = translateForClaude(gpt.instructions);
  const capabilities = mapCapabilities(gpt.instructions);
  const knowledgeFiles = mapKnowledgeFileNames(gpt.knowledgeFileNames);
  const category = categorizeWorkspace(gpt.name, gpt.instructions, topics);

  const capWarnings = generateCapabilityWarnings(
    detectCapabilities(gpt.instructions),
  );

  const manualSteps: string[] = [];
  if (knowledgeFiles.length > 0) {
    manualSteps.push(
      `Upload ${knowledgeFiles.length} knowledge file(s) to project`,
    );
  }
  if (gpt.conversationStarters.length > 0) {
    manualSteps.push("Set up conversation starters in Claude project");
  }

  const lastActive =
    relatedConvs.length > 0
      ? Math.max(...relatedConvs.map((c) => c.updateTime))
      : Date.now() / 1000;

  return {
    id: `ws-${gpt.id}`,
    sourceId: gpt.id,
    name: gpt.name,
    description: gpt.description,
    instructions: {
      raw: gpt.instructions,
      ...(translation.rulesApplied.length > 0
        ? { translated: { claude: translation.translated } }
        : {}),
    },
    knowledgeFiles,
    category,
    tags: [],
    behavior: {
      ...(gpt.conversationStarters.length > 0
        ? { triggerPhrases: gpt.conversationStarters }
        : {}),
    },
    capabilities,
    conversationCount: relatedConvs.length,
    lastActiveAt: unixToISO(lastActive),
    sampleTopics: topics,
    migration: {
      confidence: calculateConfidence(
        gpt.instructions,
        knowledgeFiles,
        capabilities,
      ),
      warnings: capWarnings,
      manualStepsRequired: manualSteps,
    },
  };
}

// ─── Global Instructions ─────────────────────────────────────

function buildGlobalInstructions(
  customInstructions: ExtractedCustomInstructions | null | undefined,
): string {
  if (!customInstructions) return "";

  const parts: string[] = [];

  if (customInstructions.aboutUser) {
    parts.push(customInstructions.aboutUser);
  }

  if (customInstructions.responsePreferences) {
    parts.push(customInstructions.responsePreferences);
  }

  if (parts.length === 0) return "";

  const raw = parts.join("\n\n");
  const { translated, rulesApplied } = translateForClaude(raw);
  return rulesApplied.length > 0 ? translated : raw;
}

// ─── Public API ──────────────────────────────────────────────

export function generateManifest(
  rawChatGPT: RawChatGPTData,
  domData?: ChatGPTDOMData,
): PortsmithManifest {
  const now = new Date().toISOString();

  // Build workspaces from DOM-extracted GPT configs
  const workspaces: Workspace[] = [];
  if (domData?.customGPTs) {
    for (const gpt of domData.customGPTs) {
      workspaces.push(
        buildWorkspaceFromGPT(gpt, rawChatGPT.conversations),
      );
    }
  }

  // Map memory items
  const rawMemoryStrings = (domData?.memory ?? []).map((m) => m.content);
  const memory = mapMemoryItems(rawMemoryStrings);

  // Build global instructions from custom instructions
  const globalInstructions = buildGlobalInstructions(
    domData?.customInstructions,
  );

  // Determine export method
  const hasDOM = domData && (domData.customGPTs || domData.memory || domData.customInstructions);
  const exportMethod = hasDOM ? "dom_extraction" : "official_export";

  return {
    version: "0.1.0",
    exportedAt: now,
    source: {
      platform: "chatgpt",
      exportMethod: exportMethod as "dom_extraction" | "official_export",
      exportedAt: now,
    },
    user: {
      expertise: [],
      communicationStyle: {
        formality: "casual",
        verbosity: "concise",
        preferences: [],
      },
      interests: [],
    },
    workspaces,
    memory,
    globalInstructions,
    metadata: {
      generatedBy: "portsmith/0.1.0",
    },
  };
}

// Re-exports for convenience
export { translateForClaude } from "./prompt-translator";
export { mapMemoryItems } from "./memory-mapper";
