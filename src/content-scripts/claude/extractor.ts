// ─── Claude Project Extractor ──────────────────────────────────
// Content script that runs on claude.ai.
// Extracts Project configurations via Claude's internal API.
//
// Auth is cookie-based — same-origin fetch from claude.ai
// includes cookies automatically. Org ID is read from the
// lastActiveOrg cookie (same pattern as the Claude importer).

import { onMessage, initMessageRouter } from "@/shared/messaging";
import type {
  ClaudeExtractionResult,
  ExtractedClaudeProject,
} from "@/core/adapters/claude-dom-types";

// ─── Auth (same pattern as importer.ts) ────────────────────────

function getOrgId(): string | null {
  const match = document.cookie.match(/lastActiveOrg=([^;]+)/);
  return match?.[1] ?? null;
}

// ─── Extraction ────────────────────────────────────────────────

async function extractProjects(): Promise<ClaudeExtractionResult> {
  const warnings: ClaudeExtractionResult["warnings"] = [];

  const orgId = getOrgId();
  if (!orgId) {
    return {
      success: false,
      projects: [],
      warnings: [
        {
          context: "auth",
          message:
            "Not logged in to Claude — no organization ID found in cookies",
        },
      ],
    };
  }

  try {
    const resp = await fetch(`/api/organizations/${orgId}/projects`, {
      headers: { "Content-Type": "application/json" },
    });

    if (resp.status === 401 || resp.status === 403) {
      return {
        success: false,
        projects: [],
        warnings: [
          {
            context: "auth",
            message:
              "Session expired or unauthorized. Please log in to claude.ai and try again.",
          },
        ],
      };
    }

    if (!resp.ok) {
      return {
        success: false,
        projects: [],
        warnings: [
          {
            context: "api",
            message: `Failed to fetch projects: HTTP ${resp.status}`,
          },
        ],
      };
    }

    const data: unknown = await resp.json();

    if (!Array.isArray(data)) {
      return {
        success: false,
        projects: [],
        warnings: [
          {
            context: "api",
            message:
              "Unexpected response format — expected an array of projects",
          },
        ],
      };
    }

    const projects: ExtractedClaudeProject[] = [];

    for (const raw of data as Array<Record<string, unknown>>) {
      const uuid = raw.uuid;
      const name = raw.name;

      if (typeof uuid !== "string" || !uuid || typeof name !== "string" || !name) {
        warnings.push({
          context: "parse",
          message: "Skipping project with missing uuid or name",
        });
        continue;
      }

      projects.push({
        id: uuid,
        name,
        description: typeof raw.description === "string" ? raw.description : "",
        instructions:
          typeof raw.prompt_template === "string" ? raw.prompt_template : "",
        createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
        updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "",
      });
    }

    if (projects.length === 0 && data.length === 0) {
      warnings.push({
        context: "api",
        message: "No projects found in your Claude account",
      });
    }

    return { success: true, projects, warnings };
  } catch (err) {
    return {
      success: false,
      projects: [],
      warnings: [
        {
          context: "api",
          message:
            err instanceof Error ? err.message : "Failed to fetch projects",
        },
      ],
    };
  }
}

// ─── Message Handlers ──────────────────────────────────────────

initMessageRouter();

onMessage("CLAUDE_EXTRACT_PROJECTS", async () => {
  return extractProjects();
});

onMessage("PING", () => {
  return { pong: true as const };
});

console.log("[PortSmith] Claude extractor content script loaded");
