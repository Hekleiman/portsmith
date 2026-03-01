import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  PlatformIdentifierSchema,
  UserProfileSchema,
  WorkspaceCapabilitySchema,
  KnowledgeFileSchema,
  MemoryItemSchema,
  WorkspaceSchema,
  ConversationSummarySchema,
  PortsmithManifestSchema,
} from "@/core/schema/types";
import {
  parseManifest,
  safeParseManifest,
  parseWorkspace,
  parseMemoryItem,
  parseKnowledgeFile,
  parseUserProfile,
  parseConversationSummary,
  parsePlatformIdentifier,
  parseWorkspaceCapability,
} from "@/core/schema/validate";
import sampleManifest from "../fixtures/sample-manifest.json";

// ─── Helpers ────────────────────────────────────────────────

function validPlatformIdentifier() {
  return {
    platform: "chatgpt",
    exportMethod: "dom_extraction",
    exportedAt: "2025-01-15T10:30:00Z",
  };
}

function validUserProfile() {
  return {
    name: "Jane",
    expertise: ["TypeScript"],
    communicationStyle: {
      formality: "casual",
      verbosity: "concise",
      preferences: [],
    },
    interests: ["AI"],
  };
}

function validCapability() {
  return {
    type: "code_execution" as const,
    required: false,
    available: true,
  };
}

function validKnowledgeFile() {
  return {
    id: "kf-001",
    originalName: "guide.md",
    mimeType: "text/markdown",
    sizeBytes: 1024,
    source: "exported" as const,
    compatible: true,
  };
}

function validMemoryItem() {
  return {
    id: "mem-001",
    fact: "Prefers TypeScript",
    category: "preference" as const,
    confidence: 0.9,
    source: "explicit" as const,
    workspaceIds: [],
    migration: { fitsConstraints: true, priority: 8 },
  };
}

function validWorkspace() {
  return {
    id: "ws-001",
    name: "Code Reviewer",
    description: "Reviews code",
    instructions: { raw: "Review code carefully" },
    knowledgeFiles: [],
    category: "coding" as const,
    tags: [],
    behavior: {},
    capabilities: [],
    conversationCount: 10,
    lastActiveAt: "2025-01-14T18:00:00Z",
    sampleTopics: [],
    migration: { confidence: 0.85, warnings: [], manualStepsRequired: [] },
  };
}

function validConversationSummary() {
  return {
    id: "conv-001",
    title: "Test conversation",
    date: "2025-01-12T09:00:00Z",
    topics: ["testing"],
    keyDecisions: [],
    artifacts: [],
    summary: "A test conversation",
  };
}

// ─── PlatformIdentifier ─────────────────────────────────────

