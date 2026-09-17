// ─── Gemini Manifest Generator ──────────────────────────────
// Converts extracted Gemini Gems into a PortsmithManifest.

import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  ExtractedGem,
  ExtractionWarning,
} from "@/core/adapters/gemini-dom-types";
import { MANIFEST_VERSION, GENERATED_BY } from "@/shared/constants";
import { categorize } from "./categorize";

// ─── Workspace Builder ──────────────────────────────────────

function buildWorkspaceFromGem(gem: ExtractedGem): Workspace {
  const now = new Date().toISOString();

  return {
    id: `ws-gem-${gem.id}`,
    sourceId: gem.id,
    name: gem.name,
    description: gem.description,
    instructions: { raw: gem.instructions },
    knowledgeFiles: [],
    category: categorize(gem.name, gem.instructions),
    tags: ["gemini-gem"],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: now,
    sampleTopics: [],
    migration: {
      confidence: 0.95,
      warnings: [],
      manualStepsRequired: [],
    },
  };
}

// ─── Public API ─────────────────────────────────────────────

export function generateGeminiManifest(
  gems: ExtractedGem[],
  extractionWarnings: ExtractionWarning[] = [],
): PortsmithManifest {
  const now = new Date().toISOString();

  const workspaces = gems
    .filter((g) => !g.predefined)
    .map(buildWorkspaceFromGem);

  return {
    version: MANIFEST_VERSION,
    exportedAt: now,
    source: {
      platform: "gemini",
      exportMethod: "api",
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
    memory: [],
    globalInstructions: "",
    metadata: {
      generatedBy: GENERATED_BY,
      ...(extractionWarnings.length > 0
        ? { extractionWarnings: extractionWarnings.map((w) => w.message) }
        : {}),
    },
  };
}
