// ─── ChatGPT internal API helpers ───────────────────────────
// Runs in content scripts on chatgpt.com. Requests are same-origin, but
// unlike Claude, cookies alone are NOT enough: every /backend-api/ call
// needs an `Authorization: Bearer <token>` header as well.
//
// Where the page gets its bearer token (verified live on 2026-09-20, in a
// signed-in chatgpt.com tab, read-only GETs only):
//
//   GET /api/auth/session  ->  200, JSON, same-origin, cookies only.
//   Its `accessToken` field is the bearer token. It is a three-part JWT,
//   about 1.9 KB, with a 10-day lifetime in its `exp` claim. The sibling
//   `expires` field is the *session* expiry (90 days out), not the token's,
//   so it must not be used as the cache expiry.
//
// What the API actually checks, measured against
// GET /backend-api/memories?include_memory_entries=false:
//
//   cookies only, no headers ............ 401
//   Authorization alone ................. 200
//   Authorization + oai-* headers ....... 200
//   Authorization with a junk token ..... 401
//
// So the bearer token is the only gate. The `oai-*` headers the web app
// sends are not required for reads, but we send the ones we can derive
// honestly (device ID from the `oai-did` cookie, language from the page)
// so our requests look like the app's rather than like an outlier. A 401
// therefore means a stale token, which is why we refresh and retry once.
//
// No sentinel proof-of-work token gates any project read or write.
//
// The token lives in the module-level cache below and nowhere else: it is
// never logged, never written to chrome.storage, and never put into a
// message payload. Note that `refreshAccessToken` deliberately does not
// echo the session response body into its error, because that body
// contains the token.

const SESSION_PATH = "/api/auth/session";
const SIDEBAR_PATH = "/backend-api/gizmos/snorlax/sidebar";

/** Projects are `g-p-<32 hex>`; plain GPTs are `g-<9 chars>`. */
const PROJECT_GIZMO_ID = /^g-p-[0-9a-f]{32}$/;

/**
 * Cache lifetime for the bearer token. Far shorter than the token's own
 * 10-day expiry: the point is to hold it for the length of one run, not
 * to keep it alive.
 */
const TOKEN_TTL_MS = 5 * 60 * 1000;

const SIDEBAR_PAGE_SIZE = 20;
const MAX_SIDEBAR_PAGES = 50;

export class ChatGPTApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatGPTApiError";
    this.status = status;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Access token ───────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlightToken: Promise<string> | null = null;

/** Reads a fresh bearer token from the session endpoint. */
async function refreshAccessToken(): Promise<string> {
  const resp = await fetch(SESSION_PATH, { credentials: "include" });
  if (!resp.ok) {
    // No body in the message: this response carries the token.
    throw new ChatGPTApiError(
      resp.status,
      `HTTP ${resp.status} reading the ChatGPT session. Sign in to chatgpt.com and try again.`,
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const token = data.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new ChatGPTApiError(
      resp.status,
      "The ChatGPT session has no access token. Sign in to chatgpt.com and try again.",
    );
  }

  cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

/**
 * The bearer token for /backend-api/ calls, cached in memory for
 * `TOKEN_TTL_MS`. Concurrent callers share one refresh. Pass
 * `forceRefresh` after a 401 to drop the cached token and read a new one.
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    cachedToken = null;
    inFlightToken = null;
  } else if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  if (!inFlightToken) {
    const pending = refreshAccessToken();
    inFlightToken = pending;
    void pending
      .catch(() => undefined)
      .finally(() => {
        if (inFlightToken === pending) inFlightToken = null;
      });
  }
  return inFlightToken;
}

/** Clears the cached token. Call this when a run finishes. */
export function clearAccessToken(): void {
  cachedToken = null;
  inFlightToken = null;
}

// ─── Requests ───────────────────────────────────────────────

/** Device ID the web app sends as `oai-device-id`, from the `oai-did` cookie. */
function getDeviceId(cookie: string = document.cookie): string | null {
  const match = /(?:^|;\s*)oai-did=([^;]+)/.exec(cookie);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]) || null;
}

