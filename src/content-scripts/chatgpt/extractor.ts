import {
  resolveSelector,
  waitForSelector,
  type SelectorStrategy,
} from "@/content-scripts/common/selector-engine";
import {
  LOGIN_AVATAR,
  GPT_EDITOR,
  GPT_LIST,
  PROJECT_SIDEBAR,
  PROJECT_PAGE,
  SETTINGS_MEMORY,
  SETTINGS_CUSTOM_INSTRUCTIONS,
} from "./selectors";
import {
  sendMessage,
  onMessage,
  initMessageRouter,
} from "@/shared/messaging";
import type {
  SidebarScanResult,
  DOMInspectionReport,
  GizmoAPIResponse,
} from "@/shared/messaging";
import { normalizeGizmoId } from "@/shared/chatgpt-ids";
import type {
  ExtractedCustomGPT,
  ExtractedChatGPTProject,
  ExtractedFileMetadata,
  ExtractedMemoryItem,
  ExtractionWarning,
  CustomGPTExtractionResult,
  ProjectExtractionResult,
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
    warn(warnings, fieldName, `Element not found, skipped`);
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
    warn(warnings, fieldName, `Element not found after ${timeoutMs}ms, skipped`);
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
  // Primary: look for the profile/avatar button
  const result = await waitForSelector(LOGIN_AVATAR, PAGE_LOAD_TIMEOUT_MS);
  if (result.success) return true;

  // Fallback: if sidebar contains project or GPT links, the user is
  // authenticated. ChatGPT's login page never shows a populated sidebar.
  const projectLinks = resolveAllElements(PROJECT_SIDEBAR.projectLinks);
  if (projectLinks.length > 0) return true;

  const gptLinks = resolveAllElements(GPT_LIST.gptCards);
  if (gptLinks.length > 0) return true;

  // Last resort: any <nav> with multiple <a> links indicates a logged-in sidebar
  const nav = document.querySelector("nav");
  if (nav && nav.querySelectorAll("a").length >= 3) return true;

  return false;
}

// ─── Page Detection ─────────────────────────────────────────

type ChatGPTPage =
  | "gpt_editor"
  | "gpt_list"
  | "project"
  | "settings"
  | "chat"
  | "unknown";

function detectPage(): ChatGPTPage {
  const url = window.location.href;
  if (url.includes("/gpts/editor")) return "gpt_editor";
  if (url.includes("/gpts/mine") || url.includes("/gpts")) return "gpt_list";
  if (/\/project\/[a-zA-Z0-9-]+/.test(url)) return "project";
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
    warn(warnings, "GPT extraction", "Could not find the GPT name. The page may not be loaded yet.");
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
      warn(warnings, "GPT list", "No GPT cards found. The page may not be loaded yet.");
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
        warn(warnings, `GPT ${name}`, "Only the name and description were read from the list. Open the GPT's editor to read its full setup.");
      }
    }
  } else {
    warn(warnings, "GPT extraction", `Wrong page for GPT extraction (detected: ${page}). Navigate to chatgpt.com/gpts/mine or a GPT editor page.`);
  }

  return { success: gpts.length > 0 || warnings.length === 0, gpts, warnings };
}

// ─── Project Extraction ─────────────────────────────────────

/**
 * Open the "Project settings" modal, read the instructions textarea, and close it.
 * Returns the instructions text, or empty string if the modal could not be opened.
 */
