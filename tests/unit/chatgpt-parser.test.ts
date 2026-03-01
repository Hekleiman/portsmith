import { describe, it, expect } from "vitest";
import {
  parseChatGPTConversationsJSON,
  ChatGPTParseError,
  flattenTree,
  extractTextFromParts,
} from "@/core/adapters/chatgpt-adapter";
import type {
  ChatGPTRawConversation,
  ChatGPTRawNode,
} from "@/core/adapters/types";
import sampleData from "../fixtures/chatgpt-export-sample.json";

// ─── extractTextFromParts ───────────────────────────────────

describe("extractTextFromParts", () => {
  it("joins string parts", () => {
    expect(extractTextFromParts(["Hello", "World"])).toBe("Hello\nWorld");
  });

  it("filters out non-string parts", () => {
    expect(
      extractTextFromParts([
        "text before",
        { asset_pointer: "file-123", content_type: "image/png" },
        "text after",
      ]),
    ).toBe("text before\ntext after");
  });

  it("returns empty string for undefined parts", () => {
    expect(extractTextFromParts(undefined)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractTextFromParts([])).toBe("");
  });
});

// ─── flattenTree ────────────────────────────────────────────

describe("flattenTree", () => {
  it("flattens a simple linear chain", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: 100,
          content: { content_type: "text", parts: ["Hello"] },
        },
        parent: "root",
        children: ["a1"],
      },
      a1: {
        id: "a1",
        message: {
          id: "a1",
          author: { role: "assistant" },
          create_time: 200,
          content: { content_type: "text", parts: ["Hi there"] },
        },
        parent: "u1",
        children: [],
      },
    };

    const messages = flattenTree(mapping, "a1");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "Hello", timestamp: 100 });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi there", timestamp: 200 });
  });

  it("picks the longest branch when no currentNode path", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: 100,
          content: { content_type: "text", parts: ["Question"] },
        },
        parent: "root",
        children: ["short", "long"],
      },
      short: {
        id: "short",
        message: {
          id: "short",
          author: { role: "assistant" },
          create_time: 200,
          content: { content_type: "text", parts: ["Short answer"] },
        },
        parent: "u1",
        children: [],
      },
      long: {
        id: "long",
        message: {
          id: "long",
          author: { role: "assistant" },
          create_time: 250,
          content: { content_type: "text", parts: ["Long answer"] },
        },
        parent: "u1",
        children: ["follow"],
      },
      follow: {
        id: "follow",
        message: {
          id: "follow",
          author: { role: "user" },
          create_time: 300,
          content: { content_type: "text", parts: ["Follow up"] },
        },
        parent: "long",
        children: [],
      },
    };

    // No currentNode — should pick longest branch (long → follow = depth 3 vs short = depth 1)
    const messages = flattenTree(mapping, undefined);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.content).toBe("Question");
    expect(messages[1]!.content).toBe("Long answer");
    expect(messages[2]!.content).toBe("Follow up");
  });

  it("follows currentNode path at branch points", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: 100,
          content: { content_type: "text", parts: ["Q"] },
        },
        parent: "root",
        children: ["branch-a", "branch-b"],
      },
      "branch-a": {
        id: "branch-a",
        message: {
          id: "branch-a",
          author: { role: "assistant" },
          create_time: 200,
          content: { content_type: "text", parts: ["Answer A"] },
        },
        parent: "u1",
        children: ["a-child1", "a-child2"],
      },
      "a-child1": {
        id: "a-child1",
        message: {
          id: "a-child1",
          author: { role: "user" },
          create_time: 300,
          content: { content_type: "text", parts: ["Deeper A1"] },
        },
        parent: "branch-a",
        children: [],
      },
      "a-child2": {
        id: "a-child2",
        message: {
          id: "a-child2",
          author: { role: "user" },
          create_time: 300,
          content: { content_type: "text", parts: ["Deeper A2"] },
        },
        parent: "branch-a",
        children: [],
      },
      "branch-b": {
        id: "branch-b",
        message: {
          id: "branch-b",
          author: { role: "assistant" },
          create_time: 250,
          content: { content_type: "text", parts: ["Answer B"] },
        },
        parent: "u1",
        children: [],
      },
    };

    // currentNode = branch-b (the shorter branch) — should follow it
    const messages = flattenTree(mapping, "branch-b");
    expect(messages).toHaveLength(2);
    expect(messages[1]!.content).toBe("Answer B");
  });

  it("handles empty mapping", () => {
    const messages = flattenTree({}, undefined);
    expect(messages).toHaveLength(0);
  });

  it("handles root-only mapping", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: [] },
    };
    const messages = flattenTree(mapping, "root");
    expect(messages).toHaveLength(0);
  });

  it("skips nodes with missing/empty content", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: 100,
          content: { content_type: "text", parts: [] },
        },
        parent: "root",
        children: ["a1"],
      },
      a1: {
        id: "a1",
        message: {
          id: "a1",
          author: { role: "assistant" },
          create_time: 200,
          content: { content_type: "text", parts: ["Reply"] },
        },
        parent: "u1",
        children: [],
      },
    };

    const messages = flattenTree(mapping, "a1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("Reply");
  });

  it("handles null create_time", () => {
    const mapping: Record<string, ChatGPTRawNode> = {
      root: { id: "root", message: null, parent: null, children: ["u1"] },
      u1: {
        id: "u1",
        message: {
          id: "u1",
          author: { role: "user" },
          create_time: null,
          content: { content_type: "text", parts: ["No timestamp"] },
        },
        parent: "root",
        children: [],
      },
    };

    const messages = flattenTree(mapping, "u1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.timestamp).toBe(0);
  });
});

