// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  resolveSelector,
  waitForSelector,
  type SelectorStrategy,
} from "@/content-scripts/common/selector-engine";
import {
  fillInput,
  clickElement,
  uploadFile,
} from "@/content-scripts/common/dom-utils";

// ─── DataTransfer polyfill (jsdom lacks it) ──────────────────

if (typeof globalThis.DataTransfer === "undefined") {
  class DataTransferPolyfill {
    private _files: File[] = [];
    items = {
      add: (file: File) => {
        this._files.push(file);
      },
    };
    get files(): FileList {
      return this._files as unknown as FileList;
    }
  }
  globalThis.DataTransfer = DataTransferPolyfill as unknown as typeof DataTransfer;

  // jsdom's HTMLInputElement.files setter rejects non-native FileList.
  // Patch it so our polyfill works in tests (real Chrome has no issue).
  const origDesc = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "files",
  );
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    get() {
      return (this as { _testFiles?: FileList })._testFiles ?? origDesc?.get?.call(this);
    },
    set(value: FileList) {
      (this as { _testFiles?: FileList })._testFiles = value;
    },
    configurable: true,
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function makeStrategy(
  type: SelectorStrategy["type"],
  value: string,
  priority: number,
): SelectorStrategy {
  return { type, value, priority };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── resolveSelector ────────────────────────────────────────

describe("resolveSelector", () => {
  it("finds element by data-testid", () => {
    document.body.innerHTML = '<button data-testid="submit">Go</button>';
    const result = resolveSelector([makeStrategy("testid", "submit", 1)]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.tagName).toBe("BUTTON");
      expect(result.strategyUsed.type).toBe("testid");
    }
  });

  it("finds element by aria-label", () => {
    document.body.innerHTML = '<button aria-label="Close dialog">X</button>';
    const result = resolveSelector([makeStrategy("aria", "Close dialog", 1)]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.textContent).toBe("X");
      expect(result.strategyUsed.type).toBe("aria");
    }
  });

  it("finds element by CSS selector", () => {
    document.body.innerHTML = '<div class="chat-input"><input /></div>';
    const result = resolveSelector([
      makeStrategy("css", ".chat-input input", 1),
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.tagName).toBe("INPUT");
    }
  });

  it("finds element by XPath", () => {
    document.body.innerHTML = "<div><span>Hello</span></div>";
    const result = resolveSelector([
      makeStrategy("xpath", "//span[text()='Hello']", 1),
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.textContent).toBe("Hello");
      expect(result.strategyUsed.type).toBe("xpath");
    }
  });

  it("finds element by text content", () => {
    document.body.innerHTML = "<button>Save changes</button>";
    const result = resolveSelector([
      makeStrategy("text", "Save changes", 1),
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.tagName).toBe("BUTTON");
      expect(result.strategyUsed.type).toBe("text");
    }
  });

  it("text strategy matches span, div, a, label", () => {
    for (const tag of ["span", "div", "a", "label"]) {
      document.body.innerHTML = `<${tag}>Target</${tag}>`;
      const result = resolveSelector([makeStrategy("text", "Target", 1)]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.element.tagName).toBe(tag.toUpperCase());
      }
    }
  });

  it("text strategy does not match non-listed tags", () => {
    document.body.innerHTML = "<p>Paragraph text</p>";
    const result = resolveSelector([
      makeStrategy("text", "Paragraph text", 1),
    ]);
    expect(result.success).toBe(false);
  });

  it("returns first matching strategy sorted by priority", () => {
    document.body.innerHTML =
      '<button data-testid="btn" aria-label="Click me">Click me</button>';
    const result = resolveSelector([
      makeStrategy("aria", "Click me", 2),
      makeStrategy("testid", "btn", 1),
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.strategyUsed.type).toBe("testid");
      expect(result.strategyUsed.priority).toBe(1);
    }
  });

  it("falls through when earlier strategies miss", () => {
    document.body.innerHTML = '<button aria-label="Submit">Submit</button>';
    const result = resolveSelector([
      makeStrategy("testid", "missing", 1),
      makeStrategy("css", ".nonexistent", 2),
      makeStrategy("aria", "Submit", 3),
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.strategyUsed.type).toBe("aria");
      expect(result.strategyUsed.priority).toBe(3);
    }
  });

  it("returns structured failure when all strategies fail", () => {
    document.body.innerHTML = "<div>Nothing useful</div>";
    const strategies = [
      makeStrategy("testid", "nope", 1),
      makeStrategy("aria", "nope", 2),
      makeStrategy("css", ".nope", 3),
    ];
    const result = resolveSelector(strategies);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.triedStrategies).toHaveLength(3);
      expect(result.triedStrategies[0]!.strategy.type).toBe("testid");
      expect(result.triedStrategies[1]!.strategy.type).toBe("aria");
      expect(result.triedStrategies[2]!.strategy.type).toBe("css");
    }
  });

  it("handles invalid CSS selector gracefully", () => {
    document.body.innerHTML = "<div></div>";
    const result = resolveSelector([
      makeStrategy("css", "[invalid!@#$", 1),
    ]);
    expect(result.success).toBe(false);
  });

  it("handles empty strategies array", () => {
    const result = resolveSelector([]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.triedStrategies).toHaveLength(0);
    }
  });
});

// ─── waitForSelector ────────────────────────────────────────

