import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────

// vi.hoisted runs before vi.mock factories — makes shared state available
const { registeredHandlers, mockChrome } = vi.hoisted(() => ({
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  mockChrome: {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      lastError: null as { message?: string } | null,
    },
    tabs: { sendMessage: vi.fn() },
  },
}));

vi.stubGlobal("chrome", mockChrome);

// Mock messaging to prevent side-effect listener registration
vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(name, handler);
    return () => registeredHandlers.delete(name);
  }),
}));

// Mock session management used by the importer
vi.mock("@/content-scripts/gemini/session", () => {
  let sessionCallCount = 0;
  return {
    getSession: vi.fn(async () => ({
      accessToken: `token-${++sessionCallCount}`,
      buildLabel: "boq_test",
      sessionId: "sid-test",
      language: "en",
    })),
    refreshSession: vi.fn(async () => ({
      accessToken: `refreshed-token-${++sessionCallCount}`,
      buildLabel: "boq_test",
      sessionId: "sid-test",
      language: "en",
    })),
  };
});

import { createGem, updateGem, deleteGem } from "@/content-scripts/gemini/importer";
import { getSession } from "@/content-scripts/gemini/session";
import type { GemConfig } from "@/core/adapters/gemini-import-types";

// ─── Helpers ────────────────────────────────────────────────

function buildBatchResponseText(
  rpcid: string,
  bodyData: unknown,
  identifier: string = "generic",
): string {
  const bodyStr = JSON.stringify(bodyData);
  const envelope = [rpcid, null, bodyStr, null, null, null, identifier];
  const frameJson = JSON.stringify([envelope]);
  const length = 1 + frameJson.length;
  return `)]}'\n\n${length}\n${frameJson}`;
}

function setupFetch(
  mockImpl: (url: string) => Promise<{ ok: boolean; status?: number; statusText?: string; text?: () => Promise<string> }>,
): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    return mockImpl(urlStr);
  }));
}

const sampleConfig: GemConfig = {
  name: "Test Gem",
  description: "A test gem for unit testing",
  instructions: "You are a helpful test assistant.",
};

// ─── createGem ──────────────────────────────────────────────

describe("createGem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("chrome", mockChrome);
  });

  it("creates a gem successfully and returns the gem ID", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        const responseText = buildBatchResponseText(
          "oMH3Zd",
          ["new-gem-id-123", "Test Gem"],
        );
        return { ok: true, text: async () => responseText };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem(sampleConfig);

    expect(result.success).toBe(true);
    expect(result.gemId).toBe("new-gem-id-123");
    expect(result.error).toBeUndefined();
    expect(result.fallback).toBeUndefined();
  });

  it("sends correct RPC ID in the batchexecute URL", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        // Verify the URL contains the create-gem RPC ID
        expect(url).toContain("rpcids=oMH3Zd");
        return {
          ok: true,
          text: async () => buildBatchResponseText("oMH3Zd", ["gem-id"]),
        };
      }
      return { ok: false, status: 404 };
    });

    await createGem(sampleConfig);

    // Verify the fetch was called with the batchexecute URL
    const fetchMock = vi.mocked(globalThis.fetch);
    const calls = fetchMock.mock.calls;
    const batchCall = calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "";
      return url.includes("batchexecute");
    });
    expect(batchCall).toBeDefined();
  });

  it("creates the Gem in the tab's account", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      accessToken: "tok-u1",
      language: "en",
      prefix: "/u/1",
    });
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: true, text: async () => buildBatchResponseText("oMH3Zd", ["gem-u1"]) };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem(sampleConfig);

    expect(result.gemId).toBe("gem-u1");
    const url = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0]![0]));
    expect(url.pathname).toBe("/u/1/_/BardChatUi/data/batchexecute");
    expect(url.searchParams.get("source-path")).toBe("/u/1/app");
  });

  it("returns fallback on HTTP error", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: false, status: 500, statusText: "Internal Server Error" };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem(sampleConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.fallback).toBeDefined();
    expect(result.fallback!.steps.length).toBeGreaterThan(0);
    expect(result.fallback!.steps[0]).toContain("gemini.google.com/gems/new");
    expect(result.fallback!.configData).toEqual(sampleConfig);
  });

  it("returns fallback when response has no gem ID", async () => {
    // Response body doesn't have a string at index 0
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        const responseText = buildBatchResponseText("oMH3Zd", [null, null]);
        return { ok: true, text: async () => responseText };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem(sampleConfig);

    expect(result.success).toBe(false);
    expect(result.error).toContain("didn't include a Gem ID");
    expect(result.maybeCreated).toBe(true);
    expect(result.fallback).toBeDefined();
  });

  it("retries on 401 with session refresh", async () => {
    let callCount = 0;
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 401, statusText: "Unauthorized" };
        }
        return {
          ok: true,
          text: async () => buildBatchResponseText("oMH3Zd", ["gem-after-retry"]),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem(sampleConfig);

    expect(result.success).toBe(true);
    expect(result.gemId).toBe("gem-after-retry");
    expect(callCount).toBe(2);
  });
});

