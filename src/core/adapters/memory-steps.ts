// ─── Memory import steps per target ─────────────────────────
// Shared by the orchestrator (memory phase) and the results page (to show
// the steps again when the user skipped them).

import type { PortsmithManifest } from "@/core/schema/types";
import type { MigrationStepFallback } from "@/shared/messaging";
import { platformLabel, type PlatformId } from "@/core/platforms";
import { generateMemoryInstructions } from "./claude-adapter";
import { generateGeminiMemoryInstructions } from "./gemini-guided";
import { generateChatGPTMemoryInstructions } from "./chatgpt-guided";

export function buildMemoryStepsForTarget(
  manifest: PortsmithManifest | null | undefined,
  target: PlatformId,
): MigrationStepFallback[] {
  if (!manifest) return [];
  const items = manifest.memory;
  const custom = manifest.globalInstructions;
  const source = platformLabel(manifest.source.platform);
  switch (target) {
    case "gemini":
      return generateGeminiMemoryInstructions(
        items,
        source,
        custom,
        manifest.source.platform,
      );
    case "chatgpt":
      return generateChatGPTMemoryInstructions(items, source, custom);
    default:
      return generateMemoryInstructions(items, source, custom);
  }
}
