import {
  resolveSelector,
  waitForSelector,
  type SelectorStrategy,
} from "@/content-scripts/common/selector-engine";
import {
  LOGIN_AVATAR,
  GPT_EDITOR,
  GPT_LIST,
  SETTINGS_MEMORY,
  SETTINGS_CUSTOM_INSTRUCTIONS,
} from "./selectors";
import {
  sendMessage,
  onMessage,
  initMessageRouter,
} from "@/shared/messaging";
import type {
  ExtractedCustomGPT,
  ExtractedMemoryItem,
  ExtractionWarning,
  CustomGPTExtractionResult,
  MemoryExtractionResult,
  CustomInstructionsExtractionResult,
} from "@/core/adapters/chatgpt-dom-types";

// ─── Constants ───────────────────────────────────────────────

const PAGE_LOAD_TIMEOUT_MS = 5000;
const ELEMENT_WAIT_TIMEOUT_MS = 3000;

// ─── Helpers ─────────────────────────────────────────────────

function warn(
  warnings: ExtractionWarning[],
  context: string,
  message: string,
): void {
  warnings.push({ context, message });
}

/**
 * Read text content from an element found via selector strategies.
 * Returns empty string if element not found (and logs a warning).
 */
function readText(
  strategies: SelectorStrategy[],
  fieldName: string,
  warnings: ExtractionWarning[],
): string {
  const result = resolveSelector(strategies);
  if (!result.success) {
    warn(warnings, fieldName, `Element not found — skipped`);
    return "";
  }

  const el = result.element;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return el.textContent?.trim() ?? "";
}

/**
 * Read text from an element found via selector strategies, waiting for it to appear.
 */
async function readTextAsync(
  strategies: SelectorStrategy[],
  fieldName: string,
  warnings: ExtractionWarning[],
  timeoutMs = ELEMENT_WAIT_TIMEOUT_MS,
): Promise<string> {
  const result = await waitForSelector(strategies, timeoutMs);
  if (!result.success) {
    warn(warnings, fieldName, `Element not found after ${timeoutMs}ms — skipped`);
    return "";
  }

  const el = result.element;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return el.textContent?.trim() ?? "";
}

/**
 * Find all elements matching the first working strategy in a list.
 * Unlike resolveSelector (which returns one element), this returns all matches.
 */
function resolveAllElements(
  strategies: SelectorStrategy[],
): Element[] {
  const sorted = [...strategies].sort((a, b) => a.priority - b.priority);

  for (const strategy of sorted) {
    try {
      let elements: Element[] = [];

      switch (strategy.type) {
        case "testid":
          elements = [...document.querySelectorAll(`[data-testid="${strategy.value}"]`)];
          break;
        case "aria":
          elements = [...document.querySelectorAll(`[aria-label="${strategy.value}"]`)];
          break;
        case "css":
          elements = [...document.querySelectorAll(strategy.value)];
          break;
        case "xpath": {
          const result = document.evaluate(
            strategy.value,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i);
            if (node instanceof Element) elements.push(node);
          }
          break;
        }
        case "text": {
          const candidates = document.querySelectorAll("button, span, div, a, label");
          for (const el of candidates) {
            if (el.textContent?.trim() === strategy.value) {
              elements.push(el);
            }
          }
          break;
        }
      }

      if (elements.length > 0) return elements;
    } catch {
      // Try next strategy
    }
  }

  return [];
}

// ─── Login Check ────────────────────────────────────────────

async function checkLoggedIn(): Promise<boolean> {
  const result = await waitForSelector(LOGIN_AVATAR, PAGE_LOAD_TIMEOUT_MS);
  return result.success;
}

// ─── Page Detection ─────────────────────────────────────────

type ChatGPTPage =
  | "gpt_editor"
  | "gpt_list"
  | "settings"
  | "chat"
  | "unknown";

function detectPage(): ChatGPTPage {
  const url = window.location.href;
  if (url.includes("/gpts/editor")) return "gpt_editor";
  if (url.includes("/gpts/mine") || url.includes("/gpts")) return "gpt_list";
  if (url.includes("#settings") || url.includes("/settings")) return "settings";
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chat";
  return "unknown";
}