async function extractInstructionsFromModal(
  warnings: ExtractionWarning[],
): Promise<string> {
  // Helper: click an element via the service worker's MAIN world execution.
  // Content script events are untrusted (isolated world), so Radix UI ignores
  // them. MAIN world .click() is treated as a real user event.
  async function clickInMainWorld(selector: string): Promise<boolean> {
    try {
      return await sendMessage("CLICK_IN_MAIN_WORLD", { selector });
    } catch {
      console.log(`[PortSmith] CLICK_IN_MAIN_WORLD failed for: ${selector}`);
      return false;
    }
  }

  // 1. Find and click the three-dot (⋯) menu button to open the dropdown.
  //    We probe in the content script to find which selector works, then
  //    execute the click in MAIN world.
  const threeDotSelectors = [
    'button[aria-label="Show project details"]',
    'button[aria-label="Project actions"]',
    'button[aria-label="More options"]',
  ];

  let threeDotFound = false;
  for (const sel of threeDotSelectors) {
    if (document.querySelector(sel)) {
      threeDotFound = await clickInMainWorld(sel);
      if (threeDotFound) {
        break;
      }
    }
  }

  // Fallback: find button by text content, tag it with a temporary attribute,
  // then click via that attribute in MAIN world
  if (!threeDotFound) {
    const candidates = document.querySelectorAll<HTMLElement>("button");
    for (const btn of candidates) {
      const text = btn.textContent?.trim() ?? "";
      if (text === "⋯" || text === "···" || text === "…") {
        btn.setAttribute("data-portsmith-threedot", "true");
        threeDotFound = await clickInMainWorld('button[data-portsmith-threedot="true"]');
        btn.removeAttribute("data-portsmith-threedot");
        if (threeDotFound) {
          break;
        }
      }
    }
  }

  // Last resort: icon-only SVG button near top-right
  if (!threeDotFound) {
    const candidates = document.querySelectorAll<HTMLElement>("button");
    for (const btn of candidates) {
      const text = btn.textContent?.trim() ?? "";
      const hasSvg = btn.querySelector("svg") !== null;
      const rect = btn.getBoundingClientRect();
      if (!text && hasSvg && rect.top < 120 && rect.right > window.innerWidth - 200) {
        btn.setAttribute("data-portsmith-threedot", "true");
        threeDotFound = await clickInMainWorld('button[data-portsmith-threedot="true"]');
        btn.removeAttribute("data-portsmith-threedot");
        if (threeDotFound) {
          break;
        }
      }
    }
  }

  if (!threeDotFound) {
    warn(warnings, "Project instructions", "Three-dot menu button not found, so the instructions were skipped");
    return "";
  }

  // Wait for dropdown to render
  await new Promise<void>((r) => setTimeout(r, 500));

  // 2. Find and click "Project settings" inside the dropdown
  let settingsClicked = false;

  // Try data-testid first
  if (document.querySelector('button[data-testid="project-modal-trigger"]')) {
    settingsClicked = await clickInMainWorld('button[data-testid="project-modal-trigger"]');
  }

  // Fallback: find by text, tag temporarily, click in MAIN world
  if (!settingsClicked) {
    const items = document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menu"] button, button',
    );
    for (const item of items) {
      if (item.textContent?.trim() === "Project settings") {
        item.setAttribute("data-portsmith-settings", "true");
        settingsClicked = await clickInMainWorld('[data-portsmith-settings="true"]');
        item.removeAttribute("data-portsmith-settings");
        if (settingsClicked) break;
      }
    }
  }

  if (!settingsClicked) {
    // Close the dropdown before returning
    await clickInMainWorld('[role="menu"]').catch(() => {});
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", bubbles: true,
    }));
    await new Promise<void>((r) => setTimeout(r, 200));
    warn(warnings, "Project instructions", '"Project settings" item not found in the menu, so the instructions were skipped');
    return "";
  }

  // 3. Wait for the Radix dialog modal to appear
  const modalResult = await waitForSelector(
    PROJECT_PAGE.settingsModal,
    ELEMENT_WAIT_TIMEOUT_MS,
  );

  if (!modalResult.success) {
    console.log("[PortSmith] Project instructions: modal failed to open after clicking Project settings");
    warn(warnings, "Project instructions", "Settings modal did not open within timeout");
    return "";
  }

  // 4. Find the instructions textarea inside the form
  const textareaResult = resolveSelector(PROJECT_PAGE.modalInstructions);
  let instructions = "";

  if (textareaResult.success) {
    const el = textareaResult.element;
    if (el instanceof HTMLTextAreaElement) {
      instructions = el.value.trim();
    } else {
      instructions = el.textContent?.trim() ?? "";
    }
    console.log(`[PortSmith] Project instructions: found ${instructions.length} chars`);
  } else {
    console.log("[PortSmith] Project instructions: textarea not found in modal");
    warn(warnings, "Project instructions", "Instructions textarea not found inside settings modal");
  }

  // 5. Close the modal via MAIN world click, fallback to Escape
  const closeBtnClicked = await clickInMainWorld(
    '[role="dialog"] button[aria-label="Close"]',
  );
  if (!closeBtnClicked) {
    // Try any button with SVG inside the dialog (common close icon pattern)
    const closed = await clickInMainWorld('[role="dialog"] button:has(svg)');
    if (!closed) {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }));
    }
  }

  // Brief wait for modal close animation
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  return instructions;
}

