// ─── Claude Project Extractor ──────────────────────────────────
// Content script that runs on claude.ai.
// Extracts Project configurations, knowledge docs and project memory
// via Claude's internal API.
//
// API notes (verified against claude.ai, Sep 2026):
// - GET /projects no longer includes prompt_template, so instructions come
//   from GET /projects/{id}. The list supports limit/offset.
// - Project memory lives in memory files under /projects/{id}/, read with
//   POST /melange/list and POST /melange/read. Accounts on the older memory
//   system expose a per-project summary at GET /memory?project_uuid=.
// - GET /projects/{id}/docs returns text knowledge docs with content;
//   GET /projects/{id}/files lists binary uploads (metadata only).

import { onMessage, initMessageRouter, sendMessage } from "@/shared/messaging";
import type {
  ClaudeExtractionOptions,
  ClaudeExtractionResult,
  ExtractedClaudeDoc,
  ExtractedClaudeFileRef,
  ExtractedClaudeMemoryEntry,
  ExtractedClaudeProject,
} from "@/core/adapters/claude-dom-types";
import { getMimeType } from "@/core/transform/file-compatibility";
import { textToBase64 } from "@/shared/encoding";
import {
  ClaudeApiError,
  claudeRequest,
  getOrgId,
  isUuid,
  mapWithConcurrency,
} from "./api";

type Warning = ClaudeExtractionResult["warnings"][number];

const PAGE_SIZE = 100;
const MAX_PROJECTS = 5000;
const CONCURRENCY = 4;
const MAX_DOC_BYTES = 5_000_000;

const DEFAULT_OPTIONS: ClaudeExtractionOptions = {
  includeMemory: true,
  includeKnowledge: true,
};

type RawRecord = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function progress(step: string, percent: number): void {
  sendMessage("EXTRACT_PROGRESS", { step, percent: Math.round(percent) }).catch(
    () => {
      // Nobody listening (side panel closed); extraction continues.
    },
  );
}

// ─── Project list & details ────────────────────────────────────

