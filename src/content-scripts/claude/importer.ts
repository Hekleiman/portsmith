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

// ─── Init ───────────────────────────────────────────────────

initMessageRouter();
console.log("[Portsmith] Claude importer content script loaded");
