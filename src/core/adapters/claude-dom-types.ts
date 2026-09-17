// ─── Claude Extraction Types ─────────────────────────────────
// Types for data extracted from Claude's internal API.
// Follows the same pattern as gemini-dom-types.ts.

/** One project-scoped memory file (or the legacy memory summary). */
export interface ExtractedClaudeMemoryEntry {
  /** Memory path, e.g. "/projects/<uuid>/decisions.md" */
  path: string;
  title: string;
  summary: string;
  body: string;
  updatedAt: string;
}

/** A text document from the project's knowledge base. */
export interface ExtractedClaudeDoc {
  uuid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** IndexedDB reference once the content has been stored. */
  contentRef?: string;
}

/** A binary file in the project (listed, but its content is not copied). */
export interface ExtractedClaudeFileRef {
  uuid: string;
  fileName: string;
  kind: string;
}

export interface ExtractedClaudeProject {
  /** Project UUID from Claude */
  id: string;
  name: string;
  description: string;
  /** System instructions (prompt_template) */
  instructions: string;
  createdAt: string;
  updatedAt: string;
  /** Project memory, when requested and available */
  memory?: ExtractedClaudeMemoryEntry[];
  /** "entries" = current memory files, "summary" = legacy summary text */
  memorySource?: "entries" | "summary";
  docs?: ExtractedClaudeDoc[];
  files?: ExtractedClaudeFileRef[];
}

export interface ClaudeExtractionOptions {
  includeMemory: boolean;
  includeKnowledge: boolean;
}

export interface ClaudeExtractionResult {
  success: boolean;
  projects: ExtractedClaudeProject[];
  warnings: Array<{ context: string; message: string }>;
}
