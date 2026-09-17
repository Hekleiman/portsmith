// ─── Gemini Gem Extractor ────────────────────────────────────
// Content script that runs on gemini.google.com.
// Extracts Gem configurations via the internal batchexecute API.
//
// Unlike the ChatGPT extractor (DOM-based), this uses fetch()
// against Gemini's internal RPC endpoints. Cookies are included
// automatically because we run in the page's origin.

import { onMessage, initMessageRouter } from "@/shared/messaging";
import type { GemExtractionResult, ExtractedGem, ExtractionWarning } from "@/core/adapters/gemini-dom-types";
import {
  batchExecute,
  extractResponseBody,
  getFrameIdentifier,
  type GeminiSession,
  type RPCPayload,
} from "./batchexecute";
import { getSession, refreshSession } from "./session";

// ─── Constants ──────────────────────────────────────────────

/** RPC ID for listing gems */
const RPC_LIST_GEMS = "CNgdBe";

// ─── Gem Parsing ────────────────────────────────────────────

/**
 * Parse a single gem entry from the batchexecute response array.
 *
 * Each gem in the list is:
 * ```
 * [gem_id, [name, description], [prompt] | null, ...]
 * ```
 */
function parseGem(
  raw: unknown,
  predefined: boolean,
  warnings: ExtractionWarning[],
): ExtractedGem | null {
  if (!Array.isArray(raw)) {
    warnings.push({
      context: "parseGem",
      message: "Expected array for gem entry, got " + typeof raw,
    });
    return null;
  }

  const id = raw[0];
  if (typeof id !== "string" || !id) {
    warnings.push({
      context: "parseGem",
      message: "Missing or invalid gem ID",
    });
    return null;
  }

  const nameDesc = raw[1];
  const name =
    Array.isArray(nameDesc) && typeof nameDesc[0] === "string"
      ? nameDesc[0]
      : "";
  const description =
    Array.isArray(nameDesc) && typeof nameDesc[1] === "string"
      ? nameDesc[1]
      : "";

  const promptArr = raw[2];
  const instructions =
    Array.isArray(promptArr) && typeof promptArr[0] === "string"
      ? promptArr[0]
      : "";

  if (!name) {
    warnings.push({
      context: "parseGem",
      message: `Gem ${id} has no name, so it was skipped`,
    });
    return null;
  }

  return { id, name, description, instructions, predefined };
}

// ─── Extraction ─────────────────────────────────────────────

/**
 * Extract all user-created (custom) gems from the current user's
 * Gemini account via the batchexecute API.
 */
export async function extractGems(): Promise<GemExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  let session: GeminiSession;
  try {
    session = await getSession();
  } catch (err) {
    return {
      success: false,
      gems: [],
      warnings: [
        {
          context: "session",
          message:
            err instanceof Error ? err.message : "Failed to initialise session",
        },
      ],
    };
  }

  // Build the RPC payloads — one for custom gems
  const payloads: RPCPayload[] = [
    {
      rpcid: RPC_LIST_GEMS,
      payload: `[2,["${session.language}"],0]`,
      identifier: "custom",
    },
  ];

  let frames: unknown[];
  try {
    frames = await batchExecute(session, payloads);
  } catch (err) {
    // If the first attempt fails, try refreshing the session once
    if (
      err instanceof Error &&
      (err.message.includes("HTTP 401") ||
        err.message.includes("HTTP 400"))
    ) {
      try {
        session = await refreshSession();
        frames = await batchExecute(session, payloads);
      } catch (retryErr) {
        return {
          success: false,
          gems: [],
          warnings: [
            {
              context: "batchexecute",
              message:
                retryErr instanceof Error
                  ? retryErr.message
                  : "batchexecute failed after session refresh",
            },
          ],
        };
      }
    } else {
      return {
        success: false,
        gems: [],
        warnings: [
          {
            context: "batchexecute",
            message:
              err instanceof Error ? err.message : "batchexecute request failed",
          },
        ],
      };
    }
  }

  // Find the response frame tagged with our "custom" identifier
  const gems: ExtractedGem[] = [];
  let foundCustomFrame = false;

  for (const frame of frames) {
    const identifier = getFrameIdentifier(frame);
    if (identifier !== "custom") continue;

    foundCustomFrame = true;
    const body = extractResponseBody(frame);
    if (!body || !Array.isArray(body)) {
      warnings.push({
        context: "response",
        message: "Custom gems response body is empty or not an array",
      });
      continue;
    }

    // An account without custom Gems gets an empty body (verified Sep 2026)
    if (body.length === 0) continue;

    // Gem list is at index [2] of the parsed body
    const gemList: unknown = body[2];
    if (!Array.isArray(gemList)) {
      warnings.push({
        context: "response",
        message: "No gem list found at expected position in response",
      });
      continue;
    }

    for (const rawGem of gemList) {
      const gem = parseGem(rawGem, false, warnings);
      if (gem) gems.push(gem);
    }
  }

  if (!foundCustomFrame) {
    warnings.push({
      context: "response",
      message:
        'No response frame with identifier "custom" found; ' +
        `received ${frames.length} frame(s)`,
    });
  }

  return {
    success: gems.length > 0 || (foundCustomFrame && warnings.length === 0),
    gems,
    warnings,
  };
}

// ─── Message Handlers ───────────────────────────────────────

initMessageRouter();

onMessage("GEMINI_EXTRACT_GEMS", async () => {
  return extractGems();
});

onMessage("PING", () => {
  return { pong: true as const };
});

console.log("[PortSmith] Gemini extractor content script loaded");
