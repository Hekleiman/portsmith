// ─── Gemini Session Management ──────────────────────────────
// Shared session initialisation for Gemini content scripts.
// Fetches the app page, extracts CSRF token + session params.
//
// NOTE: The extractor has its own inline copy of this logic.
// Both modules maintain independent session caches, which is
// fine — they read the same server-side tokens.

import type { GeminiSession } from "./batchexecute";

const GEMINI_APP_URL = "https://gemini.google.com/app";

let cachedSession: GeminiSession | null = null;

/**
 * Fetch the Gemini app page and extract session tokens via regex.
 *
 * Tokens extracted:
 * - SNlM0e  → CSRF / access token (required)
 * - cfb2h   → build label
 * - FdrFJe  → session ID
 * - TuX5cc  → language code
 */
export async function initSession(): Promise<GeminiSession> {
  const response = await fetch(GEMINI_APP_URL, {
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

  cachedSession = { accessToken, buildLabel, sessionId, language };
  return cachedSession;
}

/**
 * Get the current session, initialising if needed.
 */
export async function getSession(): Promise<GeminiSession> {
  if (cachedSession) return cachedSession;
  return initSession();
}

/**
 * Force a session refresh (e.g. after a 401 / expired token).
 */
export async function refreshSession(): Promise<GeminiSession> {
  cachedSession = null;
  return initSession();
}
