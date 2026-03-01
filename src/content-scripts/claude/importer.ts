import { waitForSelector } from "@/content-scripts/common/selector-engine";
import type { SelectorStrategy } from "@/content-scripts/common/selector-engine";
import { SELECTOR_MAP } from "./selectors";
import {
  onMessage,
  initMessageRouter,
  type AutofillAction,
} from "@/shared/messaging";

// ─── DOM Action Helpers ─────────────────────────────────────

function clickElement(el: Element): void {
  if (el instanceof HTMLElement) {
    el.focus();
    el.click();
  } else {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

function fillElement(el: Element, value: string, clear: boolean): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (clear) el.value = "";
    // Use native setter to trigger React's onChange
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, clear ? value : el.value + value);
    } else {
      el.value = clear ? value : el.value + value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (
    el instanceof HTMLElement &&
    el.getAttribute("contenteditable") === "true"
  ) {
    if (clear) el.textContent = "";
    el.textContent = (clear ? "" : el.textContent ?? "") + value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function executeAction(
  action: AutofillAction,
  strategies: SelectorStrategy[],
  value?: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await waitForSelector(strategies, 5000);
  if (!result.success) {
    const tried = result.triedStrategies
      .map((t) => `${t.strategy.type}:${t.strategy.value}`)
      .join(", ");
    return { success: false, error: `Selector not found. Tried: ${tried}` };
  }

  try {
    switch (action) {
      case "click":
        clickElement(result.element);
        break;
      case "fill":
        fillElement(result.element, value ?? "", false);
        break;
      case "clear_and_fill":
        fillElement(result.element, value ?? "", true);
        break;
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Message Handler ────────────────────────────────────────

onMessage("AUTOFILL_EXECUTE", (payload) => {
  const strategies =
    SELECTOR_MAP[payload.target as keyof typeof SELECTOR_MAP] as
      | SelectorStrategy[]
      | undefined;
  if (!strategies) {
    return Promise.resolve({
      success: false,
      error: `Unknown selector target: ${payload.target}`,
    });
  }
  return executeAction(payload.action, strategies, payload.value);
});

// ─── Navigation Detection Handler ──────────────────────────

onMessage("WAIT_FOR_NAVIGATION", (payload) => {
  return new Promise((resolve) => {
    const urlRegex = new RegExp(payload.urlPattern);

    // Check immediately
    if (urlRegex.test(window.location.href)) {
      resolve({ success: true, currentUrl: window.location.href });
      return;
    }

    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let urlPollInterval: ReturnType<typeof setInterval> | undefined;

    function cleanup(): void {
      if (observer) {
        observer.disconnect();
        observer = undefined;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (urlPollInterval !== undefined) {
        clearInterval(urlPollInterval);
        urlPollInterval = undefined;
      }
    }

    // Strategy 1: Poll window.location.href for SPA pushState changes
    urlPollInterval = setInterval(() => {
      if (urlRegex.test(window.location.href)) {
        cleanup();
        resolve({ success: true, currentUrl: window.location.href });
      }
    }, 200);

    // Strategy 2: MutationObserver catches DOM changes during navigation
    observer = new MutationObserver(() => {
      if (urlRegex.test(window.location.href)) {
        cleanup();
        resolve({ success: true, currentUrl: window.location.href });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout
    timer = setTimeout(() => {
      cleanup();
      resolve({
        success: false,
        currentUrl: window.location.href,
        error: `Navigation timeout: URL did not match "${payload.urlPattern}" within ${payload.timeoutMs}ms`,
      });
    }, payload.timeoutMs);
  });
});

// ─── Clipboard Handler ─────────────────────────────────────

onMessage("CLIPBOARD_WRITE", async (payload) => {
  try {
    await navigator.clipboard.writeText(payload.text);
    return { success: true };
  } catch {
    // Fallback for non-secure contexts or permission denial
    try {
      const textarea = document.createElement("textarea");
      textarea.value = payload.text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
});

// ─── Compound Instructions Handler ────────────────────────

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find the Instructions section container by scanning for its heading text.
 * Returns the nearest ancestor container that wraps the section.
 */
function findInstructionsSection(): HTMLElement | null {
  // Strategy 1: Find exact "Instructions" heading text
  const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6, div, span, p");
  for (const el of headings) {
    const text = el.textContent?.trim();
    if (text === "Instructions" && el.children.length <= 1) {
      // Walk up to find a reasonable container (section, or a div with siblings)
      const container = el.closest("section, [role='region']") as HTMLElement | null;
      if (container) return container;
      // Fallback: use the parent or grandparent
      const parent = el.parentElement;
      if (parent) return parent;
    }
  }

  // Strategy 2: Find by subtext "Add instructions to tailor"
  const allElements = document.querySelectorAll("p, span, div");
  for (const el of allElements) {
    if (el.textContent?.includes("Add instructions to tailor")) {
      const container = el.closest("section, [role='region']") as HTMLElement | null;
      if (container) return container;
      const parent = el.parentElement;
      if (parent) return parent;
    }
  }

  return null;
}

/**
 * Find the "+" or "Add" button within or near the Instructions section.
 */
function findAddButtonInSection(section: HTMLElement): HTMLElement | null {
  // Strategy 1: button with "+" text or add-related aria label
  const buttons = section.querySelectorAll(
    'button, [role="button"], [aria-label*="add" i], [aria-label*="Add" i]',
  );
  for (const btn of buttons) {
    if (btn instanceof HTMLElement) return btn;
  }

  // Strategy 2: Look for an SVG-based icon button (common pattern for "+")
  const svgButtons = section.querySelectorAll("svg");
  for (const svg of svgButtons) {
    const clickable = svg.closest("button, [role='button'], a") as HTMLElement | null;
    if (clickable) return clickable;
  }

  // Strategy 3: Any clickable element near the section heading
  const heading = section.querySelector("h1, h2, h3, h4, h5, h6, [class*='heading']");
  if (heading) {
    const sibling = heading.parentElement;
    if (sibling) {
      const btn = sibling.querySelector("button, [role='button']") as HTMLElement | null;
      if (btn) return btn;
    }
  }

  return null;
}

/**
 * After clicking the add button, find the modal dialog that appeared and
 * return its textarea. The "Set project instructions" modal is rendered as
 * a dialog overlay with a `<textarea>` inside.
 */
async function findModalTextarea(timeoutMs = 5000): Promise<HTMLTextAreaElement | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Strategy 1: Find textarea inside a dialog/modal overlay
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [data-testid*="modal"], [aria-modal="true"]',
    );
    for (const dialog of dialogs) {
      const textarea = dialog.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) return textarea;
    }

    // Strategy 2: Find textarea by placeholder text unique to the instructions modal
    const byPlaceholder = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder*="Think step by step"], textarea[placeholder*="complex problems"]',
    );
    if (byPlaceholder) return byPlaceholder;

    // Strategy 3: Find by proximity to "Save instructions" button
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() ?? "";
      if (text === "save instructions") {
        // Walk up to find the modal container, then its textarea
        let container: HTMLElement | null = btn;
        for (let i = 0; i < 10 && container; i++) {
          const textarea = container.querySelector("textarea");
          if (textarea instanceof HTMLTextAreaElement) return textarea;
          container = container.parentElement;
        }
      }
    }

    await delayMs(200);
  }

  return null;
}

/**
 * Find the "Save instructions" button within the modal.
 * Scopes the search to the modal container to avoid matching unrelated buttons.
 */
function findModalSaveButton(textarea: HTMLTextAreaElement): HTMLElement | null {
  // Walk up from the textarea to find the modal container, then search within it
  let container: HTMLElement | null = textarea;
  for (let i = 0; i < 15 && container; i++) {
    const role = container.getAttribute("role");
    const isModal = role === "dialog" ||
      container.getAttribute("aria-modal") === "true" ||
      container.getAttribute("data-testid")?.includes("modal");

    if (isModal) {
      const buttons = container.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() ?? "";
        if (text === "save instructions" || text === "save" || text === "done") {
          if (btn instanceof HTMLElement) return btn;
        }
      }
    }
    container = container.parentElement;
  }

  // Fallback: search all buttons on the page for "Save instructions" specifically
  const buttons = document.querySelectorAll("button, [role='button']");
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() ?? "";
    if (text === "save instructions") {
      if (btn instanceof HTMLElement) return btn;
    }
  }
  return null;
}

onMessage("FILL_PROJECT_INSTRUCTIONS", async (payload) => {
  try {
    // Step 1: Find the Instructions section by its text label
    const section = findInstructionsSection();
    if (!section) {
      return { success: false, error: "Instructions section not found on page" };
    }

    // Scroll the section into view
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    await delayMs(500);

    // Step 2: Click the "+" / add button within the section
    const addButton = findAddButtonInSection(section);
    if (!addButton) {
      return { success: false, error: "Add instructions button not found in section" };
    }
    addButton.click();
    await delayMs(1000);

    // Step 3: Find the modal textarea (NOT the chat input)
    const textarea = await findModalTextarea(5000);
    if (!textarea) {
      return { success: false, error: "Instructions textarea not found in modal" };
    }

    // Step 4: Focus the textarea before filling (required for React state updates)
    textarea.focus();
    textarea.click();
    await delayMs(100);

    // Step 5: Fill the textarea using React-compatible value setter
    fillElement(textarea, payload.instructions, true);
    await delayMs(300);

    // Step 6: Verify the fill actually worked
    const filled = textarea.value.length > 0;
    if (!filled) {
      console.log("[PortSmith] Instructions fill failed — textarea still empty after fill");
      return { success: false, error: "Instructions fill failed — textarea still empty after fill" };
    }

    // Step 7: Click "Save instructions" in the modal
    const saveButton = findModalSaveButton(textarea);
    if (saveButton) {
      saveButton.click();
      await delayMs(500);
      return { success: true, saved: true };
    }

    return { success: true, saved: false };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// ─── Page URL Handler ──────────────────────────────────────

onMessage("GET_PAGE_URL", () => {
  return { url: window.location.href };
});

// ─── Verification Handler ──────────────────────────────────

onMessage("VERIFY_PROJECTS", (payload) => {
  const found: string[] = [];
  const notFound: string[] = [];

  // Scan the projects page for matching project names.
  // Claude renders projects as links, headings, or labeled elements.
  const candidates = document.querySelectorAll(
    'a[href*="/project/"], [data-testid*="project"], h3, h4, .font-medium, [class*="project"]',
  );

  const pageTexts = Array.from(candidates)
    .map((el) => el.textContent?.trim().toLowerCase() ?? "")
    .filter(Boolean);

  for (const name of payload.projectNames) {
    const normalized = name.toLowerCase().trim();
    const match = pageTexts.some((text) => text === normalized);
    if (match) {
      found.push(name);
    } else {
      notFound.push(name);
    }
  }

  return { found, notFound };
});

// ─── Ping Handler ───────────────────────────────────────────

onMessage("PING", () => {
  return { pong: true as const };
});

// ─── Init ───────────────────────────────────────────────────

initMessageRouter();
console.log("[PortSmith] Claude importer content script loaded");
