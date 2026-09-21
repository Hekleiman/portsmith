import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  chatgptRequest,
  getAccessToken,
  clearAccessToken,
  isProjectGizmoId,
  listProjectSummaries,
  nameKey,
  ChatGPTApiError,
} from "@/content-scripts/chatgpt/api";

// ─── Fetch harness ──────────────────────────────────────────

interface StubResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Minimal stand-in for the fields chatgptRequest reads off a Response. */
function makeResponse({ status, body, headers = {} }: StubResponse): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body === undefined ? "" : text),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const PROJECT_ID = "g-p-" + "a".repeat(32);
const OTHER_PROJECT_ID = "g-p-" + "b".repeat(32);

/** A session response carrying a placeholder token (never a real one). */
function sessionResponse(token = "test-token"): Response {
  return makeResponse({ status: 200, body: { accessToken: token } });
}

let calls: Array<{ url: string; init: RequestInit }>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearAccessToken();
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return fetchMock(url, init) as Promise<Response>;
  });
  vi.stubGlobal("document", { cookie: "oai-did=device-abc" });
  vi.stubGlobal("navigator", { language: "en-GB" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAccessToken();
});

/** Queues responses in order, one per fetch call. */
function queue(...responses: Response[]): void {
  let i = 0;
  fetchMock.mockImplementation(() => {
    const resp = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(resp);
  });
}

