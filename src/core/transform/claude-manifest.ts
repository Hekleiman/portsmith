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
  ExtractedClaudeMemoryEntry,
  ExtractedClaudeProject,
} from "@/core/adapters/claude-dom-types";
import { MANIFEST_VERSION, GENERATED_BY } from "@/shared/constants";
import { getMimeType } from "./file-compatibility";
import { categorize } from "./categorize";
import { mapMemoryItems } from "./memory-mapper";

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

// ─── Global memory ──────────────────────────────────────────

const HEADING_LINE = /^\s*#{1,6}(?:\s|$)/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** Claude's own labels at the start of a line, such as "[stated]". */
const INTERNAL_TAG = /^\[[a-z_ -]+\]\s*/i;
/** Notes about one person or area: each line needs the note's name. */
const NAMED_NOTE_PATH = /^\/(?:people|areas)\//i;

/**
 * One memory fact per line of a note. Headings are dropped, list markers
 * and internal tags removed, and lines of people and area notes get the
 * note's title in front so they still make sense on their own.
 */
export function memoryNoteToFacts(note: ExtractedClaudeMemoryEntry): string[] {
  const prefix =
    NAMED_NOTE_PATH.test(note.path) && note.title.trim()
      ? `${note.title.trim()}: `
      : "";
  const facts: string[] = [];
  for (const raw of (note.body || note.summary).split("\n")) {
    if (HEADING_LINE.test(raw)) continue;
    let line = raw.replace(LIST_MARKER, "").trim();
    while (INTERNAL_TAG.test(line)) line = line.replace(INTERNAL_TAG, "");
    line = line.trim();
    if (line) facts.push(prefix + line);
  }
  return facts;
}

// ─── Public API ─────────────────────────────────────────────

export interface ClaudeGlobalData {
  /** Memory notes outside projects (never project memory) */
  memory?: ExtractedClaudeMemoryEntry[];
  /** "Instructions for Claude" */
  preferences?: string;
}

export function generateClaudeManifest(
  projects: ExtractedClaudeProject[],
  extractionWarnings: ClaudeExtractionResult["warnings"] = [],
  global: ClaudeGlobalData = {},
): PortsmithManifest {
  const now = new Date().toISOString();
  const memory = mapMemoryItems((global.memory ?? []).flatMap(memoryNoteToFacts));

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
    memory,
    globalInstructions: global.preferences?.trim() ?? "",
    metadata: {
      generatedBy: GENERATED_BY,
      ...(extractionWarnings.length > 0
        ? { extractionWarnings: extractionWarnings.map((w) => w.message) }
        : {}),
    },
  };
}
