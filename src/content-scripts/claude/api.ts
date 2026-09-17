// ─── Claude internal API helpers ────────────────────────────
// Runs in content scripts on claude.ai. Requests are same-origin, so the
// user's session cookies are sent automatically.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Organization ID from the `lastActiveOrg` cookie, or null if absent. */
export function getOrgId(cookie: string = document.cookie): string | null {
  const match = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(cookie);
  if (!match?.[1]) return null;
  const value = decodeURIComponent(match[1]);
  return isUuid(value) ? value : null;
}

export class ClaudeApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClaudeApiError";
    this.status = status;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON request with retry on HTTP 429.
 * String bodies are sent as JSON; FormData bodies keep the browser's
 * multipart boundary header.
 */
export async function claudeRequest<T>(
  path: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(typeof init.body === "string"
      ? { "Content-Type": "application/json" }
      : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });

    if (resp.status === 429 && attempt < retries) {
      // At most 10 s per wait, so three retries stay well inside the
      // side panel's message timeouts (see shared/messaging.ts).
      const retryAfter = Number(resp.headers.get("retry-after"));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 10) * 1000
          : 1000 * 2 ** attempt,
      );
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ClaudeApiError(
        resp.status,
        `HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }

    if (resp.status === 204) return undefined as T;
    const text = await resp.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface ProjectSummary {
  uuid: string;
  name: string;
  createdAt: string;
}

/** Lists every project in the org (name, ID and creation time). */
export async function listProjectSummaries(orgId: string): Promise<ProjectSummary[]> {
  const projects: ProjectSummary[] = [];
  const pageSize = 100;
  const seen = new Set<string>();
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await claudeRequest<unknown>(
      `/api/organizations/${orgId}/projects?limit=${pageSize}&offset=${offset}`,
    );
    if (!Array.isArray(page)) break;
    let added = 0;
    for (const p of page as Array<Record<string, unknown>>) {
      if (typeof p.uuid === "string" && !seen.has(p.uuid)) {
        seen.add(p.uuid);
        added++;
        if (typeof p.name === "string") {
          projects.push({
            uuid: p.uuid,
            name: p.name,
            createdAt: typeof p.created_at === "string" ? p.created_at : "",
          });
        }
      }
    }
    if (page.length < pageSize || added === 0) break;
  }
  return projects;
}

/** Lists every project name in the org (used for verification). */
export async function listProjectNames(orgId: string): Promise<string[]> {
  return (await listProjectSummaries(orgId)).map((p) => p.name);
}

/** Case- and space-insensitive name key. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