describe("PlatformIdentifierSchema", () => {
  it("accepts valid data", () => {
    const result = PlatformIdentifierSchema.safeParse(
      validPlatformIdentifier(),
    );
    expect(result.success).toBe(true);
  });

  it("accepts all platform values", () => {
    const platforms = [
      "chatgpt",
      "claude",
      "gemini",
      "copilot",
      "poe",
      "custom",
    ] as const;
    for (const platform of platforms) {
      const data = { ...validPlatformIdentifier(), platform };
      expect(PlatformIdentifierSchema.safeParse(data).success).toBe(true);
    }
  });

  it("accepts optional tier and version", () => {
    const data = {
      ...validPlatformIdentifier(),
      version: "2025-01",
      tier: "plus",
    };
    expect(PlatformIdentifierSchema.safeParse(data).success).toBe(true);
  });

  it("rejects invalid platform", () => {
    const data = { ...validPlatformIdentifier(), platform: "invalid" };
    expect(PlatformIdentifierSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(PlatformIdentifierSchema.safeParse({}).success).toBe(false);
    expect(
      PlatformIdentifierSchema.safeParse({ platform: "chatgpt" }).success,
    ).toBe(false);
  });

  it("rejects invalid datetime", () => {
    const data = { ...validPlatformIdentifier(), exportedAt: "not-a-date" };
    expect(PlatformIdentifierSchema.safeParse(data).success).toBe(false);
  });

  it("works via parsePlatformIdentifier", () => {
    expect(parsePlatformIdentifier(validPlatformIdentifier())).toEqual(
      validPlatformIdentifier(),
    );
  });
});

// ─── UserProfile ────────────────────────────────────────────

describe("UserProfileSchema", () => {
  it("accepts valid data", () => {
    expect(UserProfileSchema.safeParse(validUserProfile()).success).toBe(true);
  });

  it("accepts empty arrays for expertise and interests", () => {
    const data = {
      ...validUserProfile(),
      expertise: [],
      interests: [],
    };
    expect(UserProfileSchema.safeParse(data).success).toBe(true);
  });

  it("allows all optional fields to be absent", () => {
    const data = {
      expertise: [],
      communicationStyle: {
        formality: "formal",
        verbosity: "verbose",
        preferences: [],
      },
      interests: [],
    };
    expect(UserProfileSchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing communicationStyle", () => {
    const data = { expertise: [], interests: [] };
    expect(UserProfileSchema.safeParse(data).success).toBe(false);
  });

  it("works via parseUserProfile", () => {
    const parsed = parseUserProfile(validUserProfile());
    expect(parsed.name).toBe("Jane");
  });
});

// ─── WorkspaceCapability ────────────────────────────────────

describe("WorkspaceCapabilitySchema", () => {
  it("accepts valid data", () => {
    expect(WorkspaceCapabilitySchema.safeParse(validCapability()).success).toBe(
      true,
    );
  });

  it("accepts all capability types", () => {
    const types = [
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
    ] as const;
    for (const type of types) {
      const data = { ...validCapability(), type };
      expect(WorkspaceCapabilitySchema.safeParse(data).success).toBe(true);
    }
  });

  it("rejects invalid capability type", () => {
    const data = { ...validCapability(), type: "teleportation" };
    expect(WorkspaceCapabilitySchema.safeParse(data).success).toBe(false);
  });

  it("works via parseWorkspaceCapability", () => {
    expect(parseWorkspaceCapability(validCapability()).type).toBe(
      "code_execution",
    );
  });
});

// ─── KnowledgeFile ──────────────────────────────────────────

describe("KnowledgeFileSchema", () => {
  it("accepts valid data", () => {
    expect(KnowledgeFileSchema.safeParse(validKnowledgeFile()).success).toBe(
      true,
    );
  });

  it("accepts zero sizeBytes", () => {
    const data = { ...validKnowledgeFile(), sizeBytes: 0 };
    expect(KnowledgeFileSchema.safeParse(data).success).toBe(true);
  });

  it("rejects negative sizeBytes", () => {
    const data = { ...validKnowledgeFile(), sizeBytes: -1 };
    expect(KnowledgeFileSchema.safeParse(data).success).toBe(false);
  });

  it("rejects non-integer sizeBytes", () => {
    const data = { ...validKnowledgeFile(), sizeBytes: 1.5 };
    expect(KnowledgeFileSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...data } = validKnowledgeFile();
    expect(KnowledgeFileSchema.safeParse(data).success).toBe(false);
  });

  it("works via parseKnowledgeFile", () => {
    expect(parseKnowledgeFile(validKnowledgeFile()).id).toBe("kf-001");
  });
});

// ─── MemoryItem ─────────────────────────────────────────────

describe("MemoryItemSchema", () => {
  it("accepts valid data", () => {
    expect(MemoryItemSchema.safeParse(validMemoryItem()).success).toBe(true);
  });

  it("accepts confidence at boundary 0", () => {
    const data = { ...validMemoryItem(), confidence: 0 };
    expect(MemoryItemSchema.safeParse(data).success).toBe(true);
  });

  it("accepts confidence at boundary 1", () => {
    const data = { ...validMemoryItem(), confidence: 1 };
    expect(MemoryItemSchema.safeParse(data).success).toBe(true);
  });

  it("rejects confidence above 1", () => {
    const data = { ...validMemoryItem(), confidence: 1.1 };
    expect(MemoryItemSchema.safeParse(data).success).toBe(false);
  });

  it("rejects confidence below 0", () => {
    const data = { ...validMemoryItem(), confidence: -0.1 };
    expect(MemoryItemSchema.safeParse(data).success).toBe(false);
  });

  it("accepts all category values", () => {
    const categories = [
      "identity",
      "preference",
      "project",
      "skill",
      "relationship",
      "tool",
      "context",
      "instruction",
    ] as const;
    for (const category of categories) {
      const data = { ...validMemoryItem(), category };
      expect(MemoryItemSchema.safeParse(data).success).toBe(true);
    }
  });

  it("rejects migration priority below 1", () => {
    const data = {
      ...validMemoryItem(),
      migration: { fitsConstraints: true, priority: 0 },
    };
    expect(MemoryItemSchema.safeParse(data).success).toBe(false);
  });

  it("rejects migration priority above 10", () => {
    const data = {
      ...validMemoryItem(),
      migration: { fitsConstraints: true, priority: 11 },
    };
    expect(MemoryItemSchema.safeParse(data).success).toBe(false);
  });

  it("accepts priority at boundaries 1 and 10", () => {
    for (const priority of [1, 10]) {
      const data = {
        ...validMemoryItem(),
        migration: { fitsConstraints: true, priority },
      };
      expect(MemoryItemSchema.safeParse(data).success).toBe(true);
    }
  });

  it("accepts empty workspaceIds", () => {
    const data = { ...validMemoryItem(), workspaceIds: [] };
    expect(MemoryItemSchema.safeParse(data).success).toBe(true);
  });

  it("works via parseMemoryItem", () => {
    expect(parseMemoryItem(validMemoryItem()).fact).toBe("Prefers TypeScript");
  });
});

// ─── Workspace ──────────────────────────────────────────────

describe("WorkspaceSchema", () => {
  it("accepts valid data", () => {
    expect(WorkspaceSchema.safeParse(validWorkspace()).success).toBe(true);
  });

  it("accepts workspace with translated instructions", () => {
    const data = {
      ...validWorkspace(),
      instructions: {
        raw: "Review code",
        translated: { claude: "Review code on Claude" },
      },
    };
    expect(WorkspaceSchema.safeParse(data).success).toBe(true);
  });

  it("accepts all category values", () => {
    const categories = [
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
    ] as const;
    for (const category of categories) {
      const data = { ...validWorkspace(), category };
      expect(WorkspaceSchema.safeParse(data).success).toBe(true);
    }
  });

  it("accepts workspace with knowledge files and capabilities", () => {
    const data = {
      ...validWorkspace(),
      knowledgeFiles: [validKnowledgeFile()],
      capabilities: [validCapability()],
    };
    expect(WorkspaceSchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...data } = validWorkspace();
    expect(WorkspaceSchema.safeParse(data).success).toBe(false);
  });

  it("rejects migration confidence above 1", () => {
    const data = {
      ...validWorkspace(),
      migration: { confidence: 1.5, warnings: [], manualStepsRequired: [] },
    };
    expect(WorkspaceSchema.safeParse(data).success).toBe(false);
  });

  it("rejects negative conversationCount", () => {
    const data = { ...validWorkspace(), conversationCount: -1 };
    expect(WorkspaceSchema.safeParse(data).success).toBe(false);
  });

  it("accepts zero conversationCount", () => {
    const data = { ...validWorkspace(), conversationCount: 0 };
    expect(WorkspaceSchema.safeParse(data).success).toBe(true);
  });

  it("works via parseWorkspace", () => {
    expect(parseWorkspace(validWorkspace()).name).toBe("Code Reviewer");
  });
});

// ─── ConversationSummary ────────────────────────────────────

describe("ConversationSummarySchema", () => {
  it("accepts valid data", () => {
    expect(
      ConversationSummarySchema.safeParse(validConversationSummary()).success,
    ).toBe(true);
  });

  it("accepts empty arrays for topics, keyDecisions, artifacts", () => {
    const data = {
      ...validConversationSummary(),
      topics: [],
      keyDecisions: [],
      artifacts: [],
    };
    expect(ConversationSummarySchema.safeParse(data).success).toBe(true);
  });

  it("accepts optional workspaceId", () => {
    const data = { ...validConversationSummary(), workspaceId: "ws-001" };
    expect(ConversationSummarySchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing summary", () => {
    const { summary: _, ...data } = validConversationSummary();
    expect(ConversationSummarySchema.safeParse(data).success).toBe(false);
  });

  it("works via parseConversationSummary", () => {
    expect(parseConversationSummary(validConversationSummary()).id).toBe(
      "conv-001",
    );
  });
});

// ─── PortsmithManifest ──────────────────────────────────────

describe("PortsmithManifestSchema", () => {
  it("accepts the full sample manifest fixture", () => {
    const result = PortsmithManifestSchema.safeParse(sampleManifest);
    expect(result.success).toBe(true);
  });

  it("accepts manifest without optional conversationSummaries", () => {
    const data = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: [],
      memory: [],
      globalInstructions: "",
      metadata: { generatedBy: "portsmith/0.1.0" },
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(true);
  });

  it("accepts manifest with empty workspaces and memory", () => {
    const data = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: [],
      memory: [],
      globalInstructions: "",
      metadata: { generatedBy: "test" },
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing version", () => {
    const { version: _, ...data } = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: [],
      memory: [],
      globalInstructions: "",
      metadata: { generatedBy: "test" },
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing metadata", () => {
    const data = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: [],
      memory: [],
      globalInstructions: "",
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(false);
  });

  it("rejects invalid nested workspace", () => {
    const data = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: [{ invalid: true }],
      memory: [],
      globalInstructions: "",
      metadata: { generatedBy: "test" },
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(false);
  });

  it("rejects wrong type for workspaces", () => {
    const data = {
      version: "0.1.0",
      exportedAt: "2025-01-15T10:30:00Z",
      source: validPlatformIdentifier(),
      user: validUserProfile(),
      workspaces: "not-an-array",
      memory: [],
      globalInstructions: "",
      metadata: { generatedBy: "test" },
    };
    expect(PortsmithManifestSchema.safeParse(data).success).toBe(false);
  });
});

// ─── Validate helpers ───────────────────────────────────────

describe("parseManifest", () => {
  it("returns parsed data for valid input", () => {
    const result = parseManifest(sampleManifest);
    expect(result.version).toBe("0.1.0");
    expect(result.workspaces).toHaveLength(2);
    expect(result.memory).toHaveLength(3);
  });

  it("throws ZodError for invalid input", () => {
    expect(() => parseManifest({})).toThrow(ZodError);
  });

  it("throws ZodError for null", () => {
    expect(() => parseManifest(null)).toThrow(ZodError);
  });
});

describe("safeParseManifest", () => {
  it("returns success for valid input", () => {
    const result = safeParseManifest(sampleManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source.platform).toBe("chatgpt");
    }
  });

  it("returns error for invalid input", () => {
    const result = safeParseManifest({ version: 123 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});
