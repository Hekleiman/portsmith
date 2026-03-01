import { unzipSync } from "fflate";
import type {
  ChatGPTRawConversation,
  ChatGPTRawNode,
  FlatMessage,
  ParsedConversation,
  RawChatGPTData,
  ExportStats,
} from "./types";

// ─── Constants ───────────────────────────────────────────────

const CONVERSATIONS_FILENAME = "conversations.json";
const MAX_INLINE_PARSE_BYTES = 50 * 1024 * 1024; // 50MB

// ─── Content Extraction ──────────────────────────────────────

function extractTextFromParts(parts: unknown[] | undefined): string {
  if (!parts || parts.length === 0) return "";
  return parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .trim();
}

// ─── Tree Flattening ─────────────────────────────────────────

function findRootNodeId(mapping: Record<string, ChatGPTRawNode>): string | null {
  for (const [id, node] of Object.entries(mapping)) {
    if (node.parent === null) return id;
  }
  return null;
}

/**
 * Compute the depth of the subtree rooted at `nodeId` (for picking longest branch).
 */
function subtreeDepth(
  nodeId: string,
  mapping: Record<string, ChatGPTRawNode>,
  visited: Set<string>,
): number {
  if (visited.has(nodeId)) return 0;
  visited.add(nodeId);

  const node = mapping[nodeId];
  if (!node || node.children.length === 0) return 1;

  let maxChild = 0;
  for (const childId of node.children) {
    const d = subtreeDepth(childId, mapping, visited);
    if (d > maxChild) maxChild = d;
  }
  return 1 + maxChild;
}

/**
 * Walk the tree from root to a leaf, collecting messages.
 * When a node branches (multiple children), pick the branch leading to
 * `currentNode` if reachable, otherwise pick the longest branch.
 */
function flattenTree(
  mapping: Record<string, ChatGPTRawNode>,
  currentNode: string | undefined,
): FlatMessage[] {
  const rootId = findRootNodeId(mapping);
  if (!rootId) return [];

  // Pre-compute ancestry of currentNode for fast branch selection
  const ancestorSet = new Set<string>();
  if (currentNode) {
    let cursor = currentNode;
    while (cursor) {
      ancestorSet.add(cursor);
      const n = mapping[cursor];
      if (!n || !n.parent) break;
      cursor = n.parent;
    }
  }

  const messages: FlatMessage[] = [];
  const visited = new Set<string>();
  let nodeId: string | null = rootId;

  while (nodeId) {
    if (visited.has(nodeId)) break;
    visited.add(nodeId);

    const node: ChatGPTRawNode | undefined = mapping[nodeId];
    if (!node) break;

    // Extract message if present
    if (node.message) {
      const role = node.message.author?.role;
      if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
        const content = extractTextFromParts(node.message.content?.parts);
        if (content) {
          messages.push({
            role,
            content,
            timestamp: node.message.create_time ?? 0,
          });
        }
      }
    }

    // Pick next child
    if (node.children.length === 0) {
      nodeId = null;
    } else if (node.children.length === 1) {
      nodeId = node.children[0]!;
    } else {
      // Multiple children — branching point
      // Prefer the branch that leads to currentNode
      const onPath: string | undefined = node.children.find((id: string) => ancestorSet.has(id));
      if (onPath) {
        nodeId = onPath;
      } else {
        // Pick longest branch
        let bestChild: string = node.children[0]!;
        let bestDepth = 0;
        for (const childId of node.children) {
          const d = subtreeDepth(childId, mapping, new Set(visited));
          if (d > bestDepth) {
            bestDepth = d;
            bestChild = childId;
          }
        }
        nodeId = bestChild;
      }
    }
  }

  return messages;
}

// ─── Conversation Parsing ────────────────────────────────────

function parseConversation(
  raw: ChatGPTRawConversation,
  warnings: string[],
): ParsedConversation | null {
  if (!raw.mapping || typeof raw.mapping !== "object") {
    warnings.push(`Conversation "${raw.title ?? "untitled"}" has no mapping — skipped`);
    return null;
  }

  const messages = flattenTree(raw.mapping, raw.current_node);
  const id = raw.conversation_id ?? `conv-${raw.create_time}`;

  const conv: ParsedConversation = {
    id,
    title: raw.title ?? "Untitled",
    createTime: raw.create_time ?? 0,
    updateTime: raw.update_time ?? raw.create_time ?? 0,
    messages,
  };

  if (raw.gizmo_id) {
    conv.gizmoId = raw.gizmo_id;
  }

  return conv;
}

// ─── Stats Calculation ───────────────────────────────────────

