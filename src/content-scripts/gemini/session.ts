// ─── Gemini Session Management ──────────────────────────────
// Shared session initialisation for the Gemini content scripts (extractor
// and importer). Fetches the app page, extracts CSRF token + session params.
//
// Google serves each signed-in account under its own path prefix
// (/u/1/app, /u/2/app; none for the default account). Tokens only work
// with the prefix they came from, so the session follows the account of
// the tab this script runs in (verified against gemini.google.com, Sep 2026).

import { GEMINI_ORIGIN, type GeminiSession } from "./batchexecute";

let cachedSession: GeminiSession | null = null;

/** "/u/N" for a secondary account's page, "" for the default account. */
export function accountPrefix(pathname: string): string {
  return /^\/u\/\d+(?=\/|$)/.exec(pathname)?.[0] ?? "";
}

function currentPrefix(): string {
  return accountPrefix(globalThis.location?.pathname ?? "");
}

/**
 * Fetch the Gemini app page for this tab's account and extract session
 * tokens via regex.
 *
 * Tokens extracted:
 * - SNlM0e: CSRF / access token (required)
 * - cfb2h: build label
 * - FdrFJe: session ID
 * - TuX5cc: language code
 * - qKIAYe: push channel for file uploads
 */
export async function initSession(): Promise<GeminiSession> {
  const prefix = currentPrefix();
  const response = await fetch(`${GEMINI_ORIGIN}${prefix}/app`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load Gemini app page: HTTP ${response.status}`,
    );
  }

  const html = await response.text();

  const accessToken = html.match(/"SNlM0e":\s*"(.*?)"/)?.[1];
  if (!accessToken) {
    throw new Error(
      "Could not find Gemini's session token. Are you signed in to gemini.google.com?",
    );
  }

  const buildLabel = html.match(/"cfb2h":\s*"(.*?)"/)?.[1];
  const sessionId = html.match(/"FdrFJe":\s*"(.*?)"/)?.[1];
  const language = html.match(/"TuX5cc":\s*"(.*?)"/)?.[1] ?? "en";
  const pushId = html.match(/"qKIAYe":\s*"(.*?)"/)?.[1];

  cachedSession = { accessToken, buildLabel, sessionId, language, prefix, pushId };
  return cachedSession;
}

/**
 * Get the current session, initialising if needed (or if the tab has
 * moved to another account since).
 */
export async function getSession(): Promise<GeminiSession> {
  if (cachedSession && cachedSession.prefix === currentPrefix()) {
    return cachedSession;
  }
  return initSession();
}

/**
 * Force a session refresh (e.g. after a 401 / expired token).
 */
export async function refreshSession(): Promise<GeminiSession> {
  cachedSession = null;
  return initSession();
}
