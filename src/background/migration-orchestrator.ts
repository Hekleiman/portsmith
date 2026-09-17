import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  OrchestratorStatus,
  MigrationStep,
  MigrationStepFallback,
  MigrationGuidedInstructions,
  InstructionsDelivery,
} from "@/shared/messaging";
import { onMessage, safeSendTabMessage } from "@/shared/messaging";
import { autofillWorkspace } from "@/core/adapters/claude-autofill";
import {
  generateInstructions,
  generateMemoryInstructions,
} from "@/core/adapters/claude-adapter";
import { generateGeminiInstructions } from "@/core/adapters/gemini-guided";
import {
  loadManifest,
  saveCheckpoint,
  loadLatestCheckpoint,
  type MigrationStateSnapshot,
  type DeliveryMode,
} from "@/core/storage/indexed-db";

// ─── Orchestrator ───────────────────────────────────────────

class MigrationOrchestrator {
  private phase: OrchestratorStatus["phase"] = "idle";
  private mode: DeliveryMode | null = null;
  private targetPlatform: string = "claude";
  private manifestId: string | null = null;
  private manifest: PortsmithManifest | null = null;
  private workspaceIds: string[] = [];
  private currentWorkspaceIndex = 0;
  private completedWorkspaceIds: string[] = [];
  private failedWorkspaces: Array<{
    id: string;
    name: string;
    error: string;
  }> = [];
  private currentSteps: MigrationStep[] = [];
  private pendingConfirmStepId: string | null = null;
  private guidedInstructions: MigrationGuidedInstructions | null = null;
  private memorySteps: MigrationStepFallback[] = [];
  private instructionsDelivery: Record<string, InstructionsDelivery> = {};
  private verifiedWorkspaceIds: string[] = [];
  private migrationTabId: number | null = null;
  private duplicateTabWarning: string | null = null;

  // Resolvers for async coordination
  private confirmResolver: ((confirmed: boolean) => void) | null = null;
  private guidedResolver: (() => void) | null = null;
  private pauseResolver: (() => void) | null = null;
  private cancelRequested = false;
  private pauseRequested = false;

  // ─── Public API ────────────────────────────────────────────

  async start(
    manifestId: string,
    mode: DeliveryMode,
    workspaceIds: string[],
    targetPlatform?: string,
  ): Promise<boolean> {
    if (this.phase === "running") return false;

    const record = await loadManifest(manifestId);
    if (!record) return false;

    this.resetState();
    this.manifest = record.data;
    this.manifestId = manifestId;
    this.mode = mode;
    this.targetPlatform = targetPlatform ?? "claude";
    this.workspaceIds = workspaceIds;
    this.phase = "running";
    this.memorySteps =
      this.targetPlatform === "claude"
        ? generateMemoryInstructions(this.manifest.memory)
        : [];
    this.duplicateTabWarning = await this.checkDuplicateTabs();

    void this.processWorkspaces();
    return true;
  }

  pause(): boolean {
    if (this.phase !== "running") return false;
    this.pauseRequested = true;
    return true;
  }

  async resume(): Promise<boolean> {
    // Resume from paused state
    if (this.phase === "paused") {
      this.phase = "running";
      this.pauseRequested = false;
      this.pauseResolver?.();
      return true;
    }

    // Resume from checkpoint (after service worker restart)
    const ckpt = await loadLatestCheckpoint();
    if (!ckpt) return false;

    const snap = ckpt.migrationState;
    if (!snap.manifestId || !snap.deliveryMode) return false;
    if (snap.phase !== "migrating") return false;

    const record = await loadManifest(snap.manifestId);
    if (!record) return false;

    this.resetState();
    this.manifest = record.data;
    this.manifestId = snap.manifestId;
    this.mode = snap.deliveryMode;
    this.targetPlatform = snap.targetPlatform ?? "claude";
    this.workspaceIds = snap.selectedWorkspaceIds;
    this.completedWorkspaceIds = [...snap.completedWorkspaceIds];
    this.currentWorkspaceIndex = ckpt.workspaceIndex;
    this.instructionsDelivery = snap.instructionsDelivery
      ? { ...snap.instructionsDelivery }
      : {};
    this.phase = "running";
    this.memorySteps =
      this.targetPlatform === "claude"
        ? generateMemoryInstructions(this.manifest.memory)
        : [];

    void this.processWorkspaces();
    return true;
  }

