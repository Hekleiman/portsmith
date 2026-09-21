import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatGPTProjectSummary } from "@/content-scripts/chatgpt/api";

// ─── Mocks ──────────────────────────────────────────────────

const { handlers, listProjectSummariesMock } = vi.hoisted(() => {
  // Set before the extractor module is imported: its init() reads
  // window.location at module scope. A DOM with nothing in it, so the
  // tests prove discovery does not depend on any of it.
  vi.stubGlobal("document", {
    cookie: "",
    querySelector: () => null,
    querySelectorAll: () => [],
    evaluate: () => ({ snapshotLength: 0, snapshotItem: () => null }),
    body: { innerText: "" },
  });
  vi.stubGlobal("window", {
    location: { href: "https://chatgpt.com/", pathname: "/" },
  });
  vi.stubGlobal("navigator", { language: "en-US" });

  return {
    handlers: new Map<string, (payload: unknown) => unknown>(),
    listProjectSummariesMock: vi.fn(),
  };
});

vi.mock("@/shared/messaging", () => ({
  initMessageRouter: vi.fn(),
  onMessage: vi.fn((name: string, handler: (payload: unknown) => unknown) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
  sendMessage: vi.fn(async (name: string, payload: Record<string, unknown>) => {
    if (name === "FETCH_GIZMO_API") {
      const gizmoId = payload.gizmoId as string;
      return {
        gizmo: { instructions: `instructions for ${gizmoId}`, display: {} },
        files: [],
      };
    }
    return undefined;
  }),
}));

// The API module is the discovery source under test; getAccessToken also
// stands in for the login check, so no DOM is needed to pass it.
vi.mock("@/content-scripts/chatgpt/api", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
  listProjectSummaries: listProjectSummariesMock,
}));

import {
  extractProjects,
  scanSidebar,
} from "@/content-scripts/chatgpt/extractor";

const P1 = "g-p-" + "a".repeat(32);
const P2 = "g-p-" + "b".repeat(32);

function summaries(...items: ChatGPTProjectSummary[]): ChatGPTProjectSummary[] {
  return items;
}

beforeEach(() => {
  listProjectSummariesMock.mockReset();
});

// ─── extractProjects ────────────────────────────────────────

describe("extractProjects discovery", () => {
  it("returns the projects the API lists, with an empty DOM", async () => {
    listProjectSummariesMock.mockResolvedValue(
      summaries(
        { gizmoId: P1, name: "Trip planning" },
        { gizmoId: P2, name: "Tax 2026" },
      ),
    );

    const result = await extractProjects();

    expect(result.success).toBe(true);
    expect(result.projects.map((p) => p.name)).toEqual([
      "Trip planning",
      "Tax 2026",
    ]);
    expect(result.projects.map((p) => p.id)).toEqual([P1, P2]);
  });

  it("collapses duplicate gizmo IDs", async () => {
    listProjectSummariesMock.mockResolvedValue(
      summaries(
        { gizmoId: P1, name: "Trip planning" },
        { gizmoId: P1, name: "Trip planning" },
        { gizmoId: P2, name: "Tax 2026" },
      ),
    );

    const result = await extractProjects();

    expect(result.projects).toHaveLength(2);
    expect(result.projects.map((p) => p.id)).toEqual([P1, P2]);
  });

  it("warns with the real cause when the listing fails, and never blames the sidebar", async () => {
    listProjectSummariesMock.mockRejectedValue(new Error("HTTP 403: forbidden"));

    const result = await extractProjects();

    expect(result.success).toBe(false);
    expect(result.projects).toEqual([]);
    expect(result.warnings).toHaveLength(1);

    const message = result.warnings[0]?.message ?? "";
    expect(message).toContain("HTTP 403");
    expect(message.toLowerCase()).not.toContain("sidebar");
    expect(message.toLowerCase()).not.toContain("collapsed");
  });

  it("says the account has no projects when the listing is empty", async () => {
    listProjectSummariesMock.mockResolvedValue([]);

    const result = await extractProjects();

    expect(result.projects).toEqual([]);
    const message = result.warnings[0]?.message ?? "";
    expect(message.toLowerCase()).not.toContain("sidebar");
    expect(message).toContain("no projects");
  });
});

// ─── scanSidebar ────────────────────────────────────────────

describe("scanSidebar", () => {
  it("finds projects with no project links in the DOM", async () => {
    listProjectSummariesMock.mockResolvedValue(
      summaries({ gizmoId: P1, name: "Trip planning" }),
    );

    const scan = await scanSidebar();

    expect(scan.projects).toEqual([
      {
        id: P1,
        name: "Trip planning",
        url: `https://chatgpt.com/g/${P1}/project`,
      },
    ]);
  });

  it("collapses duplicate gizmo IDs", async () => {
    listProjectSummariesMock.mockResolvedValue(
      summaries(
        { gizmoId: P1, name: "Trip planning" },
        { gizmoId: P1, name: "Trip planning" },
      ),
    );
    expect(await scanSidebar()).toMatchObject({ projects: [{ id: P1 }] });
  });

  it("returns no projects, rather than throwing, when the listing fails", async () => {
    listProjectSummariesMock.mockRejectedValue(new Error("HTTP 401"));
    const scan = await scanSidebar();
    expect(scan.projects).toEqual([]);
    expect(scan.gpts).toEqual([]);
  });
});
