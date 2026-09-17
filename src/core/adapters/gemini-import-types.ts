// ─── Gemini Import Result Types ──────────────────────────────
// Types for creating / updating / deleting Gems via batchexecute.

/** Config payload for creating or updating a Gem. */
export interface GemConfig {
  name: string;
  description: string;
  instructions: string;
}

/** Result of a Gem create / update / delete operation. */
export interface GemImportResult {
  success: boolean;
  /** ID of the created or updated Gem (absent on delete or failure). */
  gemId?: string;
  /** Human-readable error message on failure. */
  error?: string;
  /** Gemini answered, but PortSmith couldn't tell whether the Gem exists. */
  maybeCreated?: boolean;
  /** Manual fallback when the API call fails. */
  fallback?: GemImportFallback;
}

/** Step-by-step manual instructions shown when automated import fails. */
export interface GemImportFallback {
  /** Ordered list of manual steps the user should follow. */
  steps: string[];
  /** The config data so the user can copy / paste values. */
  configData: GemConfig;
}