// ─── updateGem ──────────────────────────────────────────────

describe("updateGem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("chrome", mockChrome);
  });

  it("updates a gem successfully", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        expect(url).toContain("rpcids=kHv0Vd");
        return {
          ok: true,
          text: async () => buildBatchResponseText("kHv0Vd", ["ok"]),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await updateGem("gem-existing-123", sampleConfig);

    expect(result.success).toBe(true);
    expect(result.gemId).toBe("gem-existing-123");
  });

  it("returns fallback on failure", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: false, status: 500, statusText: "Server Error" };
      }
      return { ok: false, status: 404 };
    });

    const result = await updateGem("gem-existing-123", sampleConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.fallback).toBeDefined();
    expect(result.fallback!.steps.some((s) => s.includes("Edit"))).toBe(true);
    expect(result.fallback!.configData).toEqual(sampleConfig);
  });
});

// ─── deleteGem ──────────────────────────────────────────────

describe("deleteGem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("chrome", mockChrome);
  });

  it("deletes a gem successfully", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        expect(url).toContain("rpcids=UXcSJb");
        return {
          ok: true,
          text: async () => buildBatchResponseText("UXcSJb", []),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await deleteGem("gem-to-delete-456");

    expect(result.success).toBe(true);
    expect(result.gemId).toBeUndefined();
  });

  it("returns fallback on failure", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: false, status: 500, statusText: "Server Error" };
      }
      return { ok: false, status: 404 };
    });

    const result = await deleteGem("gem-to-delete-456");

    expect(result.success).toBe(false);
    expect(result.fallback).toBeDefined();
    expect(result.fallback!.steps.some((s) => s.includes("Delete"))).toBe(true);
  });
});

// ─── Message handler registration ───────────────────────────

describe("importer message handlers", () => {
  it("registers GEMINI_CREATE_GEM handler", () => {
    expect(registeredHandlers.has("GEMINI_CREATE_GEM")).toBe(true);
  });

  it("registers GEMINI_UPDATE_GEM handler", () => {
    expect(registeredHandlers.has("GEMINI_UPDATE_GEM")).toBe(true);
  });

  it("registers GEMINI_DELETE_GEM handler", () => {
    expect(registeredHandlers.has("GEMINI_DELETE_GEM")).toBe(true);
  });
});

// ─── GemConfig field mapping ────────────────────────────────

describe("GemConfig field mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("chrome", mockChrome);
  });

  it("maps workspace fields to GemConfig correctly", () => {
    // This tests that the type contract between the orchestrator
    // and the importer is correct — GemConfig requires name, description, instructions
    const workspace = {
      name: "My Project",
      description: "Project description",
      instructions: { raw: "Detailed instructions here" },
    };

    const config: GemConfig = {
      name: workspace.name,
      description: workspace.description,
      instructions: workspace.instructions.raw,
    };

    expect(config.name).toBe("My Project");
    expect(config.description).toBe("Project description");
    expect(config.instructions).toBe("Detailed instructions here");
  });

  it("handles empty description", () => {
    const config: GemConfig = {
      name: "Gem",
      description: "",
      instructions: "Do stuff",
    };

    // Empty description is valid
    expect(config.description).toBe("");
  });

  it("handles empty instructions", () => {
    const config: GemConfig = {
      name: "Gem",
      description: "Desc",
      instructions: "",
    };

    expect(config.instructions).toBe("");
  });
});

