import { describe, it, expect, vi, afterEach } from "vitest";
import {
  batchExecute,
  encodeRequest,
  decodeResponse,
  extractResponseBody,
  getFrameIdentifier,
  type GeminiSession,
  type RPCPayload,
} from "@/content-scripts/gemini/batchexecute";
import { accountPrefix } from "@/content-scripts/gemini/session";

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Build a batchexecute response with the security prefix and
 * length-prefixed framing. All content is ASCII so UTF-16 units = chars.
 */
function buildBatchResponse(...frameArrays: unknown[][]): string {
  let body = "";
  for (const frame of frameArrays) {
    const json = JSON.stringify(frame);
    // Length includes the \n before the JSON (counted in the protocol)
    const length = 1 + json.length;
    body += `${length}\n${json}\n`;
  }
  return `)]}'\n\n${body}`;
}

/**
 * Build a response envelope for a single RPC result.
 */
function buildEnvelope(
  rpcid: string,
  bodyData: unknown,
  identifier: string,
): unknown[] {
  return [rpcid, null, JSON.stringify(bodyData), null, null, null, identifier];
}

// ─── encodeRequest ───────────────────────────────────────────

describe("encodeRequest", () => {
  it("serializes a single RPC payload", () => {
    const payloads: RPCPayload[] = [
      { rpcid: "CNgdBe", payload: '[2,["en"],0]', identifier: "custom" },
    ];
    const result = encodeRequest(payloads);
    const parsed = JSON.parse(result) as unknown;

    expect(parsed).toEqual([
      [["CNgdBe", '[2,["en"],0]', null, "custom"]],
    ]);
  });

  it("serializes multiple RPC payloads in a batch", () => {
    const payloads: RPCPayload[] = [
      { rpcid: "CNgdBe", payload: '[3,["en"],0]', identifier: "system" },
      { rpcid: "CNgdBe", payload: '[2,["en"],0]', identifier: "custom" },
    ];
    const result = encodeRequest(payloads);
    const parsed = JSON.parse(result) as unknown;

    expect(parsed).toEqual([
      [
        ["CNgdBe", '[3,["en"],0]', null, "system"],
        ["CNgdBe", '[2,["en"],0]', null, "custom"],
      ],
    ]);
  });

  it("uses 'generic' as default identifier", () => {
    const payloads: RPCPayload[] = [
      { rpcid: "oMH3Zd", payload: "[[]]" },
    ];
    const result = encodeRequest(payloads);
    const parsed = JSON.parse(result) as unknown;

    expect(parsed).toEqual([[["oMH3Zd", "[[]]", null, "generic"]]]);
  });

  it("produces a create-gem payload matching the docs", () => {
    const innerPayload = JSON.stringify([
      [
        "My Gem",
        "A helpful assistant",
        "You are...",
        null, null, null, null, null,
        0, null, 1, null, null, null, [],
      ],
    ]);
    const payloads: RPCPayload[] = [
      { rpcid: "oMH3Zd", payload: innerPayload },
    ];
    const result = encodeRequest(payloads);
    const parsed = JSON.parse(result) as unknown[][];
    const rpc = parsed[0]![0] as unknown[];

    expect(rpc[0]).toBe("oMH3Zd");
    expect(rpc[2]).toBeNull();
    expect(rpc[3]).toBe("generic");

    // Verify inner payload structure
    const inner = JSON.parse(rpc[1] as string) as unknown[][];
    expect(inner[0]).toHaveLength(15); // create = 15 elements
  });

  it("produces an update-gem payload with 16-element inner array", () => {
    const innerPayload = JSON.stringify([
      "gem-id-here",
      [
        "New Name", "New Desc", "New prompt...",
        null, null, null, null, null,
        0, null, 1, null, null, null, [], 0,
      ],
    ]);
    const payloads: RPCPayload[] = [
      { rpcid: "kHv0Vd", payload: innerPayload },
    ];
    const result = encodeRequest(payloads);
    const parsed = JSON.parse(result) as unknown[][];
    const rpc = parsed[0]![0] as unknown[];
    const inner = JSON.parse(rpc[1] as string) as unknown[];

    expect(inner[0]).toBe("gem-id-here");
    expect(inner[1]).toHaveLength(16); // update = 16 elements (extra trailing 0)
  });
});

