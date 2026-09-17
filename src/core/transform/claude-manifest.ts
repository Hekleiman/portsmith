// ─── Claude Manifest Generator ──────────────────────────────
// Converts extracted Claude Projects into a PortsmithManifest.
// Follows the same pattern as gemini-manifest.ts.

import type {
  KnowledgeFile,
  PortsmithManifest,
  ProjectMemory,
  Workspace,
} from "@/core/schema/types";
import type {
  ClaudeExtractionResult,
  ExtractedClaudeProject,
} from "@/core/adapters/claude-dom-types";
import { MANIFEST_VERSION, GENERATED_BY } from "@/shared/constants";
import { getMimeType } from "./file-compatibility";
import { categorize } from "./categorize";

// ─── Knowledge ──────────────────────────────────────────────

function buildKnowledgeFiles(project: ExtractedClaudeProject): KnowledgeFile[] {
  const files: KnowledgeFile[] = [];

  for (const doc of project.docs ?? []) {
    const copied = !!doc.contentRef;
    files.push({
      id: `kf-doc-${doc.uuid}`,
      originalName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      source: copied ? "exported" : "referenced",
      ...(copied ? { contentRef: doc.contentRef } : {}),
      compatible: copied,
      ...(copied
        ? {}
        : { conversionNeeded: "Copy this document from the Claude project by hand" }),
    });
  }

  for (const file of project.files ?? []) {
    files.push({
      id: `kf-file-${file.uuid}`,
      originalName: file.fileName,
      mimeType: getMimeType(file.fileName),
      sizeBytes: 0,
      source: "referenced",
      compatible: false,
      conversionNeeded:
        "Download this file from the Claude project and upload it by hand",
    });
  }

  return files;
}

function buildProjectMemory(
  project: ExtractedClaudeProject,
  capturedAt: string,
): ProjectMemory | undefined {
  if (!project.memory || project.memory.length === 0) return undefined;
  return {
    source:
      project.memorySource === "summary"
        ? "claude_memory_summary"
        : "claude_memory",
    capturedAt,
    entries: project.memory.map((m, i) => ({
      id: `pm-${i + 1}`,
      title: m.title,
      ...(m.summary ? { summary: m.summary } : {}),
      content: m.body,
      ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
    })),
  };
}

// ─── Workspace Builder ──────────────────────────────────────

function toIsoOrNow(value: string, now: string): string {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : now;
}

export function buildWorkspaceFromProject(
  project: ExtractedClaudeProject,
  now: string = new Date().toISOString(),
): Workspace {
  const knowledgeFiles = buildKnowledgeFiles(project);
  const projectMemory = buildProjectMemory(project, now);

  const warnings: string[] = [];
  const manualSteps: string[] = [];
  const referenced = knowledgeFiles.filter((f) => !f.compatible);
  if (referenced.length > 0) {
    warnings.push(
      `${referenced.length} file(s) can't be copied automatically and need to be re-uploaded by hand`,
    );
    manualSteps.push(`Re-upload ${referenced.length} file(s) from the Claude project`);
  }
  if (!project.instructions.trim()) {
    warnings.push("This project has no instructions");
  }

  return {
    id: `ws-claude-${project.id}`,
    sourceId: project.id,
    name: project.name,
    description: project.description,
    instructions: { raw: project.instructions },
    knowledgeFiles,
    category: categorize(project.name, project.instructions),
    tags: ["claude-project"],
    behavior: {},
    capabilities: [],
    conversationCount: 0,
    lastActiveAt: toIsoOrNow(project.updatedAt, now),
    sampleTopics: [],
    migration: {
      confidence: referenced.length > 0 ? 0.85 : 0.95,
      warnings,
      manualStepsRequired: manualSteps,
    },
    ...(projectMemory ? { projectMemory } : {}),
  };
}

// ─── Public API ─────────────────────────────────────────────

export function generateClaudeManifest(
  projects: ExtractedClaudeProject[],
  extractionWarnings: ClaudeExtractionResult["warnings"] = [],
): PortsmithManifest {
  const now = new Date().toISOString();

  const workspaces = projects.map((p) => buildWorkspaceFromProject(p, now));

  return {
    version: MANIFEST_VERSION,
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
      generatedBy: GENERATED_BY,
      ...(extractionWarnings.length > 0
        ? { extractionWarnings: extractionWarnings.map((w) => w.message) }
        : {}),
    },
  };
}