export async function listAllProjects(orgId: string): Promise<RawRecord[]> {
  const all: RawRecord[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < MAX_PROJECTS; offset += PAGE_SIZE) {
    const page = await claudeRequest<unknown>(
      `/api/organizations/${orgId}/projects?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (!Array.isArray(page)) {
      throw new Error(
        "Unexpected response format: expected an array of projects",
      );
    }

    let added = 0;
    for (const raw of page as RawRecord[]) {
      const id = str(raw.uuid);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(raw);
      added++;
    }
    // Stop on a short page, or if the server ignored the offset.
    if (page.length < PAGE_SIZE || added === 0) break;
  }

  return all;
}

// ─── Knowledge ─────────────────────────────────────────────────

async function fetchProjectDocs(
  orgId: string,
  project: { id: string; name: string },
  warnings: Warning[],
): Promise<ExtractedClaudeDoc[]> {
  const docs = await claudeRequest<unknown>(
    `/api/organizations/${orgId}/projects/${project.id}/docs`,
  );
  if (!Array.isArray(docs)) return [];

  const results: ExtractedClaudeDoc[] = [];
  for (const raw of docs as RawRecord[]) {
    const uuid = str(raw.uuid);
    const fileName = str(raw.file_name) || "document.txt";
    const content = str(raw.content);
    if (!uuid) continue;

    const bytes = new TextEncoder().encode(content).length;
    const mimeType = fileName.includes(".")
      ? getMimeType(fileName)
      : "text/plain";
    const doc: ExtractedClaudeDoc = { uuid, fileName, mimeType, sizeBytes: bytes };

    if (bytes > MAX_DOC_BYTES) {
      warnings.push({
        context: "knowledge",
        message: `"${fileName}" in "${project.name}" is larger than 5 MB and was not copied`,
      });
      results.push(doc);
      continue;
    }

    try {
      const stored = await sendMessage("STORE_DOWNLOADED_FILE", {
        fileId: `claude-doc-${uuid}`,
        blob: textToBase64(content),
        mimeType: mimeType === "application/octet-stream" ? "text/plain" : mimeType,
        fileName,
      });
      if (stored?.contentRef) {
        doc.contentRef = stored.contentRef;
      } else {
        warnings.push({
          context: "knowledge",
          message: `Could not save "${fileName}" from "${project.name}": ${stored?.error ?? "unknown error"}`,
        });
      }
    } catch (err) {
      warnings.push({
        context: "knowledge",
        message: `Could not save "${fileName}" from "${project.name}": ${errorMessage(err)}`,
      });
    }
    results.push(doc);
  }
  return results;
}

async function fetchProjectFiles(
  orgId: string,
  projectId: string,
): Promise<ExtractedClaudeFileRef[]> {
  const files = await claudeRequest<unknown>(
    `/api/organizations/${orgId}/projects/${projectId}/files`,
  );
  if (!Array.isArray(files)) return [];
  return (files as RawRecord[])
    .map((f) => ({
      uuid: str(f.file_uuid) || str(f.uuid),
      fileName: str(f.file_name) || "file",
      kind: str(f.file_kind),
    }))
    .filter((f) => f.uuid);
}

// ─── Project memory ────────────────────────────────────────────

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function titleFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const base = file.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Notes";
}

export function toMemoryEntry(
  path: string,
  raw: RawRecord,
): ExtractedClaudeMemoryEntry | null {
  const parsed = (raw.parsed ?? {}) as RawRecord;
  const body = (
    typeof parsed.body === "string"
      ? parsed.body
      : stripFrontmatter(str(raw.content))
  ).trim();
  const summary = str(parsed.description).trim();
  if (!body && !summary) return null;

  return {
    path,
    title: str(parsed.name).trim() || str(raw.display_name).trim() || titleFromPath(path),
    summary,
    body,
    updatedAt: str(raw.updated_at),
  };
}

const PROJECT_MEMORY_PATH = /^\/projects\/([0-9a-f-]{36})\//i;

async function fetchMemoryEntries(
  orgId: string,
  projectIds: Set<string>,
  warnings: Warning[],
): Promise<Map<string, ExtractedClaudeMemoryEntry[]>> {
  const byProject = new Map<string, ExtractedClaudeMemoryEntry[]>();

  const list = await claudeRequest<RawRecord>(
    `/api/organizations/${orgId}/melange/list`,
    { method: "POST", body: "{}" },
  );
  const data = Array.isArray(list?.data) ? (list.data as RawRecord[]) : [];

  const wanted: Array<{ projectId: string; path: string }> = [];
  for (const entry of data) {
    const path = str(entry.path);
    const match = PROJECT_MEMORY_PATH.exec(path);
    const projectId = match?.[1]?.toLowerCase();
    if (projectId && projectIds.has(projectId)) {
      wanted.push({ projectId, path });
    }
  }

  let failed = 0;
  let done = 0;
  await mapWithConcurrency(wanted, CONCURRENCY, async ({ projectId, path }) => {
    try {
      const raw = await claudeRequest<RawRecord>(
        `/api/organizations/${orgId}/melange/read`,
        { method: "POST", body: JSON.stringify({ path }) },
      );
      const entry = toMemoryEntry(path, raw ?? {});
      if (entry) {
        const list = byProject.get(projectId) ?? [];
        list.push(entry);
        byProject.set(projectId, list);
      }
    } catch {
      failed++;
    }
    done++;
    if (done % 10 === 0 || done === wanted.length) {
      progress(`Read ${done} of ${wanted.length} memory notes`, 80 + (15 * done) / Math.max(1, wanted.length));
    }
  });

  if (failed > 0) {
    warnings.push({
      context: "memory",
      message: `${failed} project memory note(s) could not be read and were skipped`,
    });
  }

  for (const entries of byProject.values()) {
    entries.sort((a, b) => a.path.localeCompare(b.path));
  }
  return byProject;
}

async function fetchMemorySummaries(
  orgId: string,
  projectIds: string[],
  warnings: Warning[],
): Promise<Map<string, ExtractedClaudeMemoryEntry[]>> {
  const byProject = new Map<string, ExtractedClaudeMemoryEntry[]>();
  let failed = 0;

  await mapWithConcurrency(projectIds, CONCURRENCY, async (projectId) => {
    try {
      const raw = await claudeRequest<RawRecord>(
        `/api/organizations/${orgId}/memory?project_uuid=${encodeURIComponent(projectId)}`,
      );
      const memory = str(raw?.memory).trim();
      if (memory) {
        byProject.set(projectId, [
          {
            path: `project:${projectId}`,
            title: "Project memory summary",
            summary: "",
            body: memory,
            updatedAt: str(raw?.updated_at),
          },
        ]);
      }
    } catch {
      failed++;
    }
  });

  if (failed > 0) {
    warnings.push({
      context: "memory",
      message: `Project memory could not be read for ${failed} project(s)`,
    });
  }
  return byProject;
}

/** Project memory for the given projects, keyed by lowercase project ID. */
export async function fetchProjectMemory(
  orgId: string,
  projectIds: string[],
  warnings: Warning[],
): Promise<{
  source: "entries" | "summary" | null;
  byProject: Map<string, ExtractedClaudeMemoryEntry[]>;
}> {
  const empty = { source: null, byProject: new Map() } as const;
  if (projectIds.length === 0) return { ...empty, byProject: new Map() };

  let settings: RawRecord;
  try {
    settings = (await claudeRequest<RawRecord>(
      `/api/organizations/${orgId}/memory/settings`,
    )) ?? {};
  } catch (err) {
    warnings.push({
      context: "memory",
      message: `Project memory was skipped (memory settings unavailable: ${errorMessage(err)})`,
    });
    return { ...empty, byProject: new Map() };
  }

  const ids = projectIds.map((id) => id.toLowerCase());

  if (settings.memory_mode === "melange") {
    try {
      const byProject = await fetchMemoryEntries(orgId, new Set(ids), warnings);
      return { source: "entries", byProject };
    } catch (err) {
      warnings.push({
        context: "memory",
        message: `Could not list memory notes (${errorMessage(err)}); trying the older memory format`,
      });
    }
  }

  const byProject = await fetchMemorySummaries(orgId, ids, warnings);
  return { source: "summary", byProject };
}

// ─── Extraction ────────────────────────────────────────────────

export async function extractProjects(
  options: ClaudeExtractionOptions = DEFAULT_OPTIONS,
): Promise<ClaudeExtractionResult> {
  const warnings: Warning[] = [];

  const orgId = getOrgId();
  if (!orgId) {
    return {
      success: false,
      projects: [],
      warnings: [
        {
          context: "auth",
          message:
            "Not logged in to Claude: no organization ID found in cookies",
        },
      ],
    };
  }

  progress("Listing your projects", 5);

  let rawProjects: RawRecord[];
  try {
    rawProjects = await listAllProjects(orgId);
  } catch (err) {
    if (err instanceof ClaudeApiError && (err.status === 401 || err.status === 403)) {
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
    return {
      success: false,
      projects: [],
      warnings: [
        {
          context: "api",
          message: `Failed to fetch projects: ${errorMessage(err)}`,
        },
      ],
    };
  }

  if (rawProjects.length === 0) {
    warnings.push({
      context: "api",
      message: "No projects found in your Claude account",
    });
    return { success: true, projects: [], warnings };
  }

  const valid = rawProjects.filter((raw) => {
    const ok = isUuid(raw.uuid) && str(raw.name).length > 0;
    if (!ok) {
      warnings.push({
        context: "parse",
        message: "Skipping project with missing uuid or name",
      });
    }
    return ok;
  });
  const starters = valid.filter((p) => p.is_starter_project === true);
  const archived = valid.filter((p) => p.archived_at != null);
  const selected = valid.filter(
    (p) => p.is_starter_project !== true && p.archived_at == null,
  );

  if (starters.length > 0) {
    warnings.push({
      context: "filter",
      message: `Skipped ${starters.length} example project(s) that Claude adds to new accounts`,
    });
  }
  if (archived.length > 0) {
    warnings.push({
      context: "filter",
      message: `Skipped ${archived.length} archived project(s)`,
    });
  }

  let done = 0;
  const projects = await mapWithConcurrency(
    selected,
    CONCURRENCY,
    async (listItem): Promise<ExtractedClaudeProject> => {
      const id = str(listItem.uuid);
      const listName = str(listItem.name);

      let detail: RawRecord = listItem;
      try {
        detail = (await claudeRequest<RawRecord>(
          `/api/organizations/${orgId}/projects/${id}`,
        )) ?? listItem;
      } catch (err) {
        warnings.push({
          context: "api",
          message: `Could not read "${listName}" (${errorMessage(err)}); its instructions may be missing`,
        });
      }

      const name = str(detail.name) || listName;
      const project: ExtractedClaudeProject = {
        id,
        name,
        description: str(detail.description) || str(listItem.description),
        instructions: str(detail.prompt_template),
        createdAt: str(detail.created_at) || str(listItem.created_at),
        updatedAt: str(detail.updated_at) || str(listItem.updated_at),
      };

      if (options.includeKnowledge) {
        const docsCount = typeof detail.docs_count === "number" ? detail.docs_count : null;
        const filesCount = typeof detail.files_count === "number" ? detail.files_count : null;

        if (docsCount === null || docsCount > 0) {
          try {
            project.docs = await fetchProjectDocs(orgId, { id, name }, warnings);
          } catch (err) {
            warnings.push({
              context: "knowledge",
              message: `Could not read knowledge docs for "${name}": ${errorMessage(err)}`,
            });
          }
        }
        if (filesCount === null || filesCount > 0) {
          try {
            project.files = await fetchProjectFiles(orgId, id);
          } catch (err) {
            warnings.push({
              context: "knowledge",
              message: `Could not list files for "${name}": ${errorMessage(err)}`,
            });
          }
        }
      }

      done++;
      progress(`Read ${done} of ${selected.length} projects`, 10 + (65 * done) / selected.length);
      return project;
    },
  );

  if (options.includeMemory) {
    progress("Reading project memory", 80);
    const memory = await fetchProjectMemory(
      orgId,
      projects.map((p) => p.id),
      warnings,
    );
    for (const project of projects) {
      const entries = memory.byProject.get(project.id.toLowerCase());
      if (entries && entries.length > 0 && memory.source) {
        project.memory = entries;
        project.memorySource = memory.source;
      }
    }
  }

  progress("Done", 100);
  return { success: true, projects, warnings };
}

// ─── Message Handlers ──────────────────────────────────────────

initMessageRouter();

onMessage("CLAUDE_EXTRACT_PROJECTS", async (payload) => {
  return extractProjects({ ...DEFAULT_OPTIONS, ...(payload ?? {}) });
});

onMessage("PING", () => {
  return { pong: true as const };
});

console.log("[PortSmith] Claude extractor content script loaded");