// ─── decodeResponse ──────────────────────────────────────────

describe("decodeResponse", () => {
  it("parses a single-frame response with security prefix", () => {
    const envelope = buildEnvelope("CNgdBe", [null, null, [], null], "custom");
    const raw = buildBatchResponse([envelope]);
    const frames = decodeResponse(raw);

    expect(frames).toHaveLength(1);
    expect(Array.isArray(frames[0])).toBe(true);
    expect((frames[0] as unknown[])[0]).toBe("CNgdBe");
  });

  it("parses multiple frames", () => {
    const env1 = buildEnvelope("CNgdBe", [null], "system");
    const env2 = buildEnvelope("CNgdBe", [null], "custom");
    // Two separate length-prefixed frames
    const raw = buildBatchResponse([env1], [env2]);
    const frames = decodeResponse(raw);

    expect(frames.length).toBeGreaterThanOrEqual(2);
  });

  it("parses a response with gem list data", () => {
    const gems = [
      [
        "gem-abc-123",
        ["Code Helper", "Helps with coding"],
        ["You are a coding assistant."],
      ],
      [
        "gem-def-456",
        ["Writing Coach", "Improves your writing"],
        ["You are a writing coach."],
      ],
    ];
    const body = [null, null, gems, null];
    const envelope = buildEnvelope("CNgdBe", body, "custom");
    const raw = buildBatchResponse([envelope]);
    const frames = decodeResponse(raw);

    expect(frames).toHaveLength(1);
    const parsedBody = extractResponseBody(frames[0]);
    expect(parsedBody).not.toBeNull();

    const gemList = (parsedBody as unknown[])[2] as unknown[][];
    expect(gemList).toHaveLength(2);
    expect(gemList[0]![0]).toBe("gem-abc-123");
    expect(gemList[1]![0]).toBe("gem-def-456");
  });

  it("handles empty response text", () => {
    const frames = decodeResponse("");
    expect(frames).toEqual([]);
  });

  it("handles response with only the security prefix", () => {
    const frames = decodeResponse(")]}'\n");
    expect(frames).toEqual([]);
  });

  it("handles response without security prefix", () => {
    const json = JSON.stringify([["CNgdBe", null, "null", null, "test"]]);
    const length = 1 + json.length;
    const raw = `${length}\n${json}`;
    const frames = decodeResponse(raw);

    expect(frames).toHaveLength(1);
  });

  it("skips malformed JSON frames", () => {
    // Build a valid first frame
    const envelope = buildEnvelope("CNgdBe", [1], "ok");
    const validJson = JSON.stringify([envelope]);
    const validLength = 1 + validJson.length;

    // Build a malformed second frame
    const badJson = "{not valid json[";
    const badLength = 1 + badJson.length;

    const raw = `)]}'\n\n${validLength}\n${validJson}\n${badLength}\n${badJson}\n`;
    const frames = decodeResponse(raw);

    // Should get the valid frame, skip the bad one
    expect(frames.length).toBeGreaterThanOrEqual(1);
  });

  it("handles truncated frames gracefully", () => {
    // Claim a length much longer than the actual content
    const raw = `)]}'\n\n99999\nshort`;
    const frames = decodeResponse(raw);
    // Should not crash — breaks on incomplete frame
    expect(frames).toEqual([]);
  });

  it("handles zero-length frame", () => {
    // A frame with length 1 would just be the \n — empty after trim
    const raw = `)]}'\n\n1\n\n`;
    const frames = decodeResponse(raw);
    expect(frames).toEqual([]);
  });

  it("parses a pre-computed fixture response (matching fixture file format)", () => {
    // This mirrors the content of tests/fixtures/gemini-response-list-gems.txt
    // built using the exact frame length computation from the protocol
    const gems = [
      ["gem-abc-123", ["Code Helper", "Helps with coding"], ["You are a coding assistant that helps debug and review code."]],
      ["gem-def-456", ["Writing Coach", "Improves your writing"], ["You are a writing coach that provides feedback on grammar and style."]],
    ];
    const body = [null, null, gems, null];
    const envelope = buildEnvelope("CNgdBe", body, "custom");
    const raw = buildBatchResponse([envelope]);
    const frames = decodeResponse(raw);

    expect(frames.length).toBeGreaterThanOrEqual(1);

    // Find the frame with our custom identifier
    let foundCustom = false;
    for (const frame of frames) {
      const id = getFrameIdentifier(frame);
      if (id === "custom") {
        foundCustom = true;
        const parsedBody = extractResponseBody(frame);
        expect(parsedBody).not.toBeNull();
        const gemList = (parsedBody as unknown[])[2] as unknown[][];
        expect(gemList).toHaveLength(2);
        expect(gemList[0]![0]).toBe("gem-abc-123");
      }
    }
    expect(foundCustom).toBe(true);
  });
});