function headerOf(call: { init: RequestInit }, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

// ─── getAccessToken ─────────────────────────────────────────

describe("getAccessToken", () => {
  it("reads the token from the session endpoint and caches it", async () => {
    queue(sessionResponse());
    expect(await getAccessToken()).toBe("test-token");
    expect(await getAccessToken()).toBe("test-token");
    expect(calls.filter((c) => c.url === "/api/auth/session")).toHaveLength(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    queue(sessionResponse());
    await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    expect(calls.filter((c) => c.url === "/api/auth/session")).toHaveLength(1);
  });

  it("re-reads the session when forceRefresh is set", async () => {
    queue(sessionResponse("first"), sessionResponse("second"));
    expect(await getAccessToken()).toBe("first");
    expect(await getAccessToken(true)).toBe("second");
  });

  it("throws without echoing the session body, which holds the token", async () => {
    queue(makeResponse({ status: 200, body: { accessToken: "" } }));
    await expect(getAccessToken()).rejects.toThrow(ChatGPTApiError);
  });
});

// ─── chatgptRequest ─────────────────────────────────────────

describe("chatgptRequest", () => {
  it("attaches the bearer token and the oai-* headers", async () => {
    queue(sessionResponse(), makeResponse({ status: 200, body: { ok: true } }));
    await chatgptRequest("/backend-api/thing");

    const call = calls[1] as { init: RequestInit };
    expect(headerOf(call, "Authorization")).toBe("Bearer test-token");
    expect(headerOf(call, "oai-device-id")).toBe("device-abc");
    expect(headerOf(call, "oai-language")).toBe("en-GB");
    expect(call.init.credentials).toBe("include");
  });

  it("sets Content-Type for string bodies only, so FormData keeps its boundary", async () => {
    queue(sessionResponse(), makeResponse({ status: 200, body: {} }));
    await chatgptRequest("/backend-api/thing", { method: "POST", body: "{}" });
    expect(headerOf(calls[1] as { init: RequestInit }, "Content-Type")).toBe(
      "application/json",
    );

    clearAccessToken();
    calls = [];
    queue(sessionResponse(), makeResponse({ status: 200, body: {} }));
    const form = new FormData();
    await chatgptRequest("/backend-api/thing", { method: "POST", body: form });
    expect(
      headerOf(calls[1] as { init: RequestInit }, "Content-Type"),
    ).toBeUndefined();
  });

  it("returns undefined for 204", async () => {
    queue(sessionResponse(), makeResponse({ status: 204 }));
    expect(await chatgptRequest("/backend-api/thing")).toBeUndefined();
  });

  it("retries 429 honouring retry-after, capped at 10 s", async () => {
    vi.useFakeTimers();
    queue(
      sessionResponse(),
      makeResponse({ status: 429, headers: { "retry-after": "2" } }),
      makeResponse({ status: 429, headers: { "retry-after": "999" } }),
      makeResponse({ status: 200, body: { ok: true } }),
    );

    const pending = chatgptRequest<{ ok: boolean }>("/backend-api/thing");

    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(2); // still waiting out the 2 s retry-after
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(9999);
    expect(calls).toHaveLength(3); // 999 s was capped to 10 s
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(await pending).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });

  it("throws after the 429 retries run out", async () => {
    vi.useFakeTimers();
    queue(sessionResponse(), makeResponse({ status: 429, body: "slow down" }));

    const pending = chatgptRequest("/backend-api/thing", {}, 1);
    const assertion = expect(pending).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("refreshes the token once on 401, retries, then throws on a second 401", async () => {
    queue(
      sessionResponse("stale"),
      makeResponse({ status: 401, body: "expired" }),
      sessionResponse("fresh"),
      makeResponse({ status: 401, body: "still expired" }),
    );

    await expect(chatgptRequest("/backend-api/thing")).rejects.toMatchObject({
      status: 401,
    });

    const sessionCalls = calls.filter((c) => c.url === "/api/auth/session");
    const apiCalls = calls.filter((c) => c.url === "/backend-api/thing");
    expect(sessionCalls).toHaveLength(2); // one initial read, exactly one refresh
    expect(apiCalls).toHaveLength(2); // the original and one retry
    expect(headerOf(apiCalls[0] as { init: RequestInit }, "Authorization")).toBe(
      "Bearer stale",
    );
    expect(headerOf(apiCalls[1] as { init: RequestInit }, "Authorization")).toBe(
      "Bearer fresh",
    );
  });

  it("succeeds when the refreshed token works", async () => {
    queue(
      sessionResponse("stale"),
      makeResponse({ status: 401 }),
      sessionResponse("fresh"),
      makeResponse({ status: 200, body: { ok: true } }),
    );
    expect(await chatgptRequest("/backend-api/thing")).toEqual({ ok: true });
  });
});

// ─── isProjectGizmoId ───────────────────────────────────────

describe("isProjectGizmoId", () => {
  it("accepts a project ID", () => {
    expect(isProjectGizmoId(PROJECT_ID)).toBe(true);
  });

  it("rejects a g- ID that is not a project", () => {
    expect(isProjectGizmoId("g-abc123XYZ")).toBe(false);
    expect(isProjectGizmoId("g-p-" + "a".repeat(31))).toBe(false);
    expect(isProjectGizmoId(`${PROJECT_ID}-trip-planning`)).toBe(false);
    expect(isProjectGizmoId("g-p-" + "z".repeat(32))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isProjectGizmoId(undefined)).toBe(false);
    expect(isProjectGizmoId(null)).toBe(false);
    expect(isProjectGizmoId(42)).toBe(false);
  });
});

// ─── listProjectSummaries ───────────────────────────────────

function sidebarItem(id: string, name: string): unknown {
  return { gizmo: { id, display: { name } }, files: [], tools: [] };
}

describe("listProjectSummaries", () => {
  it("filters non-project gizmos out", async () => {
    queue(
      sessionResponse(),
      makeResponse({
        status: 200,
        body: {
          items: [
            sidebarItem(PROJECT_ID, "Trip planning"),
            sidebarItem("g-abc123XYZ", "A custom GPT"),
            sidebarItem(OTHER_PROJECT_ID, "Tax 2026"),
            { gizmo: { id: PROJECT_ID } }, // no display block
            { notAGizmo: true },
          ],
          cursor: null,
        },
      }),
    );

    expect(await listProjectSummaries()).toEqual([
      { gizmoId: PROJECT_ID, name: "Trip planning" },
      { gizmoId: OTHER_PROJECT_ID, name: "Tax 2026" },
    ]);
  });

  it("follows the cursor until it comes back empty", async () => {
    queue(
      sessionResponse(),
      makeResponse({
        status: 200,
        body: { items: [sidebarItem(PROJECT_ID, "One")], cursor: "page-2" },
      }),
      makeResponse({
        status: 200,
        body: { items: [sidebarItem(OTHER_PROJECT_ID, "Two")], cursor: null },
      }),
    );

    const summaries = await listProjectSummaries();
    expect(summaries.map((s) => s.name)).toEqual(["One", "Two"]);

    const sidebarCalls = calls.filter((c) => c.url.includes("/sidebar"));
    expect(sidebarCalls).toHaveLength(2);
    expect(sidebarCalls[0]?.url).toContain("owned_only=true");
    expect(sidebarCalls[0]?.url).not.toContain("cursor=");
    expect(sidebarCalls[1]?.url).toContain("cursor=page-2");
  });

  it("drops duplicates that span pages", async () => {
    queue(
      sessionResponse(),
      makeResponse({
        status: 200,
        body: { items: [sidebarItem(PROJECT_ID, "One")], cursor: "page-2" },
      }),
      makeResponse({
        status: 200,
        body: { items: [sidebarItem(PROJECT_ID, "One")], cursor: null },
      }),
    );
    expect(await listProjectSummaries()).toHaveLength(1);
  });

  it("returns an empty list when the response has no items array", async () => {
    queue(sessionResponse(), makeResponse({ status: 200, body: { cursor: null } }));
    expect(await listProjectSummaries()).toEqual([]);
  });
});

// ─── nameKey ────────────────────────────────────────────────

describe("nameKey", () => {
  it("trims, collapses whitespace and lowercases", () => {
    expect(nameKey("  Trip   Planning\n")).toBe("trip planning");
    expect(nameKey("TAX 2026")).toBe("tax 2026");
    expect(nameKey("a\tb")).toBe("a b");
  });
});
