import { APP_VERSION } from "@/shared/constants";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────
// Must be set up before any imports that touch chrome or messaging.

// vi.hoisted runs before vi.mock factories — makes registeredHandlers
// available for the mock factory below.
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

// Mock the messaging module to prevent side-effect listener registration
// but keep the real onMessage for handler testing
vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(name, handler);
    return () => registeredHandlers.delete(name);
  }),
}));

import { extractGems } from "@/content-scripts/gemini/extractor";
import { generateGeminiManifest } from "@/core/transform/gemini-manifest";
import type { ExtractedGem } from "@/core/adapters/gemini-dom-types";
import { PortsmithManifestSchema } from "@/core/schema/types";

// ─── Test Data ──────────────────────────────────────────────

const MOCK_GEMINI_HTML = `
<!DOCTYPE html>
<html>
<head><title>Gemini</title></head>
<body>
<script>window.WIZ_global_data = {"SNlM0e": "test-csrf-token-abc123", "cfb2h": "boq_assistant-bard-web.2024.01", "FdrFJe": "session-xyz-789", "TuX5cc": "en"};</script>
</body>
</html>
`;

function buildBatchResponseText(
  rpcid: string,
  bodyData: unknown,
  identifier: string,
): string {
  const bodyStr = JSON.stringify(bodyData);
  const envelope = [rpcid, null, bodyStr, null, null, null, identifier];
  const frameJson = JSON.stringify([envelope]);
  const length = 1 + frameJson.length;
  return `)]}'\n\n${length}\n${frameJson}`;
}

function makeGemListResponse(gems: unknown[][]): string {
  const body = [null, null, gems, null];
  return buildBatchResponseText("CNgdBe", body, "custom");
}

// ─── Tests ──────────────────────────────────────────────────

