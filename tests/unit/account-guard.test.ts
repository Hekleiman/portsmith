import { describe, it, expect } from "vitest";
import { checkTargetAccount, maskEmail } from "@/core/transform/account-guard";
import { PlatformIdentifierSchema } from "@/core/schema/types";
import { isAllowedPair } from "@/core/platforms";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("erik@gmail.com")).toBe("e***@gmail.com");
  });

  it("handles a Hide My Email (privaterelay) address", () => {
    expect(maskEmail("hx7k2p9q4z@privaterelay.appleid.com")).toBe(
      "h***@privaterelay.appleid.com",
    );
  });

  it("handles a one-character local part", () => {
    expect(maskEmail("x@example.org")).toBe("x***@example.org");
  });

  it("never returns the full local part", () => {
    expect(maskEmail("  someone.long@company.io ")).toBe("s***@company.io");
    expect(maskEmail("no-at-sign")).toBe("n***");
  });
});

describe("checkTargetAccount", () => {
  it("is ok for a different account", () => {
    expect(checkTargetAccount({ accountId: A }, { uuid: B })).toBe("ok");
  });

  it("flags the same account, whatever the case", () => {
    expect(checkTargetAccount({ accountId: A }, { uuid: A.toUpperCase() })).toBe("same-account");
  });

  it("fails closed when the signed-in account is unknown", () => {
    expect(checkTargetAccount({ accountId: A }, null)).toBe("unknown-current");
    expect(checkTargetAccount({ accountId: A }, { uuid: "" })).toBe("unknown-current");
  });

  it("fails closed when the source account wasn't recorded", () => {
    expect(checkTargetAccount({}, { uuid: B })).toBe("unknown-source");
    expect(checkTargetAccount({ accountId: " " }, { uuid: B })).toBe("unknown-source");
  });
});

describe("source account fields", () => {
  const base = { platform: "claude", exportMethod: "api", exportedAt: "2026-11-09T00:00:00.000Z" };

  it("older manifests without them still validate", () => {
    expect(PlatformIdentifierSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an account ID and masked label", () => {
    const parsed = PlatformIdentifierSchema.parse({
      ...base,
      accountId: A,
      accountLabel: "e***@gmail.com",
    });
    expect(parsed.accountId).toBe(A);
    expect(parsed.accountLabel).toBe("e***@gmail.com");
  });

  it("rejects a non-string account ID", () => {
    expect(PlatformIdentifierSchema.safeParse({ ...base, accountId: 42 }).success).toBe(false);
  });
});

describe("isAllowedPair", () => {
  it("allows Claude to Claude only among same-platform pairs", () => {
    expect(isAllowedPair("claude", "claude")).toBe(true);
    expect(isAllowedPair("chatgpt", "chatgpt")).toBe(false);
    expect(isAllowedPair("gemini", "gemini")).toBe(false);
    expect(isAllowedPair("claude", "gemini")).toBe(true);
  });
});
