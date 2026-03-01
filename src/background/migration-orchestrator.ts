import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  OrchestratorStatus,
  MigrationStep,
  MigrationStepFallback,
  MigrationGuidedInstructions,
  InstructionsDelivery,
} from "@/shared/messaging";
import { onMessage } from "@/shared/messaging";
import { autofillWorkspace } from "@/core/adapters/claude-autofill";
import {
  generateInstructions,
  generateMemoryInstructions,
} from "@/core/adapters/claude-adapter";
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
  ): Promise<boolean> {
    if (this.phase === "running") return false;

    const record = await loadManifest(manifestId);
    if (!record) return false;

    this.resetState();
    this.manifest = record.data;
    this.manifestId = manifestId;
    this.mode = mode;
    this.workspaceIds = workspaceIds;
    this.phase = "running";
    this.memorySteps = generateMemoryInstructions(this.manifest.memory);

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
    this.workspaceIds = snap.selectedWorkspaceIds;
    this.completedWorkspaceIds = [...snap.completedWorkspaceIds];
    this.currentWorkspaceIndex = ckpt.workspaceIndex;
    this.instructionsDelivery = snap.instructionsDelivery
      ? { ...snap.instructionsDelivery }
      : {};
    this.phase = "running";
    this.memorySteps = generateMemoryInstructions(this.manifest.memory);

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

      if (this.mode === "guided") {
        await this.processGuidedWorkspace(workspace);
      } else {
        await this.processAutofillWorkspace(workspace);
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
    const tabId = await this.getTabForAutofill();
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

        // Hybrid: pause at pending status for user confirmation
        if (isHybrid && step.status === "pending") {
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

    const snapshot: MigrationStateSnapshot = {
      phase: "migrating",
      sourcePlatform: "chatgpt",
      targetPlatform: "claude",
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
    this.cancelRequested = false;
    this.pauseRequested = false;
    this.pauseResolver = null;
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
}

export { orchestrator };
