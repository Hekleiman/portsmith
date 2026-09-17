// ─── Gemini Guided Instructions ─────────────────────────────
// Generates step-by-step manual instructions for creating
// Gems in Gemini, parallel to claude-adapter.generateInstructions().

import type { Workspace } from "@/core/schema/types";
import type {
  MigrationGuidedInstructions,
  MigrationStepFallback,
} from "@/shared/messaging";

/**
 * Generate guided (manual) instructions for creating a Gem
 * in Gemini from a workspace.
 */
export function generateGeminiInstructions(
  workspace: Workspace,
): MigrationGuidedInstructions {
  const instructions = workspace.instructions.raw;
  const steps: MigrationStepFallback[] = [];

  // Step 1: Navigate
  steps.push({
    id: `${workspace.id}-navigate`,
    title: "Open Gemini Gems",
    description: "Navigate to the Gems page to create a new Gem.",
    copyBlocks: [],
    link: "https://gemini.google.com/gems/new",
    actionHint: "Click the link above to open the new Gem page",
    stepNumber: 1,
  });

  // Step 2: Name
  steps.push({
    id: `${workspace.id}-name`,
    title: "Enter the Gem name",
    description: `Set the name to "${workspace.name}".`,
    copyBlocks: [{ label: "Gem name", content: workspace.name }],
    stepNumber: 2,
  });

  // Step 3: Description (if present)
  if (workspace.description) {
    steps.push({
      id: `${workspace.id}-description`,
      title: "Enter the description",
      description: "Paste the description into the description field.",
      copyBlocks: [
        { label: "Description", content: workspace.description },
      ],
      stepNumber: 3,
    });
  }

  // Step 4: Instructions
  if (instructions.trim()) {
    steps.push({
      id: `${workspace.id}-instructions`,
      title: "Paste the instructions",
      description:
        "Copy and paste the instructions into the Instructions field.",
      copyBlocks: [
        { label: "Gem instructions", content: instructions },
      ],
      stepNumber: workspace.description ? 4 : 3,
    });
  }

  // Step 5: Save
  steps.push({
    id: `${workspace.id}-save`,
    title: "Save the Gem",
    description: 'Click "Save" to create your new Gem.',
    copyBlocks: [],
    actionHint: "Click Save",
    stepNumber: steps.length + 1,
  });

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    steps,
    totalSteps: steps.length,
  };
}