describe("extractGems", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-stub chrome since restoreAllMocks might clear stubs
    vi.stubGlobal("chrome", mockChrome);
  });

  function setupFetch(
    sessionResponse?: { ok: boolean; html?: string; status?: number },
    batchResponse?: { ok: boolean; text?: string; status?: number },
  ): void {
    const sessionResp = sessionResponse ?? { ok: true, html: MOCK_GEMINI_HTML };
    const batchResp = batchResponse ?? { ok: true, text: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/app")) {
          if (!sessionResp.ok) {
            return {
              ok: false,
              status: sessionResp.status ?? 500,
            };
          }
          return {
            ok: true,
            text: async () => sessionResp.html ?? MOCK_GEMINI_HTML,
          };
        }

        if (urlStr.includes("batchexecute")) {
          if (!batchResp.ok) {
            return {
              ok: false,
              status: batchResp.status ?? 500,
              statusText: `Error ${batchResp.status ?? 500}`,
            };
          }
          return {
            ok: true,
            text: async () => batchResp.text ?? "",
          };
        }

        throw new Error(`Unexpected fetch URL: ${urlStr}`);
      }),
    );
  }

  // ── Happy path ─────────────────────────────────────────

  it("extracts gems successfully", async () => {
    const gems = [
      [
        "gem-001",
        ["Code Helper", "Helps with coding"],
        ["You are a coding assistant."],
      ],
      [
        "gem-002",
        ["Blog Draft Writer", "Helps draft blog articles"],
        ["You are a writing assistant that helps draft blog articles."],
      ],
    ];
    const responseText = makeGemListResponse(gems);
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    expect(result.success).toBe(true);
    expect(result.gems).toHaveLength(2);
    expect(result.gems[0]!.id).toBe("gem-001");
    expect(result.gems[0]!.name).toBe("Code Helper");
    expect(result.gems[0]!.description).toBe("Helps with coding");
    expect(result.gems[0]!.instructions).toBe("You are a coding assistant.");
    expect(result.gems[0]!.predefined).toBe(false);
    expect(result.gems[1]!.id).toBe("gem-002");
    expect(result.gems[1]!.name).toBe("Blog Draft Writer");
  });

  // ── Empty gem list ─────────────────────────────────────

  it("succeeds with 0 gems when user has no custom gems", async () => {
    const responseText = makeGemListResponse([]);
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    expect(result.success).toBe(true);
    expect(result.gems).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // ── Session failure ────────────────────────────────────
  // NOTE: The extractor caches its session at module scope.
  // After any successful extraction, cachedSession is set and
  // session-init errors won't fire. These tests verify the
  // batchexecute error path instead (equally important).

  it("returns failure when batchexecute returns 403", async () => {
    setupFetch(undefined, { ok: false, status: 403 });

    const result = await extractGems();

    expect(result.success).toBe(false);
    expect(result.gems).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns failure when batchexecute returns 500", async () => {
    setupFetch(undefined, { ok: false, status: 500 });

    const result = await extractGems();

    expect(result.success).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ── batchexecute errors ────────────────────────────────

  it("handles batchexecute HTTP error", async () => {
    setupFetch(undefined, { ok: false, status: 500 });

    const result = await extractGems();

    expect(result.success).toBe(false);
    expect(result.warnings[0]!.context).toBe("batchexecute");
  });

  it("retries on 401 with session refresh", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/app")) {
          return {
            ok: true,
            text: async () => MOCK_GEMINI_HTML,
          };
        }

        if (urlStr.includes("batchexecute")) {
          callCount++;
          if (callCount === 1) {
            // First call fails with 401
            return { ok: false, status: 401, statusText: "Unauthorized" };
          }
          // Second call succeeds after refresh
          const gems = [
            ["gem-retry", ["Retry Gem", "After refresh"], ["Works now"]],
          ];
          return {
            ok: true,
            text: async () => makeGemListResponse(gems),
          };
        }

        throw new Error(`Unexpected fetch: ${urlStr}`);
      }),
    );

    const result = await extractGems();

    expect(result.success).toBe(true);
    expect(result.gems).toHaveLength(1);
    expect(result.gems[0]!.id).toBe("gem-retry");
  });

  it("retries on 400 with session refresh", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/app")) {
          return {
            ok: true,
            text: async () => MOCK_GEMINI_HTML,
          };
        }

        if (urlStr.includes("batchexecute")) {
          callCount++;
          if (callCount === 1) {
            return { ok: false, status: 400, statusText: "Bad Request" };
          }
          return {
            ok: true,
            text: async () => makeGemListResponse([]),
          };
        }

        throw new Error(`Unexpected fetch: ${urlStr}`);
      }),
    );

    const result = await extractGems();

    expect(result.success).toBe(true);
    expect(result.gems).toHaveLength(0);
  });

  // ── Malformed response ─────────────────────────────────

  it("handles empty batchexecute response", async () => {
    setupFetch(undefined, { ok: true, text: ")]}'\n" });

    const result = await extractGems();

    // No frames → no custom frame found
    expect(result.success).toBe(false);
    expect(result.warnings.some((w) => w.message.includes("No response frame"))).toBe(
      true,
    );
  });

  it("handles response with wrong identifier", async () => {
    const body = [null, null, [], null];
    const responseText = buildBatchResponseText("CNgdBe", body, "system");
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    // Frame exists but identifier is "system", not "custom"
    expect(result.warnings.some((w) => w.message.includes("No response frame"))).toBe(
      true,
    );
  });

  it("handles gem entry with missing name", async () => {
    const gems = [
      ["gem-no-name", [null, "Description"], ["Instructions"]],
      ["gem-with-name", ["Valid Gem", "Desc"], ["Instr"]],
    ];
    const responseText = makeGemListResponse(gems);
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    // Should skip the nameless gem with a warning
    expect(result.gems).toHaveLength(1);
    expect(result.gems[0]!.id).toBe("gem-with-name");
    expect(result.warnings.some((w) => w.message.includes("no name"))).toBe(true);
  });

  it("handles gem entry with missing ID", async () => {
    const gems = [
      [null, ["No ID Gem", "Desc"], ["Instr"]],
      ["gem-valid", ["Valid Gem", "Desc"], ["Instr"]],
    ];
    const responseText = makeGemListResponse(gems);
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    expect(result.gems).toHaveLength(1);
    expect(result.gems[0]!.id).toBe("gem-valid");
    expect(result.warnings.some((w) => w.message.includes("invalid gem ID"))).toBe(true);
  });

  it("handles gem entry with null prompt array", async () => {
    const gems = [["gem-no-prompt", ["No Prompt", "Desc"], null]];
    const responseText = makeGemListResponse(gems);
    setupFetch(undefined, { ok: true, text: responseText });

    const result = await extractGems();

    expect(result.gems).toHaveLength(1);
    expect(result.gems[0]!.instructions).toBe("");
  });

  // ── Message handler registration ───────────────────────

  it("registers GEMINI_EXTRACT_GEMS handler", () => {
    expect(registeredHandlers.has("GEMINI_EXTRACT_GEMS")).toBe(true);
  });

  it("registers PING handler", () => {
    expect(registeredHandlers.has("PING")).toBe(true);
  });
});

