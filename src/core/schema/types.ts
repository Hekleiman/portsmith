import { z } from "zod";

// ─── Platform ───────────────────────────────────────────────

export const PlatformIdentifierSchema = z.object({
  platform: z.enum([
    "chatgpt",
    "claude",
    "gemini",
    "copilot",
    "poe",
    "custom",
  ]),
  version: z.string().optional(),
  tier: z
    .enum(["free", "plus", "pro", "max", "team", "enterprise"])
    .optional(),
  exportMethod: z.enum([
    "official_export",
    "dom_extraction",
    "api",
    "manual",
  ]),
  exportedAt: z.string().datetime(),
});

export type PlatformIdentifier = z.infer<typeof PlatformIdentifierSchema>;

// ─── User Profile ───────────────────────────────────────────

export const CommunicationStyleSchema = z.object({
  formality: z.string(),
  verbosity: z.string(),
  preferences: z.array(z.string()),
});

export type CommunicationStyle = z.infer<typeof CommunicationStyleSchema>;

export const UserProfileSchema = z.object({
  name: z.string().optional(),
  profession: z.string().optional(),
  expertise: z.array(z.string()),
  communicationStyle: CommunicationStyleSchema,
  interests: z.array(z.string()),
  locale: z.string().optional(),
  timezone: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ─── Workspace Capability ───────────────────────────────────

export const WorkspaceCapabilitySchema = z.object({
  type: z.enum([
    "web_browsing",
    "code_execution",
    "image_generation",
    "file_upload",
    "api_actions",
    "web_search",
    "mcp",
    "voice",
    "canvas",
    "artifacts",
  ]),
  required: z.boolean(),
  platformSpecific: z.string().optional(),
  equivalent: z.string().optional(),
  available: z.boolean(),
});

export type WorkspaceCapability = z.infer<typeof WorkspaceCapabilitySchema>;

// ─── Knowledge File ─────────────────────────────────────────

export const KnowledgeFileSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  source: z.enum(["exported", "referenced", "reconstructed"]),
  contentRef: z.string().optional(),
  description: z.string().optional(),
  compatible: z.boolean(),
  conversionNeeded: z.string().optional(),
});

export type KnowledgeFile = z.infer<typeof KnowledgeFileSchema>;

// ─── Memory Item ────────────────────────────────────────────

export const MemoryItemMigrationSchema = z.object({
  fitsConstraints: z.boolean(),
  truncatedVersion: z.string().optional(),
  priority: z.number().int().min(1).max(10),
});

export type MemoryItemMigration = z.infer<typeof MemoryItemMigrationSchema>;

export const MemoryItemSchema = z.object({
  id: z.string(),
  fact: z.string(),
  category: z.enum([
    "identity",
    "preference",
    "project",
    "skill",
    "relationship",
    "tool",
    "context",
    "instruction",
  ]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["explicit", "inferred"]),
  workspaceIds: z.array(z.string()),
  migration: MemoryItemMigrationSchema,
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

// ─── Workspace ──────────────────────────────────────────────

export const WorkspaceBehaviorSchema = z.object({
  tone: z.string().optional(),
  responseFormat: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  triggerPhrases: z.array(z.string()).optional(),
});

export type WorkspaceBehavior = z.infer<typeof WorkspaceBehaviorSchema>;

export const WorkspaceMigrationSchema = z.object({
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  manualStepsRequired: z.array(z.string()),
});

export type WorkspaceMigration = z.infer<typeof WorkspaceMigrationSchema>;

export const WorkspaceInstructionsSchema = z.object({
  raw: z.string(),
  translated: z.record(z.string(), z.string()).optional(),
});

export type WorkspaceInstructions = z.infer<typeof WorkspaceInstructionsSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  sourceId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  instructions: WorkspaceInstructionsSchema,
  knowledgeFiles: z.array(KnowledgeFileSchema),
  category: z.enum([
    "coding",
    "writing",
    "research",
    "data_analysis",
    "creative",
    "business",
    "education",
    "personal",
    "customer_support",
    "other",
  ]),
  tags: z.array(z.string()),
  behavior: WorkspaceBehaviorSchema,
  capabilities: z.array(WorkspaceCapabilitySchema),
  conversationCount: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime(),
  sampleTopics: z.array(z.string()),
  migration: WorkspaceMigrationSchema,
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// ─── Conversation Summary ───────────────────────────────────

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string().datetime(),
  workspaceId: z.string().optional(),
  topics: z.array(z.string()),
  keyDecisions: z.array(z.string()),
  artifacts: z.array(z.string()),
  summary: z.string(),
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

// ─── Portsmith Manifest ─────────────────────────────────────

export const ManifestMetadataSchema = z.object({
  taskId: z.string().optional(),
  generatedBy: z.string(),
});

export type ManifestMetadata = z.infer<typeof ManifestMetadataSchema>;

export const PortsmithManifestSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  source: PlatformIdentifierSchema,
  user: UserProfileSchema,
  workspaces: z.array(WorkspaceSchema),
  memory: z.array(MemoryItemSchema),
  globalInstructions: z.string(),
  conversationSummaries: z.array(ConversationSummarySchema).optional(),
  metadata: ManifestMetadataSchema,
});

export type PortsmithManifest = z.infer<typeof PortsmithManifestSchema>;
