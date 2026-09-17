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
  ExtractedChatGPTProject,
  ExtractedFileMetadata,
  ExtractedCustomInstructions,
  ExtractedMemoryItem,
} from "@/core/adapters/chatgpt-dom-types";
import {
  translateForClaude,
  detectCapabilities,
  generateCapabilityWarnings,
} from "./prompt-translator";
import { mapMemoryItems } from "./memory-mapper";
import { MANIFEST_VERSION, GENERATED_BY } from "@/shared/constants";
import { normalizeGizmoId, sameGizmo } from "@/shared/chatgpt-ids";
import {
  isClaudeCompatible,
  getConversionSuggestion,
  getMimeType,
} from "./file-compatibility";

// ─── DOM Data Input Type ─────────────────────────────────────

export interface ChatGPTDOMData {
  customGPTs?: ExtractedCustomGPT[];
  projects?: ExtractedChatGPTProject[];
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

function mapKnowledgeFiles(
  fileNames: string[],
  metadata?: ExtractedFileMetadata[],
): KnowledgeFile[] {
  return fileNames.map((name, i) => {
    const meta = metadata?.[i];
    const compatible = isClaudeCompatible(name);
    const hasBlob = !!meta?.contentRef;

    return {
      id: `kf-${String(i + 1).padStart(3, "0")}`,
      originalName: name,
      mimeType: meta?.type ?? getMimeType(name),
      sizeBytes: meta?.size ?? 0,
      source: hasBlob ? ("exported" as const) : ("referenced" as const),
      compatible,
      ...(meta?.contentRef ? { contentRef: meta.contentRef } : {}),
      ...(compatible ? {} : { conversionNeeded: getConversionSuggestion(name) ?? `Convert .${name.split(".").pop()?.toLowerCase() ?? ""} to supported format` }),
    };
  });
}

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
  if (!Number.isFinite(unix) || unix <= 0) return new Date().toISOString();
  const date = new Date(unix * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// ─── Workspace Building ─────────────────────────────────────

function buildWorkspaceFromGPT(
  gpt: ExtractedCustomGPT,
  conversations: ParsedConversation[],
): Workspace {
  const relatedConvs = conversations.filter((c) => sameGizmo(c.gizmoId, gpt.id));
  const topics = extractTopicsFromConversations(relatedConvs);
  const translation = translateForClaude(gpt.instructions);
  const capabilities = mapCapabilities(gpt.instructions);
  const knowledgeFiles = mapKnowledgeFiles(gpt.knowledgeFileNames);
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

  const gptId = normalizeGizmoId(gpt.id) ?? gpt.id;

  return {
    id: `ws-${gptId}`,
    sourceId: gptId,
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

// ─── Workspace from ChatGPT Project ─────────────────────────

function buildWorkspaceFromProject(
  project: ExtractedChatGPTProject,
  conversations: ParsedConversation[] = [],
): Workspace {
  const projectId = normalizeGizmoId(project.id) ?? project.id;
  const relatedConvs = conversations.filter((c) => sameGizmo(c.gizmoId, projectId));
  const topics = extractTopicsFromConversations(relatedConvs);
  const translation = translateForClaude(project.instructions);
  const capabilities = mapCapabilities(project.instructions);
  const knowledgeFiles = mapKnowledgeFiles(
    project.knowledgeFileNames,
    project.knowledgeFileMetadata,
  );
  const category = categorizeWorkspace(project.name, project.instructions, topics);

  const capWarnings = generateCapabilityWarnings(
    detectCapabilities(project.instructions),
  );

  const manualSteps: string[] = [];
  if (project.incomplete) {
    capWarnings.unshift(
      "PortSmith couldn't read this project's instructions or files. Open the project in ChatGPT and copy them in the editor, or read your data again.",
    );
    manualSteps.push("Copy the project's instructions and files by hand");
  }
  if (knowledgeFiles.length > 0) {
    manualSteps.push(
      `Upload ${knowledgeFiles.length} knowledge file(s) to project`,
    );
  }

  // Projects map directly to Claude Projects — higher base confidence
  const baseConfidence = calculateConfidence(
    project.instructions,
    knowledgeFiles,
    capabilities,
  );
  // Boost confidence by 0.05 (capped at 1) because project→project is a direct mapping
  const confidence = project.incomplete
    ? 0.3
    : Math.min(1, Math.round((baseConfidence + 0.05) * 100) / 100);

  const lastActive =
    relatedConvs.length > 0
      ? Math.max(...relatedConvs.map((c) => c.updateTime))
      : 0;

  return {
    id: `ws-proj-${projectId}`,
    sourceId: projectId,
    name: project.name,
    description: project.description,
    instructions: {
      raw: project.instructions,
      ...(translation.rulesApplied.length > 0
        ? { translated: { claude: translation.translated } }
        : {}),
    },
    knowledgeFiles,
    category,
    tags: ["chatgpt-project"],
    behavior: {},
    capabilities,
    conversationCount: Math.max(project.conversationCount, relatedConvs.length),
    lastActiveAt: unixToISO(lastActive),
    sampleTopics: topics,
    migration: {
      confidence,
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

  // Keep the user's own words (these go into memory imports and settings
  // fields, not project instructions) and keep the two fields apart.
  const parts: string[] = [];
  const about = customInstructions.aboutUser.trim();
  const prefs = customInstructions.responsePreferences.trim();
  if (about) parts.push(`About me:\n${about}`);
  if (prefs) parts.push(`How I'd like responses:\n${prefs}`);
  return parts.join("\n\n");
}

// ─── Public API ──────────────────────────────────────────────

export function generateManifest(
  rawChatGPT: RawChatGPTData,
  domData?: ChatGPTDOMData,
): PortsmithManifest {
  const now = new Date().toISOString();

  // Build workspaces from DOM-extracted GPT configs and Projects
  const workspaces: Workspace[] = [];

  // Projects first — they map directly to Claude Projects
  if (domData?.projects) {
    const seen = new Set<string>();
    for (const project of domData.projects) {
      const ws = buildWorkspaceFromProject(project, rawChatGPT.conversations);
      if (seen.has(ws.id)) continue;
      seen.add(ws.id);
      workspaces.push(ws);
    }
  }

  if (domData?.customGPTs) {
    const seen = new Set(workspaces.map((w) => w.id));
    for (const gpt of domData.customGPTs) {
      const ws = buildWorkspaceFromGPT(gpt, rawChatGPT.conversations);
      if (seen.has(ws.id)) continue;
      seen.add(ws.id);
      workspaces.push(ws);
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
  const hasDOM = domData && (domData.customGPTs || domData.projects || domData.memory || domData.customInstructions);
  const exportMethod = hasDOM ? "dom_extraction" : "official_export";

  return {
    version: MANIFEST_VERSION,
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
      generatedBy: GENERATED_BY,
    },
  };
}

// Re-exports for convenience
export { translateForClaude } from "./prompt-translator";
export { mapMemoryItems } from "./memory-mapper";
