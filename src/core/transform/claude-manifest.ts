// ─── Claude Manifest Generator ──────────────────────────────
// Converts extracted Claude Projects into a PortsmithManifest.
// Follows the same pattern as gemini-manifest.ts.

import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type { ExtractedClaudeProject } from "@/core/adapters/claude-dom-types";

// ─── Category Detection (shared logic) ──────────────────────

const CATEGORY_PATTERNS: Array<{ category: Workspace["category"]; re: RegExp }> = [
  { category: "coding", re: /\b(code|program|debug|develop|software|api|typescript|python|javascript)\b/i },
  { category: "writing", re: /\b(writ|blog|article|essay|copy|edit|proofread|draft)\b/i },
  { category: "research", re: /\b(research|analyz|investigat|study|explor|paper)\b/i },
  { category: "data_analysis", re: /\b(data|statistic|chart|csv|excel|dashboard)\b/i },
  { category: "creative", re: /\b(creat|design|art|story|fiction|brainstorm)\b/i },
  { category: "business", re: /\b(business|strateg|marketing|sales|finance)\b/i },
  { category: "education", re: /\b(teach|tutor|learn|explain|lesson|student)\b/i },
  { category: "personal", re: /\b(personal|life|health|fitness|recipe|travel)\b/i },
  { category: "customer_support", re: /\b(support|customer|help\s*desk|ticket|faq)\b/i },
];

function categorize(name: string, instructions: string): Workspace["category"] {
  const text = `${name} ${instructions}`;
  for (const { category, re } of CATEGORY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return "other";
}

// ─── Workspace Builder ──────────────────────────────────────

function buildWorkspaceFromProject(project: ExtractedClaudeProject): Workspace {
  const now = new Date().toISOString();

  return {
    id: `ws-claude-${project.id}`,
    sourceId: project.id,
    name: project.name,
    description: project.description,
    instructions: { raw: project.instructions },
    knowledgeFiles: [],
    category: categorize(project.name, project.instructions),
    tags: ["claude-project"],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: project.updatedAt || now,
    sampleTopics: [],
    migration: {
      confidence: 0.95,
      warnings: [],
      manualStepsRequired: [],
    },
  };
}

// ─── Public API ─────────────────────────────────────────────

export function generateClaudeManifest(
  projects: ExtractedClaudeProject[],
): PortsmithManifest {
  const now = new Date().toISOString();

  const workspaces = projects.map(buildWorkspaceFromProject);

  return {
    version: "0.1.0",
    exportedAt: now,
    source: {
      platform: "claude",
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
      generatedBy: "portsmith/0.1.0",
    },
  };
}
