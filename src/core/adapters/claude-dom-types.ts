// ─── DOM Extraction Result Types ─────────────────────────────
// Types for data extracted from the Claude Projects API.
// Follows the same pattern as gemini-dom-types.ts.

export interface ExtractedClaudeProject {
  /** Project UUID from Claude */
  id: string;
  name: string;
  description: string;
  /** System instructions (prompt_template) */
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeExtractionResult {
  success: boolean;
  projects: ExtractedClaudeProject[];
  warnings: Array<{ context: string; message: string }>;
}