// ─── extractResponseBody ─────────────────────────────────────

describe("extractResponseBody", () => {
  it("extracts and parses the body at index 2", () => {
    const envelope = ["CNgdBe", null, '[1,2,3]', null, null, "custom"];
    const body = extractResponseBody(envelope);
    expect(body).toEqual([1, 2, 3]);
  });

  it("returns null for non-array input", () => {
    expect(extractResponseBody("string")).toBeNull();
    expect(extractResponseBody(42)).toBeNull();
    expect(extractResponseBody(null)).toBeNull();
    expect(extractResponseBody(undefined)).toBeNull();
  });

  it("returns null when index 2 is not a string", () => {
    expect(extractResponseBody(["a", "b", 123])).toBeNull();
    expect(extractResponseBody(["a", "b", null])).toBeNull();
  });

  it("returns null for invalid JSON at index 2", () => {
    expect(extractResponseBody(["a", "b", "{bad json"])).toBeNull();
  });

  it("parses nested JSON bodies", () => {
    const nestedBody = { key: "value", arr: [1, 2] };
    const envelope = ["rpc", null, JSON.stringify(nestedBody)];
    expect(extractResponseBody(envelope)).toEqual(nestedBody);
  });
});

// ─── getFrameIdentifier ─────────────────────────────────────

describe("getFrameIdentifier", () => {
  it("returns the last element when it is a string", () => {
    expect(getFrameIdentifier(["a", "b", "c", "custom"])).toBe("custom");
  });

  it("returns null for non-array input", () => {
    expect(getFrameIdentifier("string")).toBeNull();
    expect(getFrameIdentifier(42)).toBeNull();
    expect(getFrameIdentifier(null)).toBeNull();
  });

  it("returns null when last element is not a string", () => {
    expect(getFrameIdentifier([1, 2, 3])).toBeNull();
    expect(getFrameIdentifier(["a", "b", null])).toBeNull();
  });

  it("handles envelopes with varying lengths", () => {
    expect(getFrameIdentifier(["short"])).toBe("short");
    expect(
      getFrameIdentifier(["a", null, "body", null, null, null, "identifier"]),
    ).toBe("identifier");
  });
});

// ─── Round trip ──────────────────────────────────────────────

