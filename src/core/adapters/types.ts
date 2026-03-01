// ─── ChatGPT Raw Export Types ────────────────────────────────
// Mirrors the structure of conversations.json from ChatGPT data exports.
// These are raw platform types — not our universal schema.

export interface ChatGPTRawAuthor {
  role: "user" | "assistant" | "system" | "tool";
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatGPTRawContent {
  content_type: string;
  parts?: unknown[];
}

export interface ChatGPTRawMessage {
  id: string;
  author: ChatGPTRawAuthor;
  create_time: number | null;
  update_time?: number | null;
  content: ChatGPTRawContent;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatGPTRawNode {
  id: string;
  message: ChatGPTRawMessage | null;
  parent: string | null;
  children: string[];
}

export interface ChatGPTRawConversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ChatGPTRawNode>;
  moderation_results?: unknown[];
  current_node?: string;
  conversation_id?: string;
  gizmo_id?: string | null;
  is_archived?: boolean;
}

// ─── Parsed Output Types ────────────────────────────────────

export type FlatMessageRole = "user" | "assistant" | "system" | "tool";

export interface FlatMessage {
  role: FlatMessageRole;
  content: string;
  timestamp: number;
}

export interface ParsedConversation {
  id: string;
  title: string;
  createTime: number;
  updateTime: number;
  messages: FlatMessage[];
  gizmoId?: string;
}

export interface ExportStats {
  totalConversations: number;
  dateRange: { earliest: number; latest: number } | null;
  topGPTs: Array<{ gizmoId: string; conversationCount: number }>;
}

export interface RawChatGPTData {
  conversations: ParsedConversation[];
  customGPTIds: string[];
  stats: ExportStats;
  warnings: string[];
}