// ─── GPT Extraction ─────────────────────────────────────────

/**
 * Extract a single Custom GPT config from the editor page.
 * Must be called while on a /gpts/editor/[id] page.
 */
async function extractSingleGPT(
  warnings: ExtractionWarning[],
): Promise<ExtractedCustomGPT | null> {
  const name = await readTextAsync(GPT_EDITOR.name, "GPT name", warnings);
  if (!name) {
    warn(warnings, "GPT extraction", "Could not find GPT name — page may not be loaded");
    return null;
  }

  const description = readText(GPT_EDITOR.description, "GPT description", warnings);
  const instructions = readText(GPT_EDITOR.instructions, "GPT instructions", warnings);

  // Conversation starters: find all starter inputs
  const starterElements = resolveAllElements(GPT_EDITOR.conversationStarters);
  const conversationStarters: string[] = [];
  for (const el of starterElements) {
    const value = el instanceof HTMLInputElement ? el.value.trim() : el.textContent?.trim() ?? "";
    if (value) conversationStarters.push(value);
  }

  // Knowledge files: find all file name elements
  const fileElements = resolveAllElements(GPT_EDITOR.knowledgeFiles);
  const knowledgeFileNames: string[] = [];
  for (const el of fileElements) {
    const fileName = el.textContent?.trim();
    if (fileName) knowledgeFileNames.push(fileName);
  }

  // Extract gizmo_id from URL if possible
  const urlMatch = window.location.pathname.match(/\/gpts\/editor\/([^/?]+)/);
  const id = urlMatch?.[1] ?? `gpt-${Date.now()}`;

  return {
    id,
    name,
    description,
    instructions,
    conversationStarters,
    knowledgeFileNames,
  };
}

/**
 * Extract Custom GPT configs. When on the editor page, extracts the current GPT.
 * When on the list page, discovers GPT links (extraction of each requires navigation).
 */
export async function extractCustomGPTs(): Promise<CustomGPTExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  const loggedIn = await checkLoggedIn();
  if (!loggedIn) {
    return {
      success: false,
      gpts: [],
      warnings: [{ context: "auth", message: "Not logged in to ChatGPT" }],
    };
  }

  const page = detectPage();
  const gpts: ExtractedCustomGPT[] = [];

  if (page === "gpt_editor") {
    const gpt = await extractSingleGPT(warnings);
    if (gpt) gpts.push(gpt);
  } else if (page === "gpt_list") {
    // On the list page, we can discover GPT IDs but can't read their full config
    // without navigating to each editor page. Return the IDs as partial results.
    const cards = resolveAllElements(GPT_LIST.gptCards);
    if (cards.length === 0) {
      warn(warnings, "GPT list", "No GPT cards found — page may not be loaded");
    }
    for (const card of cards) {
      const href = card.getAttribute("href") ?? "";
      const idMatch = href.match(/\/gpts\/editor\/([^/?]+)/);
      const id = idMatch?.[1] ?? "";

      // Try to read the name from inside the card
      const nameEl = card.querySelector("h3, [class*='title']");
      const name = nameEl?.textContent?.trim() ?? "Unknown GPT";

      if (id) {
        gpts.push({
          id,
          name,
          description: "",
          instructions: "",
          conversationStarters: [],
          knowledgeFileNames: [],
        });
        warn(warnings, `GPT ${name}`, "Only metadata extracted from list — navigate to editor for full config");
      }
    }
  } else {
    warn(warnings, "GPT extraction", `Wrong page for GPT extraction (detected: ${page}). Navigate to chatgpt.com/gpts/mine or a GPT editor page.`);
  }

  return { success: gpts.length > 0 || warnings.length === 0, gpts, warnings };
}

// ─── Memory Extraction ──────────────────────────────────────

/**
 * Extract memory items from the Settings > Personalization > Memory page.
 * User must be on the settings page with the memory list visible.
 */