describe("encode → decode round trip", () => {
  it("encodes a list-gems request and decodes a realistic response", () => {
    // Encode
    const payloads: RPCPayload[] = [
      { rpcid: "CNgdBe", payload: '[2,["en"],0]', identifier: "custom" },
    ];
    const encoded = encodeRequest(payloads);

    // Verify encoding
    const parsed = JSON.parse(encoded) as unknown[][][];
    expect(parsed[0]![0]![0]).toBe("CNgdBe");

    // Build a realistic response
    const gems = [
      ["gem-1", ["Helper", "Desc"], ["Instructions here"]],
    ];
    const body = [null, null, gems, null];
    const envelope = buildEnvelope("CNgdBe", body, "custom");
    const response = buildBatchResponse([envelope]);

    // Decode
    const frames = decodeResponse(response);
    expect(frames).toHaveLength(1);

    const responseBody = extractResponseBody(frames[0]);
    expect(responseBody).not.toBeNull();

    const gemList = (responseBody as unknown[])[2] as unknown[][];
    expect(gemList).toHaveLength(1);
    expect(gemList[0]![0]).toBe("gem-1");
    expect(gemList[0]![1]).toEqual(["Helper", "Desc"]);
    expect(gemList[0]![2]).toEqual(["Instructions here"]);
  });

  it("handles a create-gem request → response cycle", () => {
    // Encode create request
    const innerPayload = JSON.stringify([
      ["Test Gem", "Test desc", "Be helpful", null, null, null, null, null, 0, null, 1, null, null, null, []],
    ]);
    const payloads: RPCPayload[] = [
      { rpcid: "oMH3Zd", payload: innerPayload },
    ];
    const encoded = encodeRequest(payloads);
    expect(encoded).toContain("oMH3Zd");

    // Build create response (returns gem ID at body[0])
    const createBody = ["new-gem-id-xyz", "Test Gem"];
    const envelope = buildEnvelope("oMH3Zd", createBody, "generic");
    const response = buildBatchResponse([envelope]);

    // Decode and extract gem ID
    const frames = decodeResponse(response);
    const responseBody = extractResponseBody(frames[0]) as unknown[];
    expect(responseBody[0]).toBe("new-gem-id-xyz");
  });
});

// ─── Account prefix ──────────────────────────────────────────

describe("accountPrefix", () => {
  it("finds a secondary account's prefix", () => {
    expect(accountPrefix("/u/1/app")).toBe("/u/1");
    expect(accountPrefix("/u/12/gems/view")).toBe("/u/12");
    expect(accountPrefix("/u/2")).toBe("/u/2");
  });

  it("is empty for the default account and look-alike paths", () => {
    expect(accountPrefix("/app")).toBe("");
    expect(accountPrefix("/")).toBe("");
    expect(accountPrefix("")).toBe("");
    expect(accountPrefix("/u/abc/app")).toBe("");
    expect(accountPrefix("/u/1x/app")).toBe("");
    expect(accountPrefix("/gem/u/1/app")).toBe("");
  });
});

describe("batchExecute URL", () => {
  const base: GeminiSession = { accessToken: "tok", buildLabel: "bl-1", sessionId: "sid-1", language: "en" };
  const ok = buildBatchResponse([buildEnvelope("CNgdBe", [null, null, [], null], "custom")]);
  const payloads: RPCPayload[] = [{ rpcid: "CNgdBe", payload: '[2,["en"],0]', identifier: "custom" }];

  function captureFetch(): Array<{ url: URL; body: URLSearchParams }> {
    const seen: Array<{ url: URL; body: URLSearchParams }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url: new URL(url), body: new URLSearchParams(String(init?.body)) });
        return new Response(ok, { status: 200 });
      }),
    );
    return seen;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the /u/1/ endpoint with a matching source-path", async () => {
    const seen = captureFetch();
    await batchExecute({ ...base, prefix: "/u/1" }, payloads);
    expect(seen[0]!.url.origin).toBe("https://gemini.google.com");
    expect(seen[0]!.url.pathname).toBe("/u/1/_/BardChatUi/data/batchexecute");
    expect(seen[0]!.url.searchParams.get("source-path")).toBe("/u/1/app");
    expect(seen[0]!.body.get("at")).toBe("tok");
  });

  it("is unchanged without a prefix", async () => {
    const seen = captureFetch();
    await batchExecute(base, payloads);
    await batchExecute({ ...base, prefix: "" }, payloads);
    for (const call of seen) {
      expect(call.url.pathname).toBe("/_/BardChatUi/data/batchexecute");
      expect(call.url.searchParams.get("source-path")).toBe("/app");
      expect(call.url.searchParams.get("rpcids")).toBe("CNgdBe");
      expect(call.url.searchParams.get("bl")).toBe("bl-1");
      expect(call.url.searchParams.get("f.sid")).toBe("sid-1");
    }
  });
});