// ─── Orchestrator Gemini import scenarios ───────────────────

describe("orchestrator Gemini import scenarios", () => {
  // These tests verify the data flow patterns without importing the
  // full orchestrator (which has heavy chrome.* dependencies).
  // They test the contract: workspace → GemConfig → createGem → result.

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("chrome", mockChrome);
  });

  it("all gems import successfully", async () => {
    const workspaces = [
      { name: "Gem A", description: "Desc A", instructions: "Instr A" },
      { name: "Gem B", description: "Desc B", instructions: "Instr B" },
      { name: "Gem C", description: "Desc C", instructions: "Instr C" },
    ];

    let gemCounter = 0;
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        gemCounter++;
        // Capture the counter value eagerly — concurrent calls would
        // otherwise all see the final counter value in the text() closure.
        const id = gemCounter;
        return {
          ok: true,
          text: async () =>
            buildBatchResponseText("oMH3Zd", [`gem-id-${id}`]),
        };
      }
      return { ok: false, status: 404 };
    });

    const results = await Promise.all(
      workspaces.map((ws) => createGem(ws)),
    );

    expect(results.every((r) => r.success)).toBe(true);
    // All 3 should succeed — IDs may vary in order due to concurrency
    const gemIds = results.map((r) => r.gemId).sort();
    expect(gemIds).toEqual(["gem-id-1", "gem-id-2", "gem-id-3"]);
  });

  it("some gems fail — partial success with fallbacks", async () => {
    const workspaces = [
      { name: "Gem A", description: "Desc A", instructions: "Instr A" },
      { name: "Gem B", description: "Desc B", instructions: "Instr B" },
      { name: "Gem C", description: "Desc C", instructions: "Instr C" },
      { name: "Gem D", description: "Desc D", instructions: "Instr D" },
      { name: "Gem E", description: "Desc E", instructions: "Instr E" },
    ];

    let gemCounter = 0;
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        gemCounter++;
        const id = gemCounter;
        // Gems 2 and 4 fail
        if (id === 2 || id === 4) {
          return { ok: false, status: 500, statusText: "Server Error" };
        }
        return {
          ok: true,
          text: async () =>
            buildBatchResponseText("oMH3Zd", [`gem-id-${id}`]),
        };
      }
      return { ok: false, status: 404 };
    });

    const results = await Promise.all(
      workspaces.map((ws) => createGem(ws)),
    );

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes).toHaveLength(3);
    expect(failures).toHaveLength(2);

    // Failed results have fallback instructions
    for (const failure of failures) {
      expect(failure.fallback).toBeDefined();
      expect(failure.fallback!.steps.length).toBeGreaterThan(0);
      expect(failure.fallback!.configData.name).toBeTruthy();
    }
  });

  it("all gems fail — total failure with all fallbacks", async () => {
    const workspaces = [
      { name: "Gem A", description: "Desc A", instructions: "Instr A" },
      { name: "Gem B", description: "Desc B", instructions: "Instr B" },
      { name: "Gem C", description: "Desc C", instructions: "Instr C" },
    ];

    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: false, status: 500, statusText: "Server Error" };
      }
      return { ok: false, status: 404 };
    });

    const results = await Promise.all(
      workspaces.map((ws) => createGem(ws)),
    );

    expect(results.every((r) => !r.success)).toBe(true);
    expect(results.every((r) => r.fallback !== undefined)).toBe(true);

    // Each fallback should contain the original config
    results.forEach((r, i) => {
      expect(r.fallback!.configData.name).toBe(workspaces[i]!.name);
      expect(r.fallback!.configData.instructions).toBe(
        workspaces[i]!.instructions,
      );
    });
  });

  it("fallback steps contain the gem name", async () => {
    setupFetch(async (url) => {
      if (url.includes("batchexecute")) {
        return { ok: false, status: 500, statusText: "Server Error" };
      }
      return { ok: false, status: 404 };
    });

    const result = await createGem({
      name: "My Special Gem",
      description: "Important",
      instructions: "Do the thing",
    });

    expect(result.success).toBe(false);
    expect(result.fallback!.steps.some((s) => s.includes("My Special Gem"))).toBe(
      true,
    );
  });
});