  cancel(): boolean {
    this.cancelRequested = true;
    this.confirmResolver?.(false);
    this.pauseResolver?.();
    this.guidedResolver?.();
    this.phase = "idle";
    this.resetState();
    return true;
  }

  getStatus(): OrchestratorStatus {
    const ws = this.getCurrentWorkspace();
    const instr = ws
      ? (ws.instructions.translated?.claude ?? ws.instructions.raw)
      : null;

    // Build clipboard instructions map for workspaces that fell back
    const clipboardInstructions: Record<string, string> = {};
    if (this.manifest) {
      for (const [wsId, delivery] of Object.entries(
        this.instructionsDelivery,
      )) {
        if (delivery === "clipboard") {
          const workspace = this.manifest.workspaces.find(
            (w) => w.id === wsId,
          );
          if (workspace) {
            const text =
              workspace.instructions.translated?.claude ??
              workspace.instructions.raw;
            if (text.length > 0) {
              clipboardInstructions[wsId] = text;
            }
          }
        }
      }
    }

    return {
      phase: this.phase,
      mode: this.mode,
      totalWorkspaces: this.workspaceIds.length,
      currentWorkspaceIndex: this.currentWorkspaceIndex,
      currentWorkspaceName: ws?.name ?? null,
      completedWorkspaceIds: [...this.completedWorkspaceIds],
      failedWorkspaces: [...this.failedWorkspaces],
      currentSteps: [...this.currentSteps],
      pendingConfirmStepId: this.pendingConfirmStepId,
      guidedInstructions: this.guidedInstructions,
      memorySteps: this.memorySteps,
      hasMemory: this.memorySteps.length > 0,
      instructionsDelivery: { ...this.instructionsDelivery },
      currentWorkspaceInstructions:
        instr && instr.length > 0 ? instr : null,
      clipboardInstructions,
      verifiedWorkspaceIds: [...this.verifiedWorkspaceIds],
      duplicateTabWarning: this.duplicateTabWarning ?? undefined,
    };
  }

  confirmStep(confirmed: boolean): boolean {
    if (!this.confirmResolver) return false;
    this.confirmResolver(confirmed);
    this.confirmResolver = null;
    this.pendingConfirmStepId = null;
    return true;
  }

  markWorkspaceDone(workspaceId: string): boolean {
    if (this.mode !== "guided") return false;
    const ws = this.getCurrentWorkspace();
    if (!ws || ws.id !== workspaceId) return false;
    if (!this.guidedResolver) return false;
    this.guidedResolver();
    return true;
  }

  markMemoryDone(): boolean {
    if (this.phase !== "memory") return false;
    this.phase = "complete";
    return true;
  }

  updateDelivery(
    workspaceId: string,
    delivery: InstructionsDelivery,
  ): boolean {
    if (!(workspaceId in this.instructionsDelivery)) return false;
    this.instructionsDelivery[workspaceId] = delivery;
    return true;
  }

  // ─── Private ───────────────────────────────────────────────

  private getCurrentWorkspace(): Workspace | null {
    if (!this.manifest) return null;
    const wsId = this.workspaceIds[this.currentWorkspaceIndex];
    if (!wsId) return null;
    return this.manifest.workspaces.find((w) => w.id === wsId) ?? null;
  }

  private async findClaudeTab(): Promise<number | null> {
    try {
      const active = await chrome.tabs.query({
        url: "https://claude.ai/*",
        active: true,
        currentWindow: true,
      });
      if (active.length > 0 && active[0]?.id != null) return active[0].id;

      const all = await chrome.tabs.query({ url: "https://claude.ai/*" });
      if (all.length > 0 && all[0]?.id != null) return all[0].id;
    } catch {
      // Not in extension context
    }
    return null;
  }