// ─── Manifest Generation from Gems ──────────────────────────

describe("generateGeminiManifest", () => {
  const sampleGems: ExtractedGem[] = [
    {
      id: "gem-001",
      name: "Code Helper",
      description: "Helps with coding",
      instructions: "You are a coding assistant that helps debug and review code.",
      predefined: false,
    },
    {
      id: "gem-002",
      name: "Blog Draft Writer",
      description: "Helps draft blog articles",
      instructions: "You are a writing assistant that helps draft blog articles and proofread content.",
      predefined: false,
    },
  ];

  it("produces a valid PortsmithManifest (Zod validation)", () => {
    const manifest = generateGeminiManifest(sampleGems);
    const result = PortsmithManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("sets correct source platform", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.source.platform).toBe("gemini");
    expect(manifest.source.exportMethod).toBe("api");
  });

  it("creates workspaces from gems", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.workspaces).toHaveLength(2);
    expect(manifest.workspaces[0]!.name).toBe("Code Helper");
    expect(manifest.workspaces[0]!.instructions.raw).toBe(
      "You are a coding assistant that helps debug and review code.",
    );
    expect(manifest.workspaces[0]!.id).toBe("ws-gem-gem-001");
  });

  it("categorizes workspaces based on content", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.workspaces[0]!.category).toBe("coding");
    expect(manifest.workspaces[1]!.category).toBe("writing");
  });

  it("tags workspaces with gemini-gem", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.workspaces[0]!.tags).toContain("gemini-gem");
  });

  it("filters out predefined gems", () => {
    const gemsWithPredefined: ExtractedGem[] = [
      ...sampleGems,
      {
        id: "gem-predefined",
        name: "Predefined Gem",
        description: "System gem",
        instructions: "System instructions",
        predefined: true,
      },
    ];
    const manifest = generateGeminiManifest(gemsWithPredefined);
    expect(manifest.workspaces).toHaveLength(2);
    expect(manifest.workspaces.every((w) => !w.id.includes("predefined"))).toBe(
      true,
    );
  });

  it("handles empty gem list", () => {
    const manifest = generateGeminiManifest([]);
    const result = PortsmithManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    expect(manifest.workspaces).toHaveLength(0);
  });

  it("sets empty memory and globalInstructions", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.memory).toEqual([]);
    expect(manifest.globalInstructions).toBe("");
  });

  it("sets metadata generatedBy", () => {
    const manifest = generateGeminiManifest(sampleGems);
    expect(manifest.metadata.generatedBy).toBe(`portsmith/${APP_VERSION}`);
  });
});