function calculateStats(conversations: ParsedConversation[]): ExportStats {
  const gizmoCount = new Map<string, number>();
  let earliest = Infinity;
  let latest = -Infinity;

  for (const conv of conversations) {
    if (conv.createTime > 0 && conv.createTime < earliest) earliest = conv.createTime;
    if (conv.updateTime > 0 && conv.updateTime > latest) latest = conv.updateTime;
    if (conv.createTime > 0 && conv.createTime > latest) latest = conv.createTime;

    if (conv.gizmoId) {
      gizmoCount.set(conv.gizmoId, (gizmoCount.get(conv.gizmoId) ?? 0) + 1);
    }
  }

  const topGPTs = [...gizmoCount.entries()]
    .map(([gizmoId, conversationCount]) => ({ gizmoId, conversationCount }))
    .sort((a, b) => b.conversationCount - a.conversationCount);

  return {
    totalConversations: conversations.length,
    dateRange:
      earliest <= latest ? { earliest, latest } : null,
    topGPTs,
  };
}

// ─── JSON Parsing (chunked for large files) ──────────────────

function parseConversationsJSON(
  jsonBytes: Uint8Array,
  warnings: string[],
): ChatGPTRawConversation[] {
  const text = new TextDecoder().decode(jsonBytes);

  if (jsonBytes.byteLength > MAX_INLINE_PARSE_BYTES) {
    warnings.push(
      `conversations.json is ${Math.round(jsonBytes.byteLength / 1024 / 1024)}MB — parsing may be slow`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ChatGPTParseError("conversations.json contains invalid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new ChatGPTParseError(
      "conversations.json root is not an array",
    );
  }

  return parsed as ChatGPTRawConversation[];
}

// ─── Errors ──────────────────────────────────────────────────

export class ChatGPTParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTParseError";
  }
}

// ─── ZIP Extraction ──────────────────────────────────────────

function findConversationsInZip(zipData: Uint8Array): Uint8Array {
  const files = unzipSync(zipData);

  // Direct match
  if (files[CONVERSATIONS_FILENAME]) {
    return files[CONVERSATIONS_FILENAME];
  }

  // Search in subdirectories (some exports nest files)
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith(`/${CONVERSATIONS_FILENAME}`) || path === CONVERSATIONS_FILENAME) {
      return data;
    }
  }

  throw new ChatGPTParseError(
    `${CONVERSATIONS_FILENAME} not found in ZIP archive`,
  );
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Parse a ChatGPT data export ZIP file into structured data.
 * Returns partial results + warnings for malformed data rather than throwing.
 */
export async function parseChatGPTExport(file: File): Promise<RawChatGPTData> {
  const buffer = await file.arrayBuffer();
  const zipData = new Uint8Array(buffer);
  const warnings: string[] = [];

  const jsonBytes = findConversationsInZip(zipData);
  const rawConversations = parseConversationsJSON(jsonBytes, warnings);

  const conversations: ParsedConversation[] = [];
  for (const raw of rawConversations) {
    try {
      const conv = parseConversation(raw, warnings);
      if (conv) {
        conversations.push(conv);
      }
    } catch (err) {
      const title = raw?.title ?? "unknown";
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse conversation "${title}": ${msg}`);
    }
  }

  const customGPTIds = [...new Set(
    conversations
      .map((c) => c.gizmoId)
      .filter((id): id is string => id !== undefined),
  )];

  const stats = calculateStats(conversations);

  return { conversations, customGPTIds, stats, warnings };
}

/**
 * Parse conversations.json content directly (for testing or when JSON is already extracted).
 */
export function parseChatGPTConversationsJSON(
  json: string | ChatGPTRawConversation[],
): RawChatGPTData {
  const warnings: string[] = [];

  const rawConversations: ChatGPTRawConversation[] =
    typeof json === "string"
      ? (() => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            throw new ChatGPTParseError("Invalid JSON");
          }
          if (!Array.isArray(parsed)) {
            throw new ChatGPTParseError("Root is not an array");
          }
          return parsed as ChatGPTRawConversation[];
        })()
      : json;

  const conversations: ParsedConversation[] = [];
  for (const raw of rawConversations) {
    try {
      const conv = parseConversation(raw, warnings);
      if (conv) {
        conversations.push(conv);
      }
    } catch (err) {
      const title = raw?.title ?? "unknown";
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse conversation "${title}": ${msg}`);
    }
  }

  const customGPTIds = [...new Set(
    conversations
      .map((c) => c.gizmoId)
      .filter((id): id is string => id !== undefined),
  )];

  const stats = calculateStats(conversations);

  return { conversations, customGPTIds, stats, warnings };
}

// Re-export for convenience
export { flattenTree, extractTextFromParts, findRootNodeId };