/** The `oai-*` headers the web app sends, minus anything we can't derive. */
function clientHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "oai-language": navigator.language || "en-US",
  };
  const deviceId = getDeviceId();
  if (deviceId) headers["oai-device-id"] = deviceId;
  return headers;
}

/**
 * JSON request against /backend-api/, with the bearer token attached.
 * Retries HTTP 429 honouring `retry-after`, and retries once on 401 after
 * forcing a token refresh. String bodies are sent as JSON; FormData bodies
 * keep the browser's multipart boundary header.
 */
export async function chatgptRequest<T>(
  path: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  let throttled = 0;
  let refreshed = false;

  for (;;) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      ...clientHeaders(),
      Authorization: `Bearer ${token}`,
      ...(typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    const resp = await fetch(path, { ...init, headers, credentials: "include" });

    // A 401 means the token went stale. Refresh once, then give up: a
    // second 401 is a signed-out session, not a timing problem.
    if (resp.status === 401 && !refreshed) {
      refreshed = true;
      await getAccessToken(true);
      continue;
    }

    if (resp.status === 429 && throttled < retries) {
      // At most 10 s per wait, so three retries stay well inside the
      // side panel's message timeouts (see shared/messaging.ts).
      const retryAfter = Number(resp.headers.get("retry-after"));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 10) * 1000
          : 1000 * 2 ** throttled,
      );
      throttled++;
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ChatGPTApiError(
        resp.status,
        `HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }

    if (resp.status === 204) return undefined as T;
    const text = await resp.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

// ─── Projects ───────────────────────────────────────────────

/** Whether a gizmo ID is a project, as opposed to a custom GPT. */
export function isProjectGizmoId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_GIZMO_ID.test(value);
}

export interface ChatGPTProjectSummary {
  gizmoId: string;
  name: string;
}

/** Pulls `{ gizmoId, name }` out of one sidebar item, or null if it isn't a project. */
function readSidebarItem(item: unknown): ChatGPTProjectSummary | null {
  if (typeof item !== "object" || item === null) return null;
  const gizmo = (item as Record<string, unknown>).gizmo;
  if (typeof gizmo !== "object" || gizmo === null) return null;

  const { id, display } = gizmo as Record<string, unknown>;
  if (!isProjectGizmoId(id)) return null;
  if (typeof display !== "object" || display === null) return null;

  const name = (display as Record<string, unknown>).name;
  if (typeof name !== "string") return null;

  return { gizmoId: id, name };
}

/**
 * Every project the signed-in user owns, from the sidebar listing.
 * Custom GPTs share this listing and are filtered out. The response
 * carries a `cursor`, which is followed until it comes back empty.
 */
export async function listProjectSummaries(): Promise<ChatGPTProjectSummary[]> {
  const projects: ChatGPTProjectSummary[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_SIDEBAR_PAGES; page++) {
    const query = `?owned_only=true&limit=${SIDEBAR_PAGE_SIZE}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const body = await chatgptRequest<unknown>(`${SIDEBAR_PATH}${query}`);
    if (typeof body !== "object" || body === null) break;

    const { items, cursor: nextCursor } = body as Record<string, unknown>;
    if (!Array.isArray(items)) break;

    let added = 0;
    for (const item of items) {
      const summary = readSidebarItem(item);
      if (!summary || seen.has(summary.gizmoId)) continue;
      seen.add(summary.gizmoId);
      projects.push(summary);
      added++;
    }

    cursor = typeof nextCursor === "string" && nextCursor ? nextCursor : null;
    // Stop on an empty cursor, and on a page that moved nothing forward.
    if (!cursor || (items.length === 0 && added === 0)) break;
  }

  return projects;
}

/**
 * Case- and space-insensitive name key. Duplicated from the Claude
 * helper on purpose: importing it would pull claude/api.ts into the
 * ChatGPT content script bundle.
 */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
