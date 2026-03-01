// ─── DOM Extraction Result Types ─────────────────────────────
// Types for data extracted from the live ChatGPT DOM.
// Separate from export ZIP types — these require a logged-in session.

export interface ExtractedCustomGPT {
  /** gizmo_id if detectable from URL/DOM, otherwise a generated id */
  id: string;
  name: string;
  description: string;
  instructions: string;
  conversationStarters: string[];
  knowledgeFileNames: string[];
}

/** A ChatGPT Project — maps directly to a Claude Project. */
export interface ExtractedChatGPTProject {
  /** Project ID extracted from URL (e.g. the UUID from /project/<id>) */
  id: string;
  name: string;
  description: string;
  instructions: string;
  knowledgeFileNames: string[];
  conversationCount: number;
}

export interface ExtractedMemoryItem {
  content: string;
}

export interface ExtractedCustomInstructions {
  aboutUser: string;
  responsePreferences: string;
}

// ─── Extraction Results ──────────────────────────────────────

export interface ExtractionWarning {
  context: string;
  message: string;
}

export interface CustomGPTExtractionResult {
  success: boolean;
  gpts: ExtractedCustomGPT[];
  warnings: ExtractionWarning[];
}

export interface ProjectExtractionResult {
  success: boolean;
  projects: ExtractedChatGPTProject[];
  warnings: ExtractionWarning[];
}

export interface MemoryExtractionResult {
  success: boolean;
  items: ExtractedMemoryItem[];
  warnings: ExtractionWarning[];
}

export interface CustomInstructionsExtractionResult {
  success: boolean;
  instructions: ExtractedCustomInstructions | null;
  warnings: ExtractionWarning[];
}

export type DOMExtractionResult =
  | {
      type: "custom_gpts";
      data: CustomGPTExtractionResult;
    }
  | {
      type: "projects";
      data: ProjectExtractionResult;
    }
  | {
      type: "memory";
      data: MemoryExtractionResult;
    }
  | {
      type: "custom_instructions";
      data: CustomInstructionsExtractionResult;
    };