// ─── parseChatGPTConversationsJSON (full pipeline) ──────────

describe("parseChatGPTConversationsJSON", () => {
  describe("normal parse from fixture", () => {
    it("parses all conversations", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      expect(result.conversations).toHaveLength(7);
      expect(result.warnings).toHaveLength(0);
    });

    it("extracts correct titles", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const titles = result.conversations.map((c) => c.title);
      expect(titles).toContain("TypeScript Generics Help");
      expect(titles).toContain("Code Review Bot Session");
      expect(titles).toContain("Branching Conversation");
    });

    it("groups conversations by gizmo_id", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      expect(result.customGPTIds).toContain("g-code-reviewer-123");
      expect(result.customGPTIds).toContain("g-data-analyst-456");
      expect(result.customGPTIds).toHaveLength(2);
    });

    it("calculates stats correctly", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      expect(result.stats.totalConversations).toBe(7);
      expect(result.stats.dateRange).not.toBeNull();
      expect(result.stats.dateRange!.earliest).toBe(1705300000);
      expect(result.stats.topGPTs[0]!.gizmoId).toBe("g-code-reviewer-123");
      expect(result.stats.topGPTs[0]!.conversationCount).toBe(2);
    });

    it("flattens TypeScript conversation correctly", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const tsConv = result.conversations.find(
        (c) => c.title === "TypeScript Generics Help",
      )!;
      // system + 2 user + 2 assistant = 5 messages
      expect(tsConv.messages).toHaveLength(5);
      expect(tsConv.messages[0]!.role).toBe("system");
      expect(tsConv.messages[1]!.role).toBe("user");
      expect(tsConv.messages[1]!.content).toBe(
        "Can you explain TypeScript generics?",
      );
      expect(tsConv.messages[4]!.role).toBe("assistant");
    });

    it("handles branching conversation — picks longest branch", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const branchConv = result.conversations.find(
        (c) => c.title === "Branching Conversation",
      )!;
      // Should follow: u1 → a1-long → u2 → a2 (longest path, also currentNode path)
      expect(branchConv.messages).toHaveLength(4);
      expect(branchConv.messages[1]!.content).toContain(
        "programming technique",
      );
      expect(branchConv.messages[3]!.content).toContain("factorial");
    });

    it("handles empty conversation", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const emptyConv = result.conversations.find(
        (c) => c.title === "Empty Conversation",
      )!;
      expect(emptyConv.messages).toHaveLength(0);
    });

    it("handles multipart content (filters non-string parts)", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const multiConv = result.conversations.find(
        (c) => c.title === "Multipart Content",
      )!;
      expect(multiConv.messages[0]!.content).toBe(
        "Here is my code:\nWhat do you think?",
      );
    });

    it("includes tool messages", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const toolConv = result.conversations.find(
        (c) => c.title === "Tool Use Conversation",
      )!;
      const toolMsg = toolConv.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain("pandas");
    });

    it("associates gizmoId with conversations", () => {
      const result = parseChatGPTConversationsJSON(
        sampleData as unknown as ChatGPTRawConversation[],
      );
      const codeReview = result.conversations.find(
        (c) => c.title === "Code Review Bot Session",
      )!;
      expect(codeReview.gizmoId).toBe("g-code-reviewer-123");

      const tsConv = result.conversations.find(
        (c) => c.title === "TypeScript Generics Help",
      )!;
      expect(tsConv.gizmoId).toBeUndefined();
    });
  });

  describe("string JSON input", () => {
    it("parses JSON string", () => {
      const json = JSON.stringify([
        {
          title: "Simple",
          create_time: 1000,
          update_time: 2000,
          conversation_id: "c1",
          mapping: {
            root: {
              id: "root",
              message: null,
              parent: null,
              children: ["u1"],
            },
            u1: {
              id: "u1",
              message: {
                id: "u1",
                author: { role: "user" },
                create_time: 1000,
                content: { content_type: "text", parts: ["Hi"] },
              },
              parent: "root",
              children: [],
            },
          },
          current_node: "u1",
        },
      ]);

      const result = parseChatGPTConversationsJSON(json);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]!.messages[0]!.content).toBe("Hi");
    });
  });

  describe("empty export", () => {
    it("handles empty array", () => {
      const result = parseChatGPTConversationsJSON([]);
      expect(result.conversations).toHaveLength(0);
      expect(result.customGPTIds).toHaveLength(0);
      expect(result.stats.totalConversations).toBe(0);
      expect(result.stats.dateRange).toBeNull();
      expect(result.stats.topGPTs).toHaveLength(0);
    });
  });

  describe("malformed data", () => {
    it("throws on invalid JSON string", () => {
      expect(() => parseChatGPTConversationsJSON("not json")).toThrow(
        ChatGPTParseError,
      );
    });

    it("throws when root is not an array", () => {
      expect(() =>
        parseChatGPTConversationsJSON('{"not": "array"}'),
      ).toThrow(ChatGPTParseError);
    });

    it("skips conversations with missing mapping and warns", () => {
      const data = [
        { title: "Bad", create_time: 0, update_time: 0 } as unknown as ChatGPTRawConversation,
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Bad");
      expect(result.warnings[0]).toContain("no mapping");
    });

    it("handles conversation with null mapping", () => {
      const data = [
        {
          title: "Null Map",
          create_time: 0,
          update_time: 0,
          mapping: null,
        } as unknown as ChatGPTRawConversation,
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("handles mixed valid and invalid conversations", () => {
      const data: ChatGPTRawConversation[] = [
        {
          title: "Good",
          create_time: 1000,
          update_time: 2000,
          conversation_id: "good",
          mapping: {
            root: {
              id: "root",
              message: null,
              parent: null,
              children: ["u1"],
            },
            u1: {
              id: "u1",
              message: {
                id: "u1",
                author: { role: "user" },
                create_time: 1000,
                content: { content_type: "text", parts: ["Hi"] },
              },
              parent: "root",
              children: [],
            },
          },
          current_node: "u1",
        },
        { title: "Bad" } as unknown as ChatGPTRawConversation,
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0]!.title).toBe("Good");
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("generates id from create_time when conversation_id missing", () => {
      const data: ChatGPTRawConversation[] = [
        {
          title: "No ID",
          create_time: 12345,
          update_time: 12345,
          mapping: {
            root: { id: "root", message: null, parent: null, children: [] },
          },
          current_node: "root",
        },
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations[0]!.id).toBe("conv-12345");
    });

    it("handles conversation with only system message", () => {
      const data: ChatGPTRawConversation[] = [
        {
          title: "System Only",
          create_time: 1000,
          update_time: 1000,
          conversation_id: "sys-only",
          mapping: {
            root: {
              id: "root",
              message: null,
              parent: null,
              children: ["sys"],
            },
            sys: {
              id: "sys",
              message: {
                id: "sys",
                author: { role: "system" },
                create_time: 1000,
                content: { content_type: "text", parts: ["System prompt"] },
              },
              parent: "root",
              children: [],
            },
          },
          current_node: "sys",
        },
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations[0]!.messages).toHaveLength(1);
      expect(result.conversations[0]!.messages[0]!.role).toBe("system");
    });

    it("uses 0 for missing create_time/update_time", () => {
      const data: ChatGPTRawConversation[] = [
        {
          title: "No Times",
          mapping: {
            root: { id: "root", message: null, parent: null, children: [] },
          },
          current_node: "root",
        } as unknown as ChatGPTRawConversation,
      ];
      const result = parseChatGPTConversationsJSON(data);
      expect(result.conversations[0]!.createTime).toBe(0);
    });
  });
});
