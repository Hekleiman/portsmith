// ─── Platform helpers ───────────────────────────────────────
// Single place for platform labels, per-target instruction selection and
// which delivery modes each target supports.

import type { Workspace } from "@/core/schema/types";

export type PlatformId = "chatgpt" | "claude" | "gemini";
export type DeliveryModeId = "autofill" | "guided" | "hybrid";

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
};

export function isPlatformId(value: unknown): value is PlatformId {
  return value === "chatgpt" || value === "claude" || value === "gemini";
}

/** Human-readable platform name, with a neutral fallback. */
export function platformLabel(id: string | null | undefined): string {
  return isPlatformId(id) ? PLATFORM_LABELS[id] : "the target platform";
}

/** Where users manage the migrated items on each platform. */
export const PLATFORM_HOME_URLS: Record<PlatformId, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/projects",
  gemini: "https://gemini.google.com/gems/view",
};

/** What a migrated workspace is called on each platform. */
export const PLATFORM_ITEM_NOUN: Record<PlatformId, string> = {
  chatgpt: "project",
  claude: "project",
  gemini: "Gem",
};

/**
 * Delivery modes each target supports. ChatGPT has no automated importer
 * yet, so it is guided-only.
 */
export function supportedModesForTarget(
  target: string | null | undefined,
): DeliveryModeId[] {
  if (target === "chatgpt") return ["guided"];
  return ["autofill", "guided", "hybrid"];
}

/**
 * The instructions text to deliver to a target: the user's edited or
 * translated version for that target when present, otherwise the original.
 */
export function getInstructionsForTarget(
  workspace: Workspace,
  target: string | null | undefined,
): string {
  const key = target ?? "claude";
  return workspace.instructions.translated?.[key] ?? workspace.instructions.raw;
}

/** Return a copy of the workspace with target-specific instructions set. */
export function withInstructionsForTarget(
  workspace: Workspace,
  target: string,
  text: string,
): Workspace {
  return {
    ...workspace,
    instructions: {
      ...workspace.instructions,
      translated: {
        ...workspace.instructions.translated,
        [target]: text,
      },
    },
  };
}
