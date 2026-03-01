import type { ZodSafeParseResult } from "zod";
import {
  PortsmithManifestSchema,
  WorkspaceSchema,
  MemoryItemSchema,
  KnowledgeFileSchema,
  UserProfileSchema,
  ConversationSummarySchema,
  PlatformIdentifierSchema,
  WorkspaceCapabilitySchema,
} from "./types";
import type {
  PortsmithManifest,
  Workspace,
  MemoryItem,
  KnowledgeFile,
  UserProfile,
  ConversationSummary,
  PlatformIdentifier,
  WorkspaceCapability,
} from "./types";

// ─── Throwing parsers ───────────────────────────────────────

export function parseManifest(data: unknown): PortsmithManifest {
  return PortsmithManifestSchema.parse(data);
}

export function parseWorkspace(data: unknown): Workspace {
  return WorkspaceSchema.parse(data);
}

export function parseMemoryItem(data: unknown): MemoryItem {
  return MemoryItemSchema.parse(data);
}

export function parseKnowledgeFile(data: unknown): KnowledgeFile {
  return KnowledgeFileSchema.parse(data);
}

export function parseUserProfile(data: unknown): UserProfile {
  return UserProfileSchema.parse(data);
}

export function parseConversationSummary(data: unknown): ConversationSummary {
  return ConversationSummarySchema.parse(data);
}

export function parsePlatformIdentifier(data: unknown): PlatformIdentifier {
  return PlatformIdentifierSchema.parse(data);
}

export function parseWorkspaceCapability(data: unknown): WorkspaceCapability {
  return WorkspaceCapabilitySchema.parse(data);
}

// ─── Safe parsers ───────────────────────────────────────────

export function safeParseManifest(
  data: unknown,
): ZodSafeParseResult<PortsmithManifest> {
  return PortsmithManifestSchema.safeParse(data);
}

export function safeParseWorkspace(
  data: unknown,
): ZodSafeParseResult<Workspace> {
  return WorkspaceSchema.safeParse(data);
}

export function safeParseMemoryItem(
  data: unknown,
): ZodSafeParseResult<MemoryItem> {
  return MemoryItemSchema.safeParse(data);
}

export function safeParseKnowledgeFile(
  data: unknown,
): ZodSafeParseResult<KnowledgeFile> {
  return KnowledgeFileSchema.safeParse(data);
}

export function safeParseUserProfile(
  data: unknown,
): ZodSafeParseResult<UserProfile> {
  return UserProfileSchema.safeParse(data);
}

export function safeParseConversationSummary(
  data: unknown,
): ZodSafeParseResult<ConversationSummary> {
  return ConversationSummarySchema.safeParse(data);
}

export function safeParsePlatformIdentifier(
  data: unknown,
): ZodSafeParseResult<PlatformIdentifier> {
  return PlatformIdentifierSchema.safeParse(data);
}

export function safeParseWorkspaceCapability(
  data: unknown,
): ZodSafeParseResult<WorkspaceCapability> {
  return WorkspaceCapabilitySchema.safeParse(data);
}