// ─── File Blob Download ─────────────────────────────────────

/** Files are passed around as base64 in runtime messages; keep them modest. */
const MAX_DOWNLOAD_BYTES = 7_500_000;

interface FileDownloadResult {
  contentRef?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Download a single file blob directly from ChatGPT's backend API.
 * Runs in the content script (same-origin), so the service worker
 * can't die mid-request.
 */
async function downloadFileBlob(
  fileId: string,
  gizmoId: string,
): Promise<{
  success: boolean;
  blob?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  error?: string;
}> {
  try {
    // Step 1: Get access token from ChatGPT session
    const sessionResp = await fetch("/api/auth/session");
    if (!sessionResp.ok) return { success: false, error: "Failed to get session" };
    const session = (await sessionResp.json()) as Record<string, unknown>;
    const token = session.accessToken as string | undefined;
    if (!token) return { success: false, error: "No access token" };

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    // Step 2: Get signed download URL
    console.log("[PortSmith] Fetching download URL for:", fileId);
    const dlResp = await fetch(
      `/backend-api/files/download/${encodeURIComponent(fileId)}?gizmo_id=${encodeURIComponent(gizmoId)}`,
      { headers },
    );
    if (!dlResp.ok) return { success: false, error: `HTTP ${dlResp.status}` };
    const dlData = (await dlResp.json()) as { download_url?: string };
    if (!dlData.download_url) return { success: false, error: "No download URL" };

    // Step 3: Get file metadata
    let meta: { file_name?: string; mime_type?: string } = {};
    try {
      const metaResp = await fetch(
        `/backend-api/files/${encodeURIComponent(fileId)}/simple?gizmo_id=${encodeURIComponent(gizmoId)}`,
        { headers },
      );
      if (metaResp.ok) meta = (await metaResp.json()) as typeof meta;
    } catch {
      // Non-fatal: metadata is nice-to-have
    }

    // Step 4: Download the actual file blob
    console.log("[PortSmith] Downloading blob for:", meta.file_name ?? fileId);
    const blobResp = await fetch(dlData.download_url);
    if (!blobResp.ok) return { success: false, error: `Blob HTTP ${blobResp.status}` };

    const arrayBuffer = await blobResp.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      return { success: false, error: `Too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB)` };
    }

    // Base64 encode in chunks to avoid call stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }

    console.log("[PortSmith] File downloaded:", meta.file_name ?? fileId, `(${(bytes.length / 1024).toFixed(1)}KB)`);

    return {
      success: true,
      blob: btoa(binary),
      fileName: meta.file_name ?? undefined,
      mimeType: meta.mime_type ?? blobResp.headers.get("content-type") ?? "application/octet-stream",
      sizeBytes: bytes.length,
    };
  } catch (e: unknown) {
    console.error("[PortSmith] Download error for", fileId, e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download file blobs from ChatGPT for a project's knowledge files.
 * Downloads happen in parallel via direct fetch (same-origin content script).
 * Blobs are sent to the service worker for IndexedDB storage.
 * Failures are non-blocking — files without blobs fall back to manual upload.
 */
async function downloadFileBlobs(
  files: Array<{ id?: string; name: string; type: string; size: number }>,
  gizmoId: string,
  projectName: string,
  warnings: ExtractionWarning[],
): Promise<Array<FileDownloadResult | null>> {
  const downloadable = files.filter((f) => f.id);
  if (downloadable.length === 0) return files.map(() => null);

  console.log(
    `[PortSmith] Downloading ${downloadable.length} file(s) for "${projectName}"`,
  );
  sendMessage("EXTRACT_PROGRESS", {
    step: `Downloading ${downloadable.length} file(s) for "${projectName}"`,
    percent: 50,
  }).catch(() => {});

  const promises = files.map(async (f): Promise<FileDownloadResult | null> => {
    if (!f.id) return null;
    if (typeof f.size === "number" && f.size > MAX_DOWNLOAD_BYTES) {
      return {
        error: `too large to copy (${(f.size / 1024 / 1024).toFixed(1)} MB)`,
      };
    }

    try {
      console.log(`[PortSmith] Downloading: ${f.name} (${f.id})`);
      const result = await downloadFileBlob(f.id, gizmoId);

      if (result.success && result.blob) {
        // Store in extension's IndexedDB via service worker
        const storeResult = await sendMessage("STORE_DOWNLOADED_FILE", {
          fileId: f.id,
          blob: result.blob,
          mimeType: result.mimeType ?? f.type,
          fileName: result.fileName ?? f.name,
        });

        const contentRef = storeResult?.contentRef ?? null;
        if (contentRef) {
          console.log(`[PortSmith] Downloaded: ${f.name} → ${contentRef}`);
          return {
            contentRef,
            fileName: result.fileName ?? f.name,
            mimeType: result.mimeType ?? f.type,
            sizeBytes: result.sizeBytes,
          };
        } else {
          console.log(`[PortSmith] Store failed: ${f.name}: ${storeResult?.error}`);
          return { error: storeResult?.error ?? "Failed to store file" };
        }
      } else {
        console.log(`[PortSmith] Download failed: ${f.name}: ${result.error}`);
        return { error: result.error };
      }
    } catch (e) {
      console.log(`[PortSmith] Download error: ${f.name}`, e);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  const results = await Promise.allSettled(promises);
  const resolved = results.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );

  const succeeded = resolved.filter((r) => r?.contentRef).length;
  const failed = downloadable.length - succeeded;
  console.log(
    `[PortSmith] File downloads complete: ${succeeded} succeeded, ${failed} failed`,
  );
  resolved.forEach((r, i) => {
    if (r && !r.contentRef && r.error) {
      warn(
        warnings,
        `Project "${projectName}"`,
        `Couldn't copy "${files[i]?.name ?? "a file"}" (${r.error}); upload it by hand`,
      );
    }
  });

  return resolved;
}

/**
 * Extract a single ChatGPT Project via the backend API (preferred)
 * with DOM fallback if the API fails.
 *
 * @param gizmoId  The gizmo ID (e.g. "g-p-6882b4..."). When provided,
 *                 the API path is used. When omitted, falls back to
 *                 DOM-based extraction on the current project page.
 * @param sidebarName  Project name from the sidebar scan (used as hint
 *                     when API doesn't return a name).
 */
async function extractSingleProject(
  warnings: ExtractionWarning[],
  gizmoId?: string,
  sidebarName?: string,
): Promise<ExtractedChatGPTProject | null> {
  // ── API-first path ────────────────────────────────────────
  if (gizmoId) {
    try {
      const apiResult: GizmoAPIResponse = await sendMessage("FETCH_GIZMO_API", { gizmoId });

      if (apiResult.error) {
        warn(warnings, `Project "${sidebarName ?? gizmoId}"`, `API error (${apiResult.error}); reading the page instead`);
      } else {
        const gizmo = apiResult.gizmo;
        const instructions = gizmo?.instructions ?? "";
        const name = gizmo?.display?.name ?? sidebarName ?? "Unknown Project";
        const description = gizmo?.display?.description ?? "";
        const apiFiles = apiResult.files ?? [];
        const knowledgeFileNames = apiFiles.map((f) => f.name);

        // Download file blobs in parallel (non-blocking — failures fall back to manual)
        const downloadResults = await downloadFileBlobs(apiFiles, gizmoId, name, warnings);

        const knowledgeFileMetadata: ExtractedFileMetadata[] = apiFiles.map(
          (f, i) => {
            const dl = downloadResults[i];
            return {
              name: f.name,
              type: f.type,
              size: f.size,
              id: f.id,
              contentRef: dl?.contentRef,
            };
          },
        );

        return {
          id: gizmoId,
          name,
          description,
          instructions,
          knowledgeFileNames,
          knowledgeFileMetadata,
          conversationCount: 0,
        };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      warn(warnings, `Project "${sidebarName ?? gizmoId}"`, `API call failed (${errMsg}); reading the page instead`);
    }
  }

  // ── DOM fallback path (original extractSingleProject logic) ─
  // Only read the page when it is this project's page. Otherwise the
  // fallback would read (and click through) whatever page is open and
  // attribute it to the wrong project.
  if (gizmoId) {
    const bareId = normalizeGizmoId(gizmoId);
    // The project's own page (/g/<id>-<slug>/project), not a chat inside it
    const onThisProject =
      bareId !== null &&
      new RegExp(`^/g/${bareId.replace(/[^\w-]/g, "")}(?:-[^/]*)?/project/?$`, "i").test(
        window.location.pathname,
      );
    if (!onThisProject) {
      warn(
        warnings,
        `Project "${sidebarName ?? gizmoId}"`,
        "Couldn't read this project's settings. Open the project in ChatGPT and read your data again, or add its instructions in the editor.",
      );
      return sidebarName
        ? {
            id: bareId ?? gizmoId,
            name: sidebarName,
            description: "",
            instructions: "",
            knowledgeFileNames: [],
            conversationCount: 0,
            incomplete: true,
          }
        : null;
    }
  }

  const name = await readTextAsync(PROJECT_PAGE.name, "Project name", warnings);
  if (!name) {
    warn(warnings, "Project extraction", "Could not find the project name. The page may not be loaded yet.");
    return null;
  }

  // Open the settings modal to read instructions
  const instructions = await extractInstructionsFromModal(warnings);

  const fileElements = resolveAllElements(PROJECT_PAGE.knowledgeFiles);
  const knowledgeFileNames: string[] = [];
  for (const el of fileElements) {
    const fileName = el.textContent?.trim();
    if (fileName) knowledgeFileNames.push(fileName);
  }

  const conversationElements = resolveAllElements(PROJECT_PAGE.conversations);
  const conversationCount = conversationElements.length;

  const urlMatch = window.location.pathname.match(/\/project\/([a-zA-Z0-9-]+)/);
  const id = gizmoId ?? urlMatch?.[1] ?? `proj-${Date.now()}`;

  return {
    id,
    name,
    description: "",
    instructions,
    knowledgeFileNames,
    conversationCount,
  };
}

/**
 * Discover ChatGPT Projects from the sidebar and extract via API.
 * Works on any ChatGPT page — no page navigation required.
 * Falls back to DOM extraction when the API is unavailable.
 */
export async function extractProjects(): Promise<ProjectExtractionResult> {
  console.log("[PortSmith] extractProjects() called");
  const warnings: ExtractionWarning[] = [];

  const loggedIn = await checkLoggedIn();
  console.log("[PortSmith] extractProjects checkLoggedIn:", loggedIn);
  if (!loggedIn) {
    return {
      success: false,
      projects: [],
      warnings: [{ context: "auth", message: "Not logged in to ChatGPT" }],
    };
  }

  const projects: ExtractedChatGPTProject[] = [];

  // Discover projects from the sidebar
  const sidebarLinks = resolveAllElements(PROJECT_SIDEBAR.projectLinks);
  console.log("[PortSmith] extractProjects sidebarLinks count:", sidebarLinks.length);
  if (sidebarLinks.length === 0) {
    warn(warnings, "Projects", "No project links found in the sidebar. The sidebar may be collapsed, or there are no projects.");
  }

  // Extract each project via the gizmo API (no navigation needed)
  const seen = new Set<string>();
  for (const link of sidebarLinks) {
    const href = link.getAttribute("href") ?? "";
    // Accept any gizmo ID format (g-p-xxx, g-xxx, etc.) without the slug
    const idMatch = href.match(/\/g\/([^/]+)\/project/);
    const gizmoId = idMatch?.[1] ? normalizeGizmoId(idMatch[1]) : null;
    if (!gizmoId || seen.has(gizmoId)) continue;
    seen.add(gizmoId);

    const name = link.textContent?.trim() ?? "Unknown Project";
    const project = await extractSingleProject(warnings, gizmoId, name);
    if (project) projects.push(project);
  }

  return { success: projects.length > 0 || warnings.length === 0, projects, warnings };
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
      "Memory list not found. Open Settings > Personalization > Memory, then try again.",
    );
    return { success: false, items: [], warnings };
  }

  // Find all memory items within the container
  const itemElements = resolveAllElements(SETTINGS_MEMORY.memoryItem);
  const items: ExtractedMemoryItem[] = [];

  if (itemElements.length === 0) {
    warn(warnings, "memory", "No memory items found. Memory may be empty, or the list hasn't loaded.");
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
      "Custom instructions fields not found. Open the Custom instructions panel, then try again.",
    );
    return { success: false, instructions: null, warnings };
  }

  return {
    success: true,
    instructions: { aboutUser, responsePreferences },
    warnings,
  };
}

// ─── Sidebar Scanning ───────────────────────────────────────

/**
 * Scan the ChatGPT sidebar for project and GPT links.
 * Works on any chatgpt.com page where the sidebar is visible.
 * Synchronous — reads currently visible DOM only.
 */
export function scanSidebar(): SidebarScanResult {
  const projects: SidebarScanResult["projects"] = [];
  const gpts: SidebarScanResult["gpts"] = [];

  // Projects: sidebar <a> elements whose href ends with /project
  // Example href: /g/g-p-68fbd0de40248191a303c2a93435081a-japan-china-korea-trip/project
  const projectLinks = resolveAllElements(PROJECT_SIDEBAR.projectLinks);
  console.log(
    `[PortSmith] scanSidebar: ${projectLinks.length} project links found`,
  );
  const seenProjects = new Set<string>();
  for (const link of projectLinks) {
    const href = link.getAttribute("href") ?? "";
    // Extract gizmo ID from /g/<id>/project and drop the readable slug
    const idMatch = href.match(/\/g\/([^/]+)\/project/);
    const id = idMatch?.[1] ? normalizeGizmoId(idMatch[1]) : null;
    if (!id || seenProjects.has(id)) continue;
    seenProjects.add(id);

    const name = link.textContent?.trim() ?? "Unknown Project";
    const url = href.startsWith("http") ? href : `https://chatgpt.com${href}`;

    projects.push({ id, name, url });
  }

  // GPTs: sidebar <a> elements with href /g/g-<id> (excluding projects)
  // Example href: /g/g-1Z8uzeu5R-resume-wizard
  const gptLinks = resolveAllElements(GPT_LIST.gptCards);
  console.log(
    `[PortSmith] scanSidebar: ${gptLinks.length} GPT links found`,
  );
  const seenGpts = new Set<string>();
  for (const link of gptLinks) {
    const href = link.getAttribute("href") ?? "";
    // Project pages and chats inside projects/GPTs also live under /g/;
    // they are not GPT entries.
    if (/\/g\/g-p-/.test(href) || /\/c\//.test(href)) continue;
    // Extract GPT ID (g-xxx) from /g/<id>
    // Also handle legacy /gpts/editor/<id> URLs
    const sidebarMatch = href.match(/\/g\/(g-[^/]+)/);
    const editorMatch = href.match(/\/gpts\/editor\/([^/?]+)/);
    const raw = sidebarMatch?.[1] ?? editorMatch?.[1] ?? "";
    const id = raw ? normalizeGizmoId(raw) : null;
    if (!id || seenGpts.has(id)) continue;
    seenGpts.add(id);

    const name = link.textContent?.trim() ?? "Unknown GPT";
    const url = href.startsWith("http") ? href : `https://chatgpt.com${href}`;

    gpts.push({ id, name, url });
  }

  return { projects, gpts };
}

// ─── DOM Inspection ─────────────────────────────────────────

/**
 * Inspect the current page DOM and return a structured report.
 * Used for debugging and as a readiness probe after navigation.
 * Synchronous — fast enough for polling.
 */
export function inspectDOM(): DOMInspectionReport {
  const page = detectPage();
  const loginResult = resolveSelector(LOGIN_AVATAR);
  const sidebar = scanSidebar();

  return {
    url: window.location.href,
    page,
    loggedIn: loginResult.success,
    sidebarProjectCount: sidebar.projects.length,
    sidebarGPTCount: sidebar.gpts.length,
    timestamp: Date.now(),
  };
}

// ─── Single-Page Project Extraction ─────────────────────────

/**
 * Extract the current project page's data.
 * Called by the side panel after navigating the tab to a /project/<id> URL.
 * Tries API extraction first using the gizmo ID from the URL.
 * Returns a ProjectExtractionResult with the single project (or empty).
 */
export async function extractProjectPage(): Promise<ProjectExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  // Try to extract gizmo ID from the current URL for API-first extraction
  const urlMatch = window.location.pathname.match(/\/g\/([^/]+)\/project/);
  const gizmoId = urlMatch?.[1];

  const project = await extractSingleProject(warnings, gizmoId);
  return {
    success: !!project,
    projects: project ? [project] : [],
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
        case "projects": {
          const result = await extractProjects();
          sendMessage("DOM_EXTRACT_RESULT", { type: "projects", data: result }).catch(() => {});
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
          console.warn(`[PortSmith] Unknown extraction target: ${target}`);
      }

      sendMessage("EXTRACT_PROGRESS", { step: `Finished ${target}`, percent: 100 }).catch(() => {});
    } catch (err) {
      console.error("[PortSmith] Extraction error:", err);
      // Always answer, so the side panel doesn't sit out its timeout.
      const warnings = [
        {
          context: target,
          message: `Reading ${target.replace(/_/g, " ")} failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ];
      const failed = (() => {
        switch (target) {
          case "custom_gpts":
            return { type: "custom_gpts" as const, data: { success: false, gpts: [], warnings } };
          case "projects":
            return { type: "projects" as const, data: { success: false, projects: [], warnings } };
          case "memory":
            return { type: "memory" as const, data: { success: false, items: [], warnings } };
          default:
            return {
              type: "custom_instructions" as const,
              data: { success: false, instructions: null, warnings },
            };
        }
      })();
      sendMessage("DOM_EXTRACT_RESULT", failed).catch(() => {});
    }
  };

  void run();
}

// ─── Init ───────────────────────────────────────────────────

function init(): void {
  // Re-injection (e.g. after an extension update) must re-register
  // handlers, so there is no "already initialized" early return: handler
  // registration and initMessageRouter() are both idempotent.
  console.log("[PortSmith] Content script injected on ChatGPT");

  initMessageRouter();

  onMessage("DOM_EXTRACT", (payload) => {
    handleExtractRequest(payload.target);
    return { success: true };
  });

  onMessage("DOM_INSPECT", () => {
    return inspectDOM();
  });

  onMessage("PING", () => {
    return { pong: true as const };
  });

  onMessage("SCAN_SIDEBAR", () => {
    return scanSidebar();
  });

  onMessage("EXTRACT_PROJECT_PAGE", async () => {
      return extractProjectPage();
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
