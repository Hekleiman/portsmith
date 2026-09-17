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

/** File metadata from the ChatGPT gizmo API response. */
export interface ExtractedFileMetadata {
  name: string;
  type?: string;
  size?: number;
  /** ChatGPT file ID (e.g. "file-2xKZ..."), needed for blob download. */
  id?: string;
  /** Reference to stored blob in IndexedDB (set after successful download). */
  contentRef?: string;
}

/** A ChatGPT Project — maps directly to a Claude Project. */
export interface ExtractedChatGPTProject {
  /** Project ID extracted from URL (e.g. the UUID from /project/<id>) */
  id: string;
  name: string;
  description: string;
  instructions: string;
  knowledgeFileNames: string[];
  /** Rich file metadata from API (when available). */
  knowledgeFileMetadata?: ExtractedFileMetadata[];
  conversationCount: number;
  /** True when only the name could be read (settings and files are missing). */
  incomplete?: boolean;
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