export async function extractMemory(): Promise<MemoryExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  const loggedIn = await checkLoggedIn();
  if (!loggedIn) {
    return {
      success: false,
      items: [],
      warnings: [{ context: "auth", message: "Not logged in to ChatGPT" }],
    };
  }

  // Wait for the memory list container to appear
  const containerResult = await waitForSelector(
    SETTINGS_MEMORY.memoryListContainer,
    ELEMENT_WAIT_TIMEOUT_MS,
  );

  if (!containerResult.success) {
    warn(
      warnings,
      "memory",
      "Memory list container not found — ensure Settings > Personalization > Memory is open",
    );
    return { success: false, items: [], warnings };
  }

  // Find all memory items within the container
  const itemElements = resolveAllElements(SETTINGS_MEMORY.memoryItem);
  const items: ExtractedMemoryItem[] = [];

  if (itemElements.length === 0) {
    warn(warnings, "memory", "No memory items found — memory may be empty or list not loaded");
    return { success: true, items: [], warnings };
  }

  for (const el of itemElements) {
    const content = el.textContent?.trim();
    if (content) {
      items.push({ content });
    }
  }

  return { success: true, items, warnings };
}

// ─── Custom Instructions Extraction ─────────────────────────

/**
 * Extract custom instructions from Settings > Personalization > Custom Instructions.
 * User must have the custom instructions modal/panel open.
 */
export async function extractCustomInstructions(): Promise<CustomInstructionsExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  const loggedIn = await checkLoggedIn();
  if (!loggedIn) {
    return {
      success: false,
      instructions: null,
      warnings: [{ context: "auth", message: "Not logged in to ChatGPT" }],
    };
  }

  const aboutUser = await readTextAsync(
    SETTINGS_CUSTOM_INSTRUCTIONS.aboutUserTextarea,
    "Custom instructions (about user)",
    warnings,
  );

  const responsePreferences = await readTextAsync(
    SETTINGS_CUSTOM_INSTRUCTIONS.responsePreferencesTextarea,
    "Custom instructions (response preferences)",
    warnings,
  );

  if (!aboutUser && !responsePreferences) {
    warn(
      warnings,
      "custom instructions",
      "Neither text field found — ensure Custom Instructions panel is open",
    );
    return { success: false, instructions: null, warnings };
  }

  return {
    success: true,
    instructions: { aboutUser, responsePreferences },
    warnings,
  };
}

// ─── Message Handler ────────────────────────────────────────

function handleExtractRequest(target: string): void {
  const run = async (): Promise<void> => {
    try {
      sendMessage("EXTRACT_PROGRESS", { step: `Extracting ${target}`, percent: 0 }).catch(() => {});

      switch (target) {
        case "custom_gpts": {
          const result = await extractCustomGPTs();
          sendMessage("DOM_EXTRACT_RESULT", { type: "custom_gpts", data: result }).catch(() => {});
          break;
        }
        case "memory": {
          const result = await extractMemory();
          sendMessage("DOM_EXTRACT_RESULT", { type: "memory", data: result }).catch(() => {});
          break;
        }
        case "custom_instructions": {
          const result = await extractCustomInstructions();
          sendMessage("DOM_EXTRACT_RESULT", { type: "custom_instructions", data: result }).catch(() => {});
          break;
        }
        default:
          console.warn(`[Portsmith] Unknown extraction target: ${target}`);
      }

      sendMessage("EXTRACT_PROGRESS", { step: `Finished ${target}`, percent: 100 }).catch(() => {});
    } catch (err) {
      console.error("[Portsmith] Extraction error:", err);
    }
  };

  void run();
}

// ─── Init ───────────────────────────────────────────────────

function init(): void {
  console.log("[Portsmith] Content script injected on ChatGPT");

  initMessageRouter();

  onMessage("DOM_EXTRACT", (payload) => {
    handleExtractRequest(payload.target);
    return { success: true };
  });

  // Notify service worker of current page state
  sendMessage("PAGE_STATE", {
    url: window.location.href,
    platform: "chatgpt",
  }).catch(() => {
    // Service worker may not be ready yet — that's fine
  });
}

init();
