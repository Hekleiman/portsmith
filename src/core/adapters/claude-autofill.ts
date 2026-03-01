import type { Workspace } from "@/core/schema/types";
import type { ImportStep } from "./claude-adapter";
import { generateInstructions } from "./claude-adapter";
import { sendTabMessage, type AutofillStepStatus } from "@/shared/messaging";

// ─── Types ──────────────────────────────────────────────────

export interface AutofillStepResult {
  id: string;
  title: string;
  status: AutofillStepStatus;
  /** Guided-mode fallback step shown when autofill fails */
  fallback?: ImportStep;
}

// ─── Helpers ────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeOnTab(
  tabId: number,
  action: "click" | "fill" | "clear_and_fill",
  target: string,
  value?: string,
): Promise<boolean> {
  try {
    const response = await sendTabMessage(tabId, "AUTOFILL_EXECUTE", {
      action,
      target,
      value,
    });
    return response.success;
  } catch {
    return false;
  }
}

// ─── Step Definitions ───────────────────────────────────────

interface AutofillStepDef {
  id: string;
  title: string;
  action: "click" | "fill" | "clear_and_fill" | "navigate" | "manual";
  target?: string; // SELECTOR_MAP key
  value?: string;
  guidedIndex: number; // index into the guided steps for fallback
}

function buildStepDefs(workspace: Workspace): AutofillStepDef[] {
  const instructions =
    workspace.instructions.translated?.claude ?? workspace.instructions.raw;

  const defs: AutofillStepDef[] = [
    {
      id: `${workspace.id}-navigate`,
      title: "Navigating to Projects page",
      action: "navigate",
      guidedIndex: 0,
    },
    {
      id: `${workspace.id}-create`,
      title: "Clicking Create Project",
      action: "click",
      target: "projects.createButton",
      guidedIndex: 1,
    },
    {
      id: `${workspace.id}-name`,
      title: "Filling project name",
      action: "clear_and_fill",
      target: "form.nameInput",
      value: workspace.name,
      guidedIndex: 2,
    },
    {
      id: `${workspace.id}-description`,
      title: "Filling description",
      action: "clear_and_fill",
      target: "form.descriptionInput",
      value: workspace.description,
      guidedIndex: 3,
    },
    {
      id: `${workspace.id}-instructions`,
      title: "Filling project instructions",
      action: "clear_and_fill",
      target: "form.instructionsTextarea",
      value: instructions,
      guidedIndex: 4,
    },
  ];

  // Knowledge files — always manual (DOM file upload is fragile)
  const compatibleFiles = workspace.knowledgeFiles.filter((f) => f.compatible);
  if (compatibleFiles.length > 0) {
    defs.push({
      id: `${workspace.id}-files`,
      title: "Upload knowledge files (manual step)",
      action: "manual",
      guidedIndex: 5,
    });
  }

  // Save button
  defs.push({
    id: `${workspace.id}-save`,
    title: "Creating project",
    action: "click",
    target: "form.saveButton",
    // Verify step is last in guided, save button not in guided so fallback to verify
    guidedIndex: compatibleFiles.length > 0 ? 6 : 5,
  });

  return defs;
}

// ─── AsyncGenerator ─────────────────────────────────────────

/**
 * Autofill a single workspace as a Claude Project.
 * Yields step results as they execute. On selector failure, the step
 * result includes a `fallback` with the guided-mode instruction.
 */
export async function* autofillWorkspace(
  workspace: Workspace,
  tabId: number,
  options: { hybrid?: boolean } = {},
): AsyncGenerator<AutofillStepResult, void, boolean | undefined> {
  const guidedInstructions = generateInstructions(workspace);
  const guidedSteps = guidedInstructions.steps;
  const stepDefs = buildStepDefs(workspace);

  for (const def of stepDefs) {
    // Yield pending status
    const pending: AutofillStepResult = {
      id: def.id,
      title: def.title,
      status: "running",
    };

    // In hybrid mode, yield as pending and wait for confirmation
    if (options.hybrid) {
      pending.status = "pending";
      const confirmed: boolean | undefined = yield pending;
      if (confirmed === false) {
        yield { id: def.id, title: def.title, status: "skipped" };
        continue;
      }
      // Now running
      yield { id: def.id, title: def.title, status: "running" };
    } else {
      yield pending;
    }

    // Navigate step — update tab URL
    if (def.action === "navigate") {
      try {
        await chrome.tabs.update(tabId, {
          url: "https://claude.ai/projects",
        });
        // Wait for page load
        await delay(2000);
        yield { id: def.id, title: def.title, status: "success" };
      } catch {
        yield {
          id: def.id,
          title: def.title,
          status: "fallback",
          fallback: guidedSteps[def.guidedIndex],
        };
      }
      await delay(500);
      continue;
    }

    // Manual step — always show as guided fallback
    if (def.action === "manual") {
      yield {
        id: def.id,
        title: def.title,
        status: "fallback",
        fallback: guidedSteps[def.guidedIndex],
      };
      continue;
    }

    // DOM action — click or fill
    const success = await executeOnTab(
      tabId,
      def.action,
      def.target!,
      def.value,
    );

    if (success) {
      yield { id: def.id, title: def.title, status: "success" };
    } else {
      yield {
        id: def.id,
        title: def.title,
        status: "fallback",
        fallback: guidedSteps[def.guidedIndex],
      };
    }

    // Inter-step delay for page reactivity
    await delay(500);
  }
}