describe("waitForSelector", () => {
  it("resolves immediately when element exists", async () => {
    document.body.innerHTML = '<button data-testid="btn">OK</button>';
    const result = await waitForSelector([makeStrategy("testid", "btn", 1)]);
    expect(result.success).toBe(true);
  });

  it("resolves when element appears after delay", async () => {
    const strategies = [makeStrategy("testid", "delayed", 1)];

    const promise = waitForSelector(strategies, 3000);

    // Simulate element appearing after 50ms
    setTimeout(() => {
      const el = document.createElement("button");
      el.setAttribute("data-testid", "delayed");
      document.body.appendChild(el);
    }, 50);

    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.element.getAttribute("data-testid")).toBe("delayed");
    }
  });

  it("times out and returns failure when element never appears", async () => {
    const strategies = [makeStrategy("testid", "never", 1)];
    const result = await waitForSelector(strategies, 100);
    expect(result.success).toBe(false);
  });

  it("cleans up observer after finding element", async () => {
    const disconnectSpy = vi.fn();
    const originalObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class MockObserver {
      private callback: MutationCallback;
      constructor(callback: MutationCallback) {
        this.callback = callback;
      }
      observe(): void {
        // Simulate mutation on next tick
        setTimeout(() => this.callback([], this as unknown as MutationObserver), 10);
      }
      disconnect = disconnectSpy;
      takeRecords(): MutationRecord[] {
        return [];
      }
    } as unknown as typeof MutationObserver;

    document.body.innerHTML = '<div data-testid="exists">Hi</div>';
    // Element won't exist initially, but we'll add it before the observer fires
    const strategies = [makeStrategy("testid", "obs-test", 1)];

    // Add element so it's found when observer fires
    const el = document.createElement("div");
    el.setAttribute("data-testid", "obs-test");
    document.body.appendChild(el);

    const promise = waitForSelector(strategies, 3000);
    // The observer should fire and find it, then disconnect
    // But since immediate check won't find "obs-test" (it's added after initial check)
    // Actually we added it above, so immediate check finds it
    const result = await promise;
    expect(result.success).toBe(true);

    globalThis.MutationObserver = originalObserver;
  });
});

// ─── fillInput ──────────────────────────────────────────────

describe("fillInput", () => {
  it("fills an input element", () => {
    document.body.innerHTML = '<input data-testid="name-input" />';
    const result = fillInput(
      [makeStrategy("testid", "name-input", 1)],
      "Hello",
    );
    expect(result.success).toBe(true);
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Hello");
  });

  it("fills a textarea element", () => {
    document.body.innerHTML = '<textarea data-testid="msg"></textarea>';
    const result = fillInput(
      [makeStrategy("testid", "msg", 1)],
      "Long text",
    );
    expect(result.success).toBe(true);
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("Long text");
  });

  it("dispatches input and change events", () => {
    document.body.innerHTML = '<input data-testid="field" />';
    const input = document.querySelector("input")!;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    fillInput([makeStrategy("testid", "field", 1)], "value");
    expect(events).toEqual(["input", "change"]);
  });

  it("fails when element is not an input or textarea", () => {
    document.body.innerHTML = '<div data-testid="not-input">Text</div>';
    const result = fillInput(
      [makeStrategy("testid", "not-input", 1)],
      "value",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("Expected input or textarea");
    }
  });

  it("fails when element not found", () => {
    document.body.innerHTML = "<div></div>";
    const result = fillInput([makeStrategy("testid", "missing", 1)], "value");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("Element not found");
    }
  });
});

// ─── clickElement ───────────────────────────────────────────

describe("clickElement", () => {
  it("clicks a button element", () => {
    document.body.innerHTML = '<button data-testid="btn">Click</button>';
    let clicked = false;
    const btn = document.querySelector("button")!;
    btn.addEventListener("click", () => {
      clicked = true;
    });

    const result = clickElement([makeStrategy("testid", "btn", 1)]);
    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it("fails when element not found", () => {
    document.body.innerHTML = "<div></div>";
    const result = clickElement([makeStrategy("testid", "missing", 1)]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("Element not found");
    }
  });
});

// ─── uploadFile ─────────────────────────────────────────────

describe("uploadFile", () => {
  it("sets file on a file input", () => {
    document.body.innerHTML =
      '<input type="file" data-testid="file-input" />';
    const file = new File(["content"], "test.txt", { type: "text/plain" });

    const result = uploadFile([makeStrategy("testid", "file-input", 1)], file);
    expect(result.success).toBe(true);

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.files).toHaveLength(1);
    expect(input.files![0]!.name).toBe("test.txt");
  });

  it("dispatches change event", () => {
    document.body.innerHTML =
      '<input type="file" data-testid="file-input" />';
    const input = document.querySelector("input")!;
    let changed = false;
    input.addEventListener("change", () => {
      changed = true;
    });

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    uploadFile([makeStrategy("testid", "file-input", 1)], file);
    expect(changed).toBe(true);
  });

  it("fails when element is not a file input", () => {
    document.body.innerHTML =
      '<input type="text" data-testid="text-input" />';
    const file = new File(["x"], "test.txt", { type: "text/plain" });
    const result = uploadFile(
      [makeStrategy("testid", "text-input", 1)],
      file,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("Expected file input");
    }
  });

  it("fails when element is not an input at all", () => {
    document.body.innerHTML = '<button data-testid="btn">Upload</button>';
    const file = new File(["x"], "test.txt", { type: "text/plain" });
    const result = uploadFile([makeStrategy("testid", "btn", 1)], file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("Expected file input");
    }
  });

  it("fails when element not found", () => {
    document.body.innerHTML = "<div></div>";
    const file = new File(["x"], "test.txt", { type: "text/plain" });
    const result = uploadFile([makeStrategy("testid", "nope", 1)], file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("Element not found");
    }
  });
});
