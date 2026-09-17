// ─── DOM Extraction Result Types ─────────────────────────────
// Types for data extracted from the Gemini batchexecute API.
// Follows the same pattern as chatgpt-dom-types.ts.

export interface ExtractionWarning {
  context: string;
  message: string;
}

/** A Gemini Gem — maps to a PortSmith Workspace. */
export interface ExtractedGem {
  /** Gem ID from Gemini (e.g. a long string identifier) */
  id: string;
  name: string;
  description: string;
  /** System instructions / prompt for the gem */
  instructions: string;
  /** Whether this is a Google-predefined gem vs user-created */
  predefined: boolean;
}

export interface GemExtractionResult {
  success: boolean;
  gems: ExtractedGem[];
  warnings: ExtractionWarning[];
}
