import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendMessage,
  sendTabMessage,
  onMessage,
  initMessageRouter,
  _resetHandlers,
  MessageError,
  MessageTimeoutError,
  NoListenerError,
  MESSAGE_TIMEOUT_MS,
} from "@/shared/messaging";
import type { MigrationState } from "@/shared/messaging";

// ─── Chrome API Mock ─────────────────────────────────────────

const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
    },
    lastError: null as { message?: string } | null,
  },
  tabs: {
    sendMessage: vi.fn(),
  },
};

vi.stubGlobal("chrome", mockChrome);

// ─── Helpers ─────────────────────────────────────────────────

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe("messaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChrome.runtime.lastError = null;
    _resetHandlers();
  });

  // ── sendMessage ──────────────────────────────────────────

  describe("sendMessage", () => {
    it("sends envelope with correct structure", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          callback({ __portsmith: true, ok: true, data: { success: true } });
        },
      );

      const result = await sendMessage("EXTRACT_START", {
        platform: "chatgpt",
      });

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        },
        expect.any(Function),
      );
      expect(result).toEqual({ success: true });
    });

    it("handles void request messages (no payload argument)", async () => {
      const mockState: MigrationState = {
        status: "idle",
        sourcePlatform: null,
        targetPlatform: null,
        progress: 0,
        error: null,
      };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          callback({ __portsmith: true, ok: true, data: mockState });
        },
      );

      const result = await sendMessage("GET_MIGRATION_STATE");
      expect(result).toEqual(mockState);
    });

    it("handles void response messages", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          callback({ __portsmith: true, ok: true, data: undefined });
        },
      );

      const result = await sendMessage("EXTRACT_PROGRESS", {
        step: "parsing",
        percent: 50,
      });
      expect(result).toBeUndefined();
    });

    it("throws MessageTimeoutError after timeout", async () => {
      vi.useFakeTimers();

      mockChrome.runtime.sendMessage.mockImplementation(() => {
        // Never calls callback — simulates unresponsive receiver
      });

      const promise = sendMessage("EXTRACT_START", { platform: "chatgpt" });
      vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS);

      await expect(promise).rejects.toThrow(MessageTimeoutError);
      await expect(promise).rejects.toThrow("Timed out");

      vi.useRealTimers();
    });

    it("throws NoListenerError when no receiver exists", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          mockChrome.runtime.lastError = {
            message:
              "Could not establish connection. Receiving end does not exist.",
          };
          callback(undefined);
          mockChrome.runtime.lastError = null;
        },
      );

      await expect(
        sendMessage("EXTRACT_START", { platform: "chatgpt" }),
      ).rejects.toThrow(NoListenerError);
    });

    it("throws MessageError when handler reports error", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          callback({
            __portsmith: true,
            ok: false,
            error: "Handler failed",
          });
        },
      );

      await expect(
        sendMessage("EXTRACT_START", { platform: "chatgpt" }),
      ).rejects.toThrow("Handler failed");
    });

    it("throws MessageError for unknown chrome errors", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          mockChrome.runtime.lastError = {
            message: "Extension context invalidated.",
          };
          callback(undefined);
          mockChrome.runtime.lastError = null;
        },
      );

      await expect(
        sendMessage("EXTRACT_START", { platform: "chatgpt" }),
      ).rejects.toThrow(MessageError);
      await expect(
        sendMessage("EXTRACT_START", { platform: "chatgpt" }),
      ).rejects.not.toThrow(NoListenerError);
    });

    it("resolves undefined for non-envelope responses", async () => {
      mockChrome.runtime.sendMessage.mockImplementation(
        (_envelope: unknown, callback: (r: unknown) => void) => {
          // Simulates a listener that doesn't use our protocol
          callback("raw string response");
        },
      );

      const result = await sendMessage("EXTRACT_PROGRESS", { step: "test", percent: 0 });
      expect(result).toBeUndefined();
    });
  });

  // ── sendTabMessage ───────────────────────────────────────

  describe("sendTabMessage", () => {
    it("sends to specific tab with correct envelope", async () => {
      mockChrome.tabs.sendMessage.mockImplementation(
        (
          _tabId: number,
          _envelope: unknown,
          callback: (r: unknown) => void,
        ) => {
          callback({ __portsmith: true, ok: true, data: { success: true } });
        },
      );

      const result = await sendTabMessage(42, "EXTRACT_START", {
        platform: "chatgpt",
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        }),
        expect.any(Function),
      );
      expect(result).toEqual({ success: true });
    });

    it("throws NoListenerError when content script not injected", async () => {
      mockChrome.tabs.sendMessage.mockImplementation(
        (
          _tabId: number,
          _envelope: unknown,
          callback: (r: unknown) => void,
        ) => {
          mockChrome.runtime.lastError = {
            message:
              "Could not establish connection. Receiving end does not exist.",
          };
          callback(undefined);
          mockChrome.runtime.lastError = null;
        },
      );

      await expect(
        sendTabMessage(42, "EXTRACT_START", { platform: "chatgpt" }),
      ).rejects.toThrow(NoListenerError);
    });

    it("throws MessageTimeoutError after timeout", async () => {
      vi.useFakeTimers();

      mockChrome.tabs.sendMessage.mockImplementation(() => {
        // Never calls callback
      });

      const promise = sendTabMessage(42, "PAGE_STATE", {
        url: "https://chatgpt.com",
        platform: "chatgpt",
      });
      vi.advanceTimersByTime(MESSAGE_TIMEOUT_MS);

      await expect(promise).rejects.toThrow(MessageTimeoutError);

      vi.useRealTimers();
    });
  });

  // ── onMessage + initMessageRouter ────────────────────────

  describe("onMessage + initMessageRouter", () => {
    function getListener(): (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => boolean | undefined {
      initMessageRouter();
      const listener =
        mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      if (!listener) throw new Error("addListener was not called");
      return listener as (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined;
    }

    it("dispatches messages to registered handlers", async () => {
      const listener = getListener();
      const handler = vi.fn().mockResolvedValue({ success: true });
      onMessage("EXTRACT_START", handler);

      const sendResponse = vi.fn();
      const result = listener(
        {
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        },
        { id: "test-extension" },
        sendResponse,
      );

      // Must return true for async response
      expect(result).toBe(true);

      // Wait for async handler chain to complete
      await flushMicrotasks();
      await flushMicrotasks();

      expect(handler).toHaveBeenCalledWith(
        { platform: "chatgpt" },
        { id: "test-extension" },
      );
      expect(sendResponse).toHaveBeenCalledWith({
        __portsmith: true,
        ok: true,
        data: { success: true },
      });
    });

    it("handles sync handlers", async () => {
      const listener = getListener();
      onMessage("EXTRACT_START", () => ({ success: true }));

      const sendResponse = vi.fn();
      listener(
        {
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        },
        {},
        sendResponse,
      );

      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendResponse).toHaveBeenCalledWith({
        __portsmith: true,
        ok: true,
        data: { success: true },
      });
    });

    it("returns false for non-portsmith messages", () => {
      const listener = getListener();

      const result = listener(
        { type: "SOME_OTHER_MESSAGE" },
        {},
        vi.fn(),
      );
      expect(result).toBe(false);
    });

    it("returns false for messages without registered handlers", () => {
      const listener = getListener();

      const result = listener(
        { __portsmith: true, type: "EXTRACT_START", payload: {} },
        {},
        vi.fn(),
      );
      expect(result).toBe(false);
    });

    it("wraps handler errors in error response", async () => {
      const listener = getListener();
      onMessage("EXTRACT_START", () => {
        throw new Error("Something broke");
      });

      const sendResponse = vi.fn();
      listener(
        {
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        },
        {},
        sendResponse,
      );

      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendResponse).toHaveBeenCalledWith({
        __portsmith: true,
        ok: false,
        error: "Something broke",
      });
    });

    it("wraps async handler rejections in error response", async () => {
      const listener = getListener();
      onMessage("EXTRACT_START", async () => {
        throw new Error("Async failure");
      });

      const sendResponse = vi.fn();
      listener(
        {
          __portsmith: true,
          type: "EXTRACT_START",
          payload: { platform: "chatgpt" },
        },
        {},
        sendResponse,
      );

      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(sendResponse).toHaveBeenCalledWith({
        __portsmith: true,
        ok: false,
        error: "Async failure",
      });
    });

    it("cleanup function removes handler", () => {
      const listener = getListener();

      const cleanup = onMessage("EXTRACT_START", vi.fn());
      cleanup();

      const result = listener(
        { __portsmith: true, type: "EXTRACT_START", payload: {} },
        {},
        vi.fn(),
      );
      expect(result).toBe(false);
    });
  });

  // ── New Message Types ──────────────────────────────────

  describe("new message types", () => {
    it("sends WAIT_FOR_NAVIGATION with correct payload", async () => {
      mockChrome.tabs.sendMessage.mockImplementation(
        (
          _tabId: number,
          _envelope: unknown,
          callback: (r: unknown) => void,
        ) => {
          callback({
            __portsmith: true,
            ok: true,
            data: { success: true, currentUrl: "https://claude.ai/project/abc-123" },
          });
        },
      );

      const result = await sendTabMessage(42, "WAIT_FOR_NAVIGATION", {
        urlPattern: "^https://claude\\.ai/project/[a-f0-9-]+",
        timeoutMs: 15000,
      });

      expect(result.success).toBe(true);
      expect(result.currentUrl).toBe("https://claude.ai/project/abc-123");
    });

    it("sends CLIPBOARD_WRITE with correct payload", async () => {
      mockChrome.tabs.sendMessage.mockImplementation(
        (
          _tabId: number,
          _envelope: unknown,
          callback: (r: unknown) => void,
        ) => {
          callback({
            __portsmith: true,
            ok: true,
            data: { success: true },
          });
        },
      );

      const result = await sendTabMessage(42, "CLIPBOARD_WRITE", {
        text: "Test instructions content",
      });

      expect(result.success).toBe(true);
    });

    it("sends GET_PAGE_URL and receives URL", async () => {
      mockChrome.tabs.sendMessage.mockImplementation(
        (
          _tabId: number,
          _envelope: unknown,
          callback: (r: unknown) => void,
        ) => {
          callback({
            __portsmith: true,
            ok: true,
            data: { url: "https://claude.ai/projects" },
          });
        },
      );

      const result = await sendTabMessage(42, "GET_PAGE_URL");

      expect(result.url).toBe("https://claude.ai/projects");
    });
  });

  // ── Error Classes ────────────────────────────────────────

  describe("error classes", () => {
    it("MessageError stores messageName and formats message", () => {
      const err = new MessageError("EXTRACT_START", "test error");
      expect(err.messageName).toBe("EXTRACT_START");
      expect(err.message).toBe("[EXTRACT_START] test error");
      expect(err.name).toBe("MessageError");
      expect(err).toBeInstanceOf(Error);
    });

    it("MessageTimeoutError extends MessageError", () => {
      const err = new MessageTimeoutError("EXTRACT_START");
      expect(err).toBeInstanceOf(MessageError);
      expect(err).toBeInstanceOf(Error);
      expect(err.messageName).toBe("EXTRACT_START");
      expect(err.name).toBe("MessageTimeoutError");
      expect(err.message).toContain("Timed out");
      expect(err.message).toContain(String(MESSAGE_TIMEOUT_MS));
    });

    it("NoListenerError extends MessageError", () => {
      const err = new NoListenerError("EXTRACT_START");
      expect(err).toBeInstanceOf(MessageError);
      expect(err).toBeInstanceOf(Error);
      expect(err.messageName).toBe("EXTRACT_START");
      expect(err.name).toBe("NoListenerError");
      expect(err.message).toContain("No listener available");
    });
  });
});
