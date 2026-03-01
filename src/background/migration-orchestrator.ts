import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  OrchestratorStatus,
  MigrationStep,
  MigrationStepFallback,
  MigrationGuidedInstructions,
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
    const tabId = await this.findClaudeTab();
    if (tabId === null) {
      const error = "No Claude tab found. Please open claude.ai first.";
      console.warn(
        `[Portsmith] Workspace "${workspace.name}" failed: ${error}`,
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

        this.updateStep(step);
      }

      this.completedWorkspaceIds.push(workspace.id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Portsmith] Workspace "${workspace.name}" failed: ${errorMsg}`,
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
}

export { orchestrator };
