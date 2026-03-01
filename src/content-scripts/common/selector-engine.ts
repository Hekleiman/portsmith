// ─── Types ───────────────────────────────────────────────────

export type StrategyType = "testid" | "aria" | "css" | "xpath" | "text";

export interface SelectorStrategy {
  priority: number;
  type: StrategyType;
  value: string;
  lastVerified?: string;
}

export type SelectorResult =
  | { success: true; element: Element; strategyUsed: SelectorStrategy }
  | {
      success: false;
      triedStrategies: Array<{
        strategy: SelectorStrategy;
        error?: string;
      }>;
    };

// ─── Strategy Resolvers ──────────────────────────────────────

const TEXT_TAGS = ["button", "span", "div", "a", "label"] as const;

function resolveByTestId(value: string): Element | null {
  return document.querySelector(`[data-testid="${value}"]`);
}

function resolveByAria(value: string): Element | null {
  return document.querySelector(`[aria-label="${value}"]`);
}

function resolveByCss(value: string): Element | null {
  try {
    return document.querySelector(value);
  } catch {
    return null;
  }
}

function resolveByXpath(value: string): Element | null {
  try {
    const result = document.evaluate(
      value,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    const node = result.singleNodeValue;
    return node instanceof Element ? node : null;
  } catch {
    return null;
  }
}

function resolveByText(value: string): Element | null {
  const selector = TEXT_TAGS.join(", ");
  const candidates = document.querySelectorAll(selector);
  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (text !== undefined && text === value) {
      return el;
    }
  }
  return null;
}

function resolveOne(strategy: SelectorStrategy): Element | null {
  switch (strategy.type) {
    case "testid":
      return resolveByTestId(strategy.value);
    case "aria":
      return resolveByAria(strategy.value);
    case "css":
      return resolveByCss(strategy.value);
    case "xpath":
      return resolveByXpath(strategy.value);
    case "text":
      return resolveByText(strategy.value);
  }
}

// ─── Public API ──────────────────────────────────────────────

export function resolveSelector(
  strategies: SelectorStrategy[],
): SelectorResult {
  const sorted = [...strategies].sort((a, b) => a.priority - b.priority);
  const tried: Array<{ strategy: SelectorStrategy; error?: string }> = [];

  for (const strategy of sorted) {
    try {
      const element = resolveOne(strategy);
      if (element) {
        return { success: true, element, strategyUsed: strategy };
      }
      tried.push({ strategy });
    } catch (err) {
      tried.push({
        strategy,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { success: false, triedStrategies: tried };
}

export function waitForSelector(
  strategies: SelectorStrategy[],
  timeoutMs = 3000,
): Promise<SelectorResult> {
  return new Promise((resolve) => {
    // Try immediately first
    const immediate = resolveSelector(strategies);
    if (immediate.success) {
      resolve(immediate);
      return;
    }

    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanup(): void {
      if (observer) {
        observer.disconnect();
        observer = undefined;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    }

    observer = new MutationObserver(() => {
      const result = resolveSelector(strategies);
      if (result.success) {
        cleanup();
        resolve(result);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid", "aria-label", "class"],
    });

    timer = setTimeout(() => {
      cleanup();
      // One final attempt
      const finalResult = resolveSelector(strategies);
      resolve(finalResult);
    }, timeoutMs);
  });
}
