import {
  resolveSelector,
  waitForSelector,
  type SelectorStrategy,
  type SelectorResult,
} from "./selector-engine";

// ─── Action Results ──────────────────────────────────────────

export type ActionResult =
  | { success: true }
  | { success: false; reason: string; selectorResult: SelectorResult };

// ─── Helpers ─────────────────────────────────────────────────

function failedAction(
  reason: string,
  selectorResult: SelectorResult,
): ActionResult {
  return { success: false, reason, selectorResult };
}

// ─── Public API ──────────────────────────────────────────────

export function fillInput(
  strategies: SelectorStrategy[],
  value: string,
): ActionResult {
  const result = resolveSelector(strategies);
  if (!result.success) {
    return failedAction("Element not found", result);
  }

  const el = result.element;
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    return failedAction(
      `Expected input or textarea, got <${el.tagName.toLowerCase()}>`,
      result,
    );
  }

  // Use native setter to bypass React's synthetic event system
  const nativeSet = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )?.set;
  if (nativeSet) {
    nativeSet.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  return { success: true };
}

export function clickElement(strategies: SelectorStrategy[]): ActionResult {
  const result = resolveSelector(strategies);
  if (!result.success) {
    return failedAction("Element not found", result);
  }

  const el = result.element;
  if (!(el instanceof HTMLElement)) {
    return failedAction(
      `Element is not an HTMLElement, got <${el.tagName.toLowerCase()}>`,
      result,
    );
  }

  el.click();
  return { success: true };
}

export function uploadFile(
  strategies: SelectorStrategy[],
  file: File,
): ActionResult {
  const result = resolveSelector(strategies);
  if (!result.success) {
    return failedAction("Element not found", result);
  }

  const el = result.element;
  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    return failedAction(
      `Expected file input, got <${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? ` type="${el.type}"` : ""}>`,
      result,
    );
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  el.files = dt.files;
  el.dispatchEvent(new Event("change", { bubbles: true }));

  return { success: true };
}

export async function fillInputAsync(
  strategies: SelectorStrategy[],
  value: string,
  timeoutMs = 3000,
): Promise<ActionResult> {
  const result = await waitForSelector(strategies, timeoutMs);
  if (!result.success) {
    return failedAction("Element not found after waiting", result);
  }

  // Re-run fillInput now that we know the element exists
  return fillInput(strategies, value);
}

export async function clickElementAsync(
  strategies: SelectorStrategy[],
  timeoutMs = 3000,
): Promise<ActionResult> {
  const result = await waitForSelector(strategies, timeoutMs);
  if (!result.success) {
    return failedAction("Element not found after waiting", result);
  }

  return clickElement(strategies);
}

export { resolveSelector, waitForSelector, type SelectorStrategy };