  /**
   * Find a tab for autofill: prefer an existing Claude tab, but fall back to
   * the active tab. The autofill navigate step will redirect it to claude.ai.
   */
  private async getTabForAutofill(): Promise<number | null> {
    const claudeTab = await this.findClaudeTab();
    if (claudeTab !== null) return claudeTab;

    // No Claude tab — use the active tab (navigate step will redirect it)
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab?.id != null) return activeTab.id;
    } catch {
      // Not in extension context
    }
    return null;
  }

  private async validateAndPinTab(): Promise<number | null> {
    // If we already have a pinned tab, validate it still exists and is usable
    if (this.migrationTabId !== null) {
      try {
        const tab = await chrome.tabs.get(this.migrationTabId);
        if (tab && !tab.discarded) {
          // Tab still exists — ping content script
          try {
            await safeSendTabMessage(this.migrationTabId, "PING");
            return this.migrationTabId;
          } catch {
            // Content script not responding — tab may have navigated away
            // Fall through to re-pin
          }
        }
      } catch {
        // Tab was closed — fall through to re-pin
      }
      this.migrationTabId = null;
    }

    // Pin a new tab via existing logic
    const tabId = await this.getTabForAutofill();
    if (tabId !== null) {
      this.migrationTabId = tabId;
    }
    return tabId;
  }

  private async checkDuplicateTabs(): Promise<string | null> {
    const urlPattern =
      this.targetPlatform === "gemini"
        ? "https://gemini.google.com/*"
        : "https://claude.ai/*";
    const platformName =
      this.targetPlatform === "gemini" ? "Gemini" : "Claude";

    try {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      if (tabs.length > 1) {
        return `${tabs.length} ${platformName} tabs detected. Close extra tabs to avoid conflicts.`;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  onTabClosed(tabId: number): void {
    if (this.migrationTabId === tabId) {
      this.migrationTabId = null;
    }
  }

  private async processWorkspaces(): Promise<void> {
    while (this.currentWorkspaceIndex < this.workspaceIds.length) {
      if (this.cancelRequested) return;

      // Pause check (between workspaces)
      if (this.pauseRequested) {
        this.phase = "paused";
        await new Promise<void>((resolve) => {
          this.pauseResolver = resolve;
        });
        this.pauseResolver = null;
        if (this.cancelRequested) return;
      }

      const workspace = this.getCurrentWorkspace();
      if (!workspace) {
        this.currentWorkspaceIndex++;
        continue;
      }

      if (this.targetPlatform === "gemini") {
        if (this.mode === "guided") {
          await this.processGeminiGuidedWorkspace(workspace);
        } else {
          await this.processGeminiAutofillWorkspace(workspace);
        }
      } else {
        if (this.mode === "guided") {
          await this.processGuidedWorkspace(workspace);
        } else {
          await this.processAutofillWorkspace(workspace);
        }
      }

      if (this.cancelRequested) return;

      this.currentWorkspaceIndex++;
      this.currentSteps = [];
      this.guidedInstructions = null;
      await this.checkpointState();
    }

    // All workspaces processed
    if (this.cancelRequested) return;

    if (this.memorySteps.length > 0) {
      this.phase = "memory";
    } else {
      this.phase = "complete";
    }
  }

  private async processGuidedWorkspace(workspace: Workspace): Promise<void> {
    const instructions = generateInstructions(workspace);
    this.guidedInstructions = instructions;

    // Wait for markWorkspaceDone to be called
    await new Promise<void>((resolve) => {
      this.guidedResolver = resolve;
    });
    this.guidedResolver = null;

    this.completedWorkspaceIds.push(workspace.id);
  }

  private async processAutofillWorkspace(workspace: Workspace): Promise<void> {
    const tabId = await this.validateAndPinTab();
    if (tabId === null) {
      const error = "No browser tab available for migration.";
      console.warn(
        `[PortSmith] Workspace "${workspace.name}" failed: ${error}`,
      );
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error,
      });
      return;
    }

    this.currentSteps = [];
    const isHybrid = this.mode === "hybrid";

    // Initialize instructions delivery tracking
    const instructions =
      workspace.instructions.translated?.claude ?? workspace.instructions.raw;
    this.instructionsDelivery[workspace.id] =
      instructions.length > 0 ? "pending" : "none";

    try {
      const gen = autofillWorkspace(workspace, tabId, { hybrid: isHybrid });
      let nextInput: boolean | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.cancelRequested) return;

        const { value, done } = await gen.next(nextInput);
        if (done || !value) break;
        nextInput = undefined;

        const step: MigrationStep = value;

        // Track instructions delivery from step results
        if (step.instructionsDelivery) {
          this.instructionsDelivery[workspace.id] = step.instructionsDelivery;
        }

        // Track API verification results
        if (step.verified === true) {
          this.verifiedWorkspaceIds.push(workspace.id);
        }

        // Pause at pending status for user confirmation (hybrid steps + manual steps)
        if (step.status === "pending") {
          this.pendingConfirmStepId = step.id;
          this.updateStep(step);

          const confirmed = await new Promise<boolean>((resolve) => {
            this.confirmResolver = resolve;
          });
          this.confirmResolver = null;
          this.pendingConfirmStepId = null;

          if (this.cancelRequested) return;
          nextInput = confirmed;
          continue;
        }

        // Navigate failed: pause and wait for user to navigate manually
        if (step.status === "navigate_failed") {
          this.pendingConfirmStepId = step.id;
          this.updateStep(step);

          const confirmed = await new Promise<boolean>((resolve) => {
            this.confirmResolver = resolve;
          });
          this.confirmResolver = null;
          this.pendingConfirmStepId = null;

          if (this.cancelRequested) return;
          nextInput = confirmed;
          continue;
        }

        this.updateStep(step);
      }

      // Check if the generator ended with a blocking failure
      const lastStep = this.currentSteps[this.currentSteps.length - 1];
      if (
        lastStep?.status === "failed" ||
        lastStep?.status === "navigate_failed"
      ) {
        this.failedWorkspaces.push({
          id: workspace.id,
          name: workspace.name,
          error: lastStep.title,
        });
      } else {
        this.completedWorkspaceIds.push(workspace.id);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PortSmith] Workspace "${workspace.name}" failed: ${errorMsg}`,
      );
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: errorMsg,
      });
    }
  }

  // ─── Gemini Target ──────────────────────────────────────

  private async processGeminiGuidedWorkspace(
    workspace: Workspace,
  ): Promise<void> {
    const instructions = generateGeminiInstructions(workspace);
    this.guidedInstructions = instructions;

    await new Promise<void>((resolve) => {
      this.guidedResolver = resolve;
    });
    this.guidedResolver = null;

    this.completedWorkspaceIds.push(workspace.id);
  }

  private async processGeminiAutofillWorkspace(
    workspace: Workspace,
  ): Promise<void> {
    this.currentSteps = [];
    this.instructionsDelivery[workspace.id] = "pending";

    const stepId = `${workspace.id}-create`;
    this.updateStep({
      id: stepId,
      title: `Creating Gem "${workspace.name}"`,
      status: "running",
    });

    const tabId = await this.findGeminiTab();
    if (tabId === null) {
      this.updateStep({
        id: stepId,
        title: `Creating Gem "${workspace.name}"`,
        status: "failed",
        fallback: {
          id: stepId,
          title: "Open Gemini",
          description:
            "No Gemini tab found. Open gemini.google.com and sign in.",
          copyBlocks: [],
          link: "https://gemini.google.com",
        },
      });
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: "No Gemini tab found",
      });
      return;
    }

    try {
      const instructions = workspace.instructions.raw;
      const result = await safeSendTabMessage(tabId, "GEMINI_CREATE_GEM", {
        name: workspace.name,
        description: workspace.description,
        instructions,
      });

      if (result.success) {
        this.updateStep({
          id: stepId,
          title: `Created Gem "${workspace.name}"`,
          status: "success",
        });
        this.instructionsDelivery[workspace.id] = "autofilled";
        this.completedWorkspaceIds.push(workspace.id);
      } else {
        // API failed — show guided fallback
        const fallbackSteps = result.fallback?.steps ?? [];
        this.updateStep({
          id: stepId,
          title: `Gem "${workspace.name}" — manual steps needed`,
          status: "fallback",
          fallback: {
            id: stepId,
            title: "Create Gem manually",
            description: fallbackSteps.join("\n"),
            copyBlocks: [
              { label: "Gem name", content: workspace.name },
              ...(workspace.description
                ? [
                    {
                      label: "Description",
                      content: workspace.description,
                    },
                  ]
                : []),
              ...(instructions
                ? [{ label: "Instructions", content: instructions }]
                : []),
            ],
            link: "https://gemini.google.com/gems/new",
          },
        });
        this.instructionsDelivery[workspace.id] = "manual";
        // Still count as completed — user has the fallback info
        this.completedWorkspaceIds.push(workspace.id);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateStep({
        id: stepId,
        title: `Failed to create "${workspace.name}"`,
        status: "failed",
      });
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: errorMsg,
      });
    }
  }

  private async findGeminiTab(): Promise<number | null> {
    try {
      const active = await chrome.tabs.query({
        url: "https://gemini.google.com/*",
        active: true,
        currentWindow: true,
      });
      if (active.length > 0 && active[0]?.id != null) return active[0].id;

      const all = await chrome.tabs.query({
        url: "https://gemini.google.com/*",
      });
      if (all.length > 0 && all[0]?.id != null) return all[0].id;
    } catch {
      // Not in extension context
    }
    return null;
  }

  private updateStep(step: MigrationStep): void {
    const idx = this.currentSteps.findIndex((s) => s.id === step.id);
    if (idx >= 0) {
      this.currentSteps[idx] = step;
    } else {
      this.currentSteps.push(step);
    }
  }

  private async checkpointState(): Promise<void> {
    if (!this.manifestId || !this.mode) return;

    const sourcePlatform =
      this.manifest?.source.platform ?? "chatgpt";
    const snapshot: MigrationStateSnapshot = {
      phase: "migrating",
      sourcePlatform,
      targetPlatform: this.targetPlatform,
      extractionMethod: null,
      deliveryMode: this.mode,
      manifestId: this.manifestId,
      selectedWorkspaceIds: this.workspaceIds,
      completedWorkspaceIds: this.completedWorkspaceIds,
      errors: this.failedWorkspaces.map((f) => `${f.name}: ${f.error}`),
      instructionsDelivery: { ...this.instructionsDelivery },
    };

    await saveCheckpoint(snapshot, this.currentWorkspaceIndex, 0);
  }

  private resetState(): void {
    this.manifestId = null;
    this.manifest = null;
    this.mode = null;
    this.targetPlatform = "claude";
    this.workspaceIds = [];
    this.currentWorkspaceIndex = 0;
    this.completedWorkspaceIds = [];
    this.failedWorkspaces = [];
    this.currentSteps = [];
    this.pendingConfirmStepId = null;
    this.confirmResolver = null;
    this.guidedInstructions = null;
    this.guidedResolver = null;
    this.memorySteps = [];
    this.instructionsDelivery = {};
    this.verifiedWorkspaceIds = [];
    this.cancelRequested = false;
    this.pauseRequested = false;
    this.pauseResolver = null;
    this.migrationTabId = null;
    this.duplicateTabWarning = null;
  }
}

// ─── Singleton & Message Handlers ────────────────────────────

const orchestrator = new MigrationOrchestrator();

export function registerOrchestratorHandlers(): void {
  onMessage("MIGRATION_START", async (payload) => {
    const success = await orchestrator.start(
      payload.manifestId,
      payload.mode,
      payload.workspaceIds,
      payload.targetPlatform,
    );
    return { success };
  });

  onMessage("MIGRATION_STATUS", () => {
    return orchestrator.getStatus();
  });

  onMessage("MIGRATION_PAUSE", () => {
    return { success: orchestrator.pause() };
  });

  onMessage("MIGRATION_RESUME", async () => {
    const success = await orchestrator.resume();
    return { success };
  });

  onMessage("MIGRATION_CANCEL", () => {
    return { success: orchestrator.cancel() };
  });

  onMessage("MIGRATION_CONFIRM", (payload) => {
    return { success: orchestrator.confirmStep(payload.confirmed) };
  });

  onMessage("MIGRATION_WORKSPACE_DONE", (payload) => {
    return { success: orchestrator.markWorkspaceDone(payload.workspaceId) };
  });

  onMessage("MIGRATION_MEMORY_DONE", () => {
    return { success: orchestrator.markMemoryDone() };
  });

  onMessage("MIGRATION_UPDATE_DELIVERY", (payload) => {
    return {
      success: orchestrator.updateDelivery(
        payload.workspaceId,
        payload.delivery,
      ),
    };
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    orchestrator.onTabClosed(tabId);
  });
}

export { orchestrator };
