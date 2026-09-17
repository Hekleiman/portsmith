import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  OrchestratorStatus,
  MigrationStep,
  MigrationStepFallback,
  MigrationGuidedInstructions,
  InstructionsDelivery,
  KnowledgeLeftover,
} from "@/shared/messaging";
import { onMessage, safeSendTabMessage } from "@/shared/messaging";
import { autofillWorkspace } from "@/core/adapters/claude-autofill";
import { generateInstructions } from "@/core/adapters/claude-adapter";
import {
  GEMINI_GEM_MANAGER_URL,
  generateGeminiInstructions,
  geminiGemEditUrl,
} from "@/core/adapters/gemini-guided";
import { generateChatGPTInstructions } from "@/core/adapters/chatgpt-guided";
import { buildMemoryStepsForTarget } from "@/core/adapters/memory-steps";
import { buildManualCreateFallback, handOverNote } from "@/core/adapters/manual-fallback";
import {
  hasProjectMemory,
  projectMemoryFileName,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";
import { textToBase64 } from "@/shared/encoding";
import {
  getInstructionsForTarget,
  isPlatformId,
  platformLabel,
  supportedModesForTarget,
  type PlatformId,
} from "@/core/platforms";
import {
  loadFile,
  loadManifest,
  saveCheckpoint,
  loadLatestCheckpoint,
  clearCheckpoints,
  type MigrationStateSnapshot,
  type DeliveryMode,
} from "@/core/storage/indexed-db";

type Target = PlatformId;

interface ManualWorkspace {
  id: string;
  name: string;
  reason: string;
}

function normalizeTarget(value: string | null | undefined): Target {
  return isPlatformId(value) ? value : "claude";
}

// ─── Orchestrator ───────────────────────────────────────────

const GEMINI_TABS = "https://gemini.google.com/*";
const GEMINI_TAB_URL = /^https:\/\/gemini\.google\.com\//;

/** Google account path of a Gemini URL: "/u/1/", or "/u/0/" without one. */
export function geminiAccountPath(url: string | undefined): string {
  const match = /^https:\/\/gemini\.google\.com\/u\/(\d+)(?:[/?#]|$)/.exec(url ?? "");
  return `/u/${match?.[1] ?? "0"}/`;
}

function geminiAppUrl(account: string | null): string {
  return !account || account === "/u/0/"
    ? "https://gemini.google.com/app"
    : `https://gemini.google.com${account}app`;
}

export class MigrationOrchestrator {
  private phase: OrchestratorStatus["phase"] = "idle";
  private mode: DeliveryMode | null = null;
  private targetPlatform: Target = "claude";
  private manifestId: string | null = null;
  private manifest: PortsmithManifest | null = null;
  private workspaceIds: string[] = [];
  private currentWorkspaceIndex = 0;
  private completedWorkspaceIds: string[] = [];
  private failedWorkspaces: Array<{ id: string; name: string; error: string }> = [];
  private manualWorkspaces: ManualWorkspace[] = [];
  private currentSteps: MigrationStep[] = [];
  private pendingConfirmStepId: string | null = null;
  private pendingConfirmToken: string | null = null;
  private confirmSeq = 0;
  private guidedInstructions: MigrationGuidedInstructions | null = null;
  private memorySteps: MigrationStepFallback[] = [];
  private instructionsDelivery: Record<string, InstructionsDelivery> = {};
  private verifiedWorkspaceIds: string[] = [];
  /** Created on the target (checkpointed right away to prevent duplicates). */
  private createdWorkspaceIds: string[] = [];
  private followUps: Record<string, string[]> = {};
  private filesDelivered: Record<string, number> = {};
  private projectMemoryWorkspaceIds: string[] = [];
  private knowledgeLeftovers: Record<string, KnowledgeLeftover> = {};
  private memoryImported: boolean | null = null;
  private migrationTabId: number | null = null;
  /** Google account path of the pinned Gemini tab, e.g. "/u/1/" */
  private geminiAccount: string | null = null;
  private duplicateTabWarning: string | null = null;

  /**
   * Every start/resume/cancel bumps the run id. Async loops capture the id
   * they were started with and stop as soon as it changes, so a cancelled
   * run can never keep creating projects in the background.
   */
  private runId = 0;
  /** Guards against overlapping start()/resume() calls (e.g. double clicks). */
  private starting = false;

  // Resolvers for async coordination
  private confirmResolver: ((confirmed: boolean) => void) | null = null;
  private guidedResolver: (() => void) | null = null;
  private pauseResolver: (() => void) | null = null;
  private pauseRequested = false;

  // ─── Public API ────────────────────────────────────────────

  async start(
    manifestId: string,
    mode: DeliveryMode,
    workspaceIds: string[],
    targetPlatform?: string,
  ): Promise<boolean> {
    if (this.starting || this.isActive()) return false;
    this.starting = true;
    const token = this.runId;
    try {
      const record = await loadManifest(manifestId);
      // A cancel while the manifest was loading wins.
      if (!record || token !== this.runId) return false;

      const run = this.beginRun();
      const target = normalizeTarget(targetPlatform);
      this.manifest = record.data;
      this.manifestId = manifestId;
      this.targetPlatform = target;
      this.mode = supportedModesForTarget(target).includes(mode) ? mode : "guided";
      this.workspaceIds = [...new Set(workspaceIds)];
      this.phase = "running";
      this.memorySteps = this.buildMemorySteps();
      this.duplicateTabWarning = await this.checkDuplicateTabs();
      if (!this.isCurrent(run)) return false;

      await this.checkpointState(run);
      void this.processWorkspaces(run);
      return true;
    } finally {
      this.starting = false;
    }
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
      const resolve = this.pauseResolver;
      this.pauseResolver = null;
      resolve?.();
      return true;
    }

    // A run is already active (e.g. a second click on Resume)
    if (this.starting || this.phase !== "idle") return false;

    // Resume from checkpoint (after service worker restart)
    this.starting = true;
    const token = this.runId;
    try {
      const ckpt = await loadLatestCheckpoint();
      if (!ckpt || token !== this.runId) return false;

      const snap = ckpt.migrationState;
      if (!snap.manifestId || !snap.deliveryMode) return false;
      if (snap.phase !== "migrating") return false;

      const record = await loadManifest(snap.manifestId);
      if (!record || token !== this.runId) return false;

      const run = this.beginRun();
      const target = normalizeTarget(snap.targetPlatform);
      this.manifest = record.data;
      this.manifestId = snap.manifestId;
      this.targetPlatform = target;
      this.mode = supportedModesForTarget(target).includes(snap.deliveryMode)
        ? snap.deliveryMode
        : "guided";
      this.workspaceIds = [...new Set(snap.selectedWorkspaceIds)];
      this.completedWorkspaceIds = [...snap.completedWorkspaceIds];
      this.failedWorkspaces = [...(snap.failedWorkspaces ?? [])];
      this.manualWorkspaces = [...(snap.manualWorkspaces ?? [])];
      this.verifiedWorkspaceIds = [...(snap.verifiedWorkspaceIds ?? [])];
      this.createdWorkspaceIds = [...(snap.createdWorkspaceIds ?? [])];
      this.followUps = { ...(snap.followUps ?? {}) };
      this.filesDelivered = { ...(snap.filesDelivered ?? {}) };
      this.projectMemoryWorkspaceIds = [...(snap.projectMemoryWorkspaceIds ?? [])];
      this.knowledgeLeftovers = { ...(snap.knowledgeLeftovers ?? {}) };
      this.memoryImported = snap.memoryImported ?? null;
      this.currentWorkspaceIndex = Math.max(
        0,
        Math.min(ckpt.workspaceIndex, this.workspaceIds.length),
      );
      this.instructionsDelivery = snap.instructionsDelivery
        ? { ...snap.instructionsDelivery }
        : {};
      this.phase = "running";
      this.memorySteps = this.buildMemorySteps();

      void this.processWorkspaces(run);
      return true;
    } finally {
      this.starting = false;
    }
  }

  cancel(): boolean {
    const waiting = {
      confirm: this.confirmResolver,
      pause: this.pauseResolver,
      guided: this.guidedResolver,
    };
    this.runId++;
    this.resetState();
    // Wake any suspended loop; it sees the new run id and exits.
    waiting.confirm?.(false);
    waiting.pause?.();
    waiting.guided?.();
    clearCheckpoints().catch(() => {
      // Nothing to resume either way
    });
    return true;
  }

  getStatus(): OrchestratorStatus {
    const ws = this.getCurrentWorkspace();
    const instr = ws ? getInstructionsForTarget(ws, this.targetPlatform) : null;

    // Build clipboard instructions map for workspaces that fell back
    // (kept for runs checkpointed by older versions)
    const clipboardInstructions: Record<string, string> = {};
    if (this.manifest) {
      for (const [wsId, delivery] of Object.entries(this.instructionsDelivery)) {
        if (delivery !== "clipboard") continue;
        const workspace = this.manifest.workspaces.find((w) => w.id === wsId);
        const text = workspace
          ? getInstructionsForTarget(workspace, this.targetPlatform)
          : "";
        if (text.length > 0) clipboardInstructions[wsId] = text;
      }
    }

    return {
      phase: this.phase,
      mode: this.mode,
      targetPlatform: this.phase === "idle" ? null : this.targetPlatform,
      manifestId: this.manifestId,
      totalWorkspaces: this.workspaceIds.length,
      currentWorkspaceIndex: this.currentWorkspaceIndex,
      currentWorkspaceName: ws?.name ?? null,
      completedWorkspaceIds: [...this.completedWorkspaceIds],
      failedWorkspaces: [...this.failedWorkspaces],
      manualWorkspaces: [...this.manualWorkspaces],
      currentSteps: [...this.currentSteps],
      pendingConfirmStepId: this.pendingConfirmStepId,
      pendingConfirmToken: this.pendingConfirmToken,
      guidedInstructions: this.guidedInstructions,
      memorySteps: this.memorySteps,
      hasMemory: this.memorySteps.length > 0,
      instructionsDelivery: { ...this.instructionsDelivery },
      currentWorkspaceInstructions: instr && instr.length > 0 ? instr : null,
      clipboardInstructions,
      verifiedWorkspaceIds: [...this.verifiedWorkspaceIds],
      createdWorkspaceIds: [...this.createdWorkspaceIds],
      followUps: { ...this.followUps },
      filesDelivered: { ...this.filesDelivered },
      projectMemoryWorkspaceIds: [...this.projectMemoryWorkspaceIds],
      knowledgeLeftovers: { ...this.knowledgeLeftovers },
      memoryImported: this.memoryImported,
      duplicateTabWarning: this.duplicateTabWarning ?? undefined,
    };
  }

  /**
   * Answer the question that is waiting. With `token`, the answer only
   * counts for that exact question, so a late second click can't answer
   * the next one.
   */
  confirmStep(confirmed: boolean, token?: string): boolean {
    const resolve = this.confirmResolver;
    if (!resolve) return false;
    if (token !== undefined && token !== this.pendingConfirmToken) return false;
    this.confirmResolver = null;
    this.pendingConfirmStepId = null;
    this.pendingConfirmToken = null;
    resolve(confirmed);
    return true;
  }

  markWorkspaceDone(workspaceId: string, skippedStepIds: string[] = []): boolean {
    if (this.mode !== "guided") return false;
    const ws = this.getCurrentWorkspace();
    if (!ws || ws.id !== workspaceId) return false;
    const resolve = this.guidedResolver;
    if (!resolve) return false;
    this.guidedResolver = null;
    this.recordGuidedOutcome(ws, new Set(skippedStepIds));
    resolve();
    return true;
  }

  markMemoryDone(allDone = true): boolean {
    if (this.phase !== "memory") return false;
    this.memoryImported = allDone;
    this.phase = "complete";
    void this.checkpointState(this.runId);
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

  onTabClosed(tabId: number): void {
    if (this.migrationTabId === tabId) {
      this.migrationTabId = null;
    }
  }

  // ─── Private ───────────────────────────────────────────────

  private isActive(): boolean {
    return (
      this.phase === "running" ||
      this.phase === "paused" ||
      this.phase === "memory"
    );
  }

  private beginRun(): number {
    const waiting = [this.confirmResolver, this.pauseResolver, this.guidedResolver];
    this.runId++;
    this.resetState();
    for (const resolve of waiting) {
      (resolve as ((v?: boolean) => void) | null)?.(false);
    }
    return this.runId;
  }

  private isCurrent(run: number): boolean {
    return run === this.runId;
  }

  private sourceLabel(): string {
    return platformLabel(this.manifest?.source.platform);
  }

  private buildMemorySteps(): MigrationStepFallback[] {
    return buildMemoryStepsForTarget(this.manifest, this.targetPlatform);
  }

  private getCurrentWorkspace(): Workspace | null {
    if (!this.manifest) return null;
    const wsId = this.workspaceIds[this.currentWorkspaceIndex];
    if (!wsId) return null;
    return this.manifest.workspaces.find((w) => w.id === wsId) ?? null;
  }

  private async findTab(urlPattern: string): Promise<number | null> {
    try {
      const active = await chrome.tabs.query({
        url: urlPattern,
        active: true,
        currentWindow: true,
      });
      if (active[0]?.id != null) return active[0].id;

      const all = await chrome.tabs.query({ url: urlPattern });
      if (all[0]?.id != null) return all[0].id;
    } catch {
      // Not in extension context
    }
    return null;
  }

  /**
   * Find a tab for autofill: prefer an existing Claude tab, otherwise open a
   * new one. Never repurpose whatever tab the user happens to be on.
   */
  private async getTabForAutofill(): Promise<number | null> {
    const claudeTab = await this.findTab("https://claude.ai/*");
    if (claudeTab !== null) return claudeTab;

    try {
      const tab = await chrome.tabs.create({
        url: "https://claude.ai/projects",
        active: true,
      });
      return tab.id ?? null;
    } catch {
      return null;
    }
  }

  private async validateAndPinTab(): Promise<number | null> {
    if (this.migrationTabId !== null) {
      try {
        const tab = await chrome.tabs.get(this.migrationTabId);
        if (tab && !tab.discarded && /^https:\/\/claude\.ai\//.test(tab.url ?? "")) {
          return this.migrationTabId;
        }
      } catch {
        // Tab was closed; pick another
      }
      this.migrationTabId = null;
    }

    const tabId = await this.getTabForAutofill();
    if (tabId !== null) {
      this.migrationTabId = tabId;
    }
    return tabId;
  }

  /**
   * The Gemini tab for this run. Once picked, the run stays with that tab's
   * Google account: requests from a /u/1/ tab act on that account only.
   */
  private async getGeminiTab(): Promise<number | null> {
    if (this.migrationTabId !== null) {
      try {
        const tab = await chrome.tabs.get(this.migrationTabId);
        if (
          tab &&
          GEMINI_TAB_URL.test(tab.url ?? "") &&
          (this.geminiAccount === null || geminiAccountPath(tab.url) === this.geminiAccount)
        ) {
          return this.migrationTabId;
        }
      } catch {
        // Tab was closed
      }
      this.migrationTabId = null;
    }

    try {
      const [active, all] = await Promise.all([
        chrome.tabs.query({ url: GEMINI_TABS, active: true, currentWindow: true }),
        chrome.tabs.query({ url: GEMINI_TABS }),
      ]);
      const tab = [...active, ...all].find(
        (t) =>
          t.id != null &&
          (this.geminiAccount === null || geminiAccountPath(t.url) === this.geminiAccount),
      );
      if (tab?.id != null) {
        this.migrationTabId = tab.id;
        this.geminiAccount ??= geminiAccountPath(tab.url);
        return tab.id;
      }
    } catch {
      // Not in extension context
    }
    return null;
  }

  private async checkDuplicateTabs(): Promise<string | null> {
    if (this.targetPlatform === "chatgpt") return null;
    const urlPattern =
      this.targetPlatform === "gemini" ? GEMINI_TABS : "https://claude.ai/*";

    try {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      if (this.targetPlatform === "gemini") {
        const accounts = [...new Set(tabs.map((t) => geminiAccountPath(t.url)))].sort();
        if (accounts.length > 1) {
          await this.getGeminiTab();
          const using = this.geminiAccount ?? "/u/0/";
          return `Gemini is open in ${accounts.length} Google accounts (${accounts.join(", ")}). PortSmith will use the account at gemini.google.com${using}. Close the Gemini tabs of the other accounts so no Gem ends up in the wrong account.`;
        }
      }
      if (tabs.length > 1) {
        return `${tabs.length} ${platformLabel(this.targetPlatform)} tabs are open. PortSmith uses one of them; close the extras if you run into problems.`;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private async processWorkspaces(run: number): Promise<void> {
    while (this.currentWorkspaceIndex < this.workspaceIds.length) {
      if (!this.isCurrent(run)) return;

      // Pause check (between workspaces)
      if (this.pauseRequested) {
        this.phase = "paused";
        await new Promise<void>((resolve) => {
          this.pauseResolver = resolve;
        });
        if (!this.isCurrent(run)) return;
      }

      const workspace = this.getCurrentWorkspace();
      if (
        workspace &&
        !this.completedWorkspaceIds.includes(workspace.id) &&
        this.createdWorkspaceIds.includes(workspace.id)
      ) {
        // An earlier run created this one and was interrupted before it
        // finished. Creating it again would leave a duplicate.
        this.addManualWorkspace(
          workspace,
          `Created, but PortSmith stopped before it finished. Check its instructions and files in ${platformLabel(this.targetPlatform)}.`,
        );
      } else if (workspace && !this.completedWorkspaceIds.includes(workspace.id)) {
        switch (this.targetPlatform) {
          case "gemini":
            if (this.mode === "guided") {
              await this.processGuidedWorkspace(run, workspace);
            } else {
              await this.processGeminiAutofillWorkspace(run, workspace);
            }
            break;
          case "chatgpt":
            await this.processGuidedWorkspace(run, workspace);
            break;
          default:
            if (this.mode === "guided") {
              await this.processGuidedWorkspace(run, workspace);
            } else {
              await this.processAutofillWorkspace(run, workspace);
            }
        }
      }

      if (!this.isCurrent(run)) return;

      this.currentWorkspaceIndex++;
      this.currentSteps = [];
      this.guidedInstructions = null;
      await this.checkpointState(run);
    }

    if (!this.isCurrent(run)) return;
    this.phase = this.memorySteps.length > 0 ? "memory" : "complete";
    await this.checkpointState(run);
  }

  /** Suspend until the user answers the pending step. */
  private waitForConfirmation(stepId: string): Promise<boolean> {
    this.pendingConfirmStepId = stepId;
    this.pendingConfirmToken = `${stepId}#${++this.confirmSeq}`;
    return new Promise<boolean>((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  private guidedInstructionsFor(workspace: Workspace): MigrationGuidedInstructions {
    const source = this.sourceLabel();
    switch (this.targetPlatform) {
      case "gemini":
        return generateGeminiInstructions(workspace, source);
      case "chatgpt":
        return generateChatGPTInstructions(workspace, source);
      default:
        return generateInstructions(workspace, source);
    }
  }

  private async processGuidedWorkspace(
    run: number,
    workspace: Workspace,
  ): Promise<void> {
    this.guidedInstructions = this.guidedInstructionsFor(workspace);
    const instructions = getInstructionsForTarget(workspace, this.targetPlatform);
    this.instructionsDelivery[workspace.id] = instructions.trim() ? "pending" : "none";

    await new Promise<void>((resolve) => {
      this.guidedResolver = resolve;
    });
    if (!this.isCurrent(run)) return;

    if (instructions.trim()) this.instructionsDelivery[workspace.id] = "manual";
    this.completedWorkspaceIds.push(workspace.id);
  }

  private async processAutofillWorkspace(
    run: number,
    workspace: Workspace,
  ): Promise<void> {
    this.currentSteps = [];
    const tabId = await this.validateAndPinTab();
    if (!this.isCurrent(run)) return;
    if (tabId === null) {
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: "Couldn't open a Claude tab",
      });
      return;
    }

    const instructions = getInstructionsForTarget(workspace, "claude");
    this.instructionsDelivery[workspace.id] =
      instructions.trim().length > 0 ? "pending" : "none";

    let created = false;
    let skipped = false;

    try {
      const gen = autofillWorkspace(workspace, tabId, {
        hybrid: this.mode === "hybrid",
        sourceLabel: this.sourceLabel(),
      });
      let nextInput: boolean | undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!this.isCurrent(run)) {
          void gen.return(undefined);
          return;
        }

        const { value, done } = await gen.next(nextInput);
        if (!this.isCurrent(run)) {
          void gen.return(undefined);
          return;
        }
        if (done || !value) break;
        nextInput = undefined;

        const step: MigrationStep = value;
        if (step.instructionsDelivery) {
          this.instructionsDelivery[workspace.id] = step.instructionsDelivery;
        }
        if (step.verified === true && !this.verifiedWorkspaceIds.includes(workspace.id)) {
          this.verifiedWorkspaceIds.push(workspace.id);
        }
        if (step.projectCreated && !created) {
          created = true;
          await this.markCreated(run, workspace.id);
          if (!this.isCurrent(run)) {
            void gen.return(undefined);
            return;
          }
        }
        if (step.id === `${workspace.id}-create-api` && step.status === "skipped") {
          skipped = true;
        }

        this.updateStep(step);

        if (step.status === "pending" || step.status === "navigate_failed") {
          const confirmed = await this.waitForConfirmation(step.id);
          if (!this.isCurrent(run)) {
            void gen.return(undefined);
            return;
          }
          nextInput = confirmed;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[PortSmith] Workspace "${workspace.name}" failed: ${errorMsg}`);
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: errorMsg,
      });
      return;
    }

    const lastStep = this.currentSteps[this.currentSteps.length - 1];
    if (created) {
      this.recordAutofillOutcome(workspace);
      this.completedWorkspaceIds.push(workspace.id);
    } else if (lastStep?.status === "failed") {
      this.failedWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        error: lastStep.title,
      });
    } else {
      const createStep = this.currentSteps.find((st) => st.id === `${workspace.id}-create-api`);
      this.addManualWorkspace(
        workspace,
        skipped
          ? (createStep?.title.startsWith("Skipped:")
              ? createStep.title.slice("Skipped:".length).trim().replace(/^./, (c) => c.toUpperCase())
              : "Skipped")
          : "Not created in Claude",
      );
    }
  }

  /** Steps that ended without doing their job become follow-ups. */
  private recordAutofillOutcome(workspace: Workspace): void {
    const ignored = new Set(
      ["navigate", "create-api", "create", "open-project"].map((s) => `${workspace.id}-${s}`),
    );
    const notes: string[] = [];
    let files = 0;
    for (const step of this.currentSteps) {
      if (step.filesDelivered) files += step.filesDelivered;
      if (step.projectMemoryAdded && !this.projectMemoryWorkspaceIds.includes(workspace.id)) {
        this.projectMemoryWorkspaceIds.push(workspace.id);
      }
      if (step.followUp) notes.push(step.followUp);
      if (ignored.has(step.id)) continue;
      if (step.status === "skipped" || step.status === "fallback" || step.status === "failed") {
        notes.push(step.title);
      }
    }
    if (notes.length > 0) this.followUps[workspace.id] = notes;
    if (files > 0) this.filesDelivered[workspace.id] = files;
  }

  /** Guided flows: the user's ticks are all we know. */
  private recordGuidedOutcome(workspace: Workspace, skipped: Set<string>): void {
    const steps = this.guidedInstructions?.steps ?? [];
    const notes = steps
      .filter((st) => skipped.has(st.id))
      .map((st) => `Not marked done: ${st.title}`);
    if (notes.length > 0) this.followUps[workspace.id] = notes;
    else delete this.followUps[workspace.id];

    const fileStepSkipped = [...skipped].some((id) => /-(files|knowledge)$/.test(id));
    if (!fileStepSkipped && workspace.knowledgeFiles.length > 0) {
      this.filesDelivered[workspace.id] = workspace.knowledgeFiles.length;
    }
    const memoryStepSkipped = [...skipped].some((id) =>
      /-(files|knowledge|project-memory)$/.test(id),
    );
    if (
      hasProjectMemory(workspace) &&
      !memoryStepSkipped &&
      !this.projectMemoryWorkspaceIds.includes(workspace.id)
    ) {
      this.projectMemoryWorkspaceIds.push(workspace.id);
    }
  }

  // ─── Gemini Target ──────────────────────────────────────

  private async processGeminiAutofillWorkspace(
    run: number,
    workspace: Workspace,
  ): Promise<void> {
    this.currentSteps = [];
    const stepId = `${workspace.id}-create`;
    const instructions = getInstructionsForTarget(workspace, "gemini");
    this.instructionsDelivery[workspace.id] = instructions.trim() ? "pending" : "none";
    const source = this.sourceLabel();

    if (this.mode === "hybrid") {
      this.updateStep({
        id: stepId,
        title: `Create the Gem "${workspace.name}"?`,
        status: "pending",
        confirmLabel: "Create Gem",
        skipLabel: "Skip",
      });
      const go = await this.waitForConfirmation(stepId);
      if (!this.isCurrent(run)) return;
      if (!go) {
        this.updateStep({ id: stepId, title: `Skipped "${workspace.name}"`, status: "skipped" });
        this.addManualWorkspace(workspace, "Skipped");
        return;
      }
    }

    this.updateStep({
      id: stepId,
      title: `Checking your Gems for "${workspace.name}"`,
      status: "running",
    });

    let tabId = await this.getGeminiTab();
    if (!this.isCurrent(run)) return;
    if (tabId === null) {
      try {
        const tab = await chrome.tabs.create({
          url: geminiAppUrl(this.geminiAccount),
          active: false,
        });
        tabId = tab.id ?? null;
        this.migrationTabId = tabId;
        // Give the page time to load before messaging it
        await new Promise((r) => setTimeout(r, 3000));
      } catch {
        tabId = null;
      }
      if (!this.isCurrent(run)) return;
    }

    // Don't create a second Gem with the same name without asking.
    const before = tabId === null ? null : await this.findGemsNamed(tabId, workspace.name);
    if (!this.isCurrent(run)) return;
    if (before && before.length > 0 && this.mode !== "hybrid") {
      // Automatic runs never stop to ask: leave it for the results page.
      this.updateStep({
        id: stepId,
        title: `Skipped "${workspace.name}": a Gem with this name is already in Gemini`,
        status: "skipped",
      });
      this.addManualWorkspace(workspace, "A Gem with this name is already in Gemini");
      return;
    }
    if (before && before.length > 0) {
      this.updateStep({
        id: stepId,
        title: `A Gem named "${workspace.name}" is already in Gemini. Create another one?`,
        status: "pending",
        confirmLabel: "Create another",
        skipLabel: "Skip this one",
      });
      const again = await this.waitForConfirmation(stepId);
      if (!this.isCurrent(run)) return;
      if (!again) {
        this.updateStep({ id: stepId, title: `Skipped "${workspace.name}"`, status: "skipped" });
        this.addManualWorkspace(workspace, "A Gem with this name is already in Gemini");
        return;
      }
    }

    this.updateStep({
      id: stepId,
      title: `Creating Gem "${workspace.name}"`,
      status: "running",
    });

    let error = "";
    let gemId: string | undefined;
    if (tabId === null) {
      error = "Couldn't open a Gemini tab";
    } else {
      try {
        const result = await safeSendTabMessage(tabId, "GEMINI_CREATE_GEM", {
          name: workspace.name,
          description: workspace.description,
          instructions,
        });
        if (result.success) gemId = result.gemId;
        else error = result.error ?? "Unknown error";
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (error && before !== null) {
        // The request may have gone through even though it reported a
        // problem. Only a Gem that wasn't there a moment ago can be ours.
        const after = await this.findGemsNamed(tabId, workspace.name);
        const known = new Set(before);
        const fresh = after?.filter((id) => !known.has(id)) ?? [];
        if (fresh.length === 1) {
          console.warn(`[PortSmith] Gem create reported "${error}", but the Gem exists`);
          gemId = fresh[0];
          error = "";
        }
      }
    }
    if (!this.isCurrent(run)) return;

    if (!error) {
      this.updateStep({
        id: stepId,
        title: `Created Gem "${workspace.name}"`,
        status: "success",
        projectCreated: true,
      });
      if (instructions.trim()) this.instructionsDelivery[workspace.id] = "autofilled";
      this.completedWorkspaceIds.push(workspace.id);
      if (gemId) console.log(`[PortSmith] Created Gem ${gemId}`);
      await this.markCreated(run, workspace.id);
      if (!this.isCurrent(run)) return;

      await this.addGemKnowledge(run, tabId, gemId, workspace, instructions, source);
      return;
    }

    if (this.mode !== "hybrid") {
      // Automatic runs keep going; the results page has the manual route.
      const unsure = before === null;
      this.updateStep({
        id: stepId,
        title: `Couldn't create "${workspace.name}". It's listed at the end`,
        status: "failed",
      });
      this.addManualWorkspace(
        workspace,
        unsure
          ? `Gemini didn't confirm the new Gem (${error}). Check your Gems before creating it by hand`
          : `Not created in Gemini (${error})`,
      );
      return;
    }

    // API failed: offer the manual route and wait for the user.
    this.updateStep({
      id: stepId,
      title: `Couldn't create "${workspace.name}" automatically`,
      status: "pending",
      fallback: buildManualCreateFallback(
        workspace,
        "gemini",
        source,
        `Gemini didn't confirm the new Gem (${error}). Check your Gems first. If "${workspace.name}" isn't there, create it by hand:`,
      ),
      confirmLabel: "It's in Gemini now",
      skipLabel: "Skip this one",
    });
    const done = await this.waitForConfirmation(stepId);
    if (!this.isCurrent(run)) return;
    if (done) {
      this.updateStep({ id: stepId, title: `Created "${workspace.name}" by hand`, status: "success", projectCreated: true });
      if (instructions.trim()) this.instructionsDelivery[workspace.id] = "manual";
      const note = handOverNote(
        workspace,
        instructions,
        hasProjectMemory(workspace) ? "memory" : "",
      );
      this.followUps[workspace.id] = [note];
      this.completedWorkspaceIds.push(workspace.id);
      await this.markCreated(run, workspace.id);
    } else {
      this.updateStep({ id: stepId, title: `"${workspace.name}" not created`, status: "skipped" });
      this.addManualWorkspace(workspace, `Not created in Gemini (${error})`);
    }
  }

  /**
   * Put the copied files and the project memory document into the Gem's
   * Knowledge. Never waits for the user: whatever doesn't make it is
   * listed on the results page with its downloads.
   */
  private async addGemKnowledge(
    run: number,
    tabId: number | null,
    gemId: string | undefined,
    workspace: Workspace,
    instructions: string,
    source: string,
  ): Promise<void> {
    const copied = workspace.knowledgeFiles.filter((f) => f.contentRef);
    const withMemory = hasProjectMemory(workspace);
    const total = copied.length + (withMemory ? 1 : 0);
    if (total === 0) return;

    const stepId = `${workspace.id}-knowledge`;
    const link = gemId
      ? geminiGemEditUrl(gemId, this.geminiAccount)
      : GEMINI_GEM_MANAGER_URL;
    const leftover = (fileNames: string[], memory: boolean, why: string): void => {
      if (fileNames.length === 0 && !memory) return;
      this.knowledgeLeftovers[workspace.id] = { link, fileNames, projectMemory: memory };
      const what = [
        ...(fileNames.length > 0
          ? [`${fileNames.length} file${fileNames.length === 1 ? "" : "s"}`]
          : []),
        ...(memory ? ["the project memory document"] : []),
      ].join(" and ");
      this.addFollowUp(workspace.id, `Add ${what} to the Gem by hand (${why})`);
    };

    if (tabId === null || !gemId) {
      this.updateStep({
        id: stepId,
        title: "Knowledge files left for the end",
        status: "skipped",
      });
      leftover(
        copied.map((f) => f.originalName),
        withMemory,
        "PortSmith didn't get the new Gem's ID",
      );
      return;
    }

    this.updateStep({
      id: stepId,
      title: `Adding ${total} file${total === 1 ? "" : "s"} to the Gem`,
      status: "running",
    });

    const handles: string[] = [];
    const sentFiles: string[] = [];
    let memorySent = false;
    const failures: string[] = [];

    const upload = async (fileName: string, mimeType: string, base64: string): Promise<boolean> => {
      try {
        const result = await safeSendTabMessage(tabId, "GEMINI_UPLOAD_KNOWLEDGE_FILE", {
          fileName,
          mimeType,
          base64,
        });
        if (result.success && result.handle) {
          handles.push(result.handle);
          return true;
        }
        failures.push(`${fileName}: ${result.error ?? "upload failed"}`);
      } catch (err) {
        failures.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    };

    if (withMemory) {
      const doc = renderProjectMemoryMarkdown(workspace, source);
      memorySent = await upload(projectMemoryFileName(source), "text/markdown", textToBase64(doc));
      if (!this.isCurrent(run)) return;
    }
    for (const file of copied) {
      const record = await loadFile(file.contentRef!).catch(() => undefined);
      if (!this.isCurrent(run)) return;
      if (!record?.blob) {
        failures.push(`${file.originalName}: the copied file is missing`);
        continue;
      }
      if (await upload(file.originalName, file.mimeType || record.mimeType, record.blob)) {
        sentFiles.push(file.originalName);
      }
      if (!this.isCurrent(run)) return;
    }

    let saved = false;
    if (handles.length > 0) {
      try {
        const result = await safeSendTabMessage(tabId, "GEMINI_UPDATE_GEM", {
          gemId,
          name: workspace.name,
          description: workspace.description,
          instructions,
          knowledgeHandles: handles,
        });
        saved = result.success;
        if (!saved) failures.push(`saving the Gem: ${result.error ?? "unknown error"}`);
      } catch (err) {
        failures.push(`saving the Gem: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!this.isCurrent(run)) return;
    }

    const addedFiles = saved ? sentFiles : [];
    const memoryAdded = saved && memorySent;
    if (addedFiles.length > 0) this.filesDelivered[workspace.id] = addedFiles.length;
    if (memoryAdded && !this.projectMemoryWorkspaceIds.includes(workspace.id)) {
      this.projectMemoryWorkspaceIds.push(workspace.id);
    }
    const added = addedFiles.length + (memoryAdded ? 1 : 0);

    if (added === total) {
      this.updateStep({
        id: stepId,
        title: `Added ${total} file${total === 1 ? "" : "s"} to the Gem`,
        status: "success",
        filesDelivered: addedFiles.length,
      });
    } else {
      if (failures.length > 0) {
        console.warn(`[PortSmith] Gem knowledge for "${workspace.name}": ${failures.join("; ")}`);
      }
      this.updateStep({
        id: stepId,
        title: `Added ${added} of ${total} files to the Gem. The rest are listed at the end`,
        status: "fallback",
        filesDelivered: addedFiles.length,
      });
      leftover(
        copied.map((f) => f.originalName).filter((n) => !addedFiles.includes(n)),
        withMemory && !memoryAdded,
        failures[0] ?? "Gemini didn't accept them",
      );
    }
  }

  private addFollowUp(workspaceId: string, note: string): void {
    const notes = this.followUps[workspaceId] ?? [];
    if (!notes.includes(note)) notes.push(note);
    this.followUps[workspaceId] = notes;
  }

  /** IDs of the user's Gems with this name, or null if they can't be listed. */
  private async findGemsNamed(tabId: number, name: string): Promise<string[] | null> {
    try {
      const result = await safeSendTabMessage(tabId, "GEMINI_EXTRACT_GEMS");
      if (!result.success) return null;
      const key = name.trim().replace(/\s+/g, " ").toLowerCase();
      return result.gems
        .filter((g) => !g.predefined && g.name.trim().replace(/\s+/g, " ").toLowerCase() === key)
        .map((g) => g.id);
    } catch {
      return null;
    }
  }

  private addManualWorkspace(workspace: Workspace, reason: string): void {
    const existing = this.manualWorkspaces.find((m) => m.id === workspace.id);
    if (existing) {
      existing.reason = reason;
      return;
    }
    this.manualWorkspaces.push({ id: workspace.id, name: workspace.name, reason });
  }

  /** Record a creation immediately so a restart can't create it twice. */
  private async markCreated(run: number, workspaceId: string): Promise<void> {
    if (!this.createdWorkspaceIds.includes(workspaceId)) {
      this.createdWorkspaceIds.push(workspaceId);
    }
    await this.checkpointState(run);
  }

  private updateStep(step: MigrationStep): void {
    const idx = this.currentSteps.findIndex((s) => s.id === step.id);
    if (idx >= 0) {
      this.currentSteps[idx] = step;
    } else {
      this.currentSteps.push(step);
    }
  }

  private async checkpointState(run: number): Promise<void> {
    if (!this.isCurrent(run) || !this.manifestId || !this.mode) return;

    const snapshot: MigrationStateSnapshot = {
      phase: this.phase === "complete" ? "complete" : "migrating",
      sourcePlatform: this.manifest?.source.platform ?? "chatgpt",
      targetPlatform: this.targetPlatform,
      extractionMethod: null,
      deliveryMode: this.mode,
      manifestId: this.manifestId,
      selectedWorkspaceIds: this.workspaceIds,
      completedWorkspaceIds: [...this.completedWorkspaceIds],
      errors: this.failedWorkspaces.map((f) => `${f.name}: ${f.error}`),
      instructionsDelivery: { ...this.instructionsDelivery },
      failedWorkspaces: [...this.failedWorkspaces],
      manualWorkspaces: [...this.manualWorkspaces],
      verifiedWorkspaceIds: [...this.verifiedWorkspaceIds],
      createdWorkspaceIds: [...this.createdWorkspaceIds],
      followUps: { ...this.followUps },
      filesDelivered: { ...this.filesDelivered },
      projectMemoryWorkspaceIds: [...this.projectMemoryWorkspaceIds],
      knowledgeLeftovers: { ...this.knowledgeLeftovers },
      ...(this.memoryImported !== null ? { memoryImported: this.memoryImported } : {}),
    };

    try {
      await saveCheckpoint(snapshot, this.currentWorkspaceIndex, 0);
    } catch (err) {
      console.warn("[PortSmith] Could not save checkpoint:", err);
    }
  }

  private resetState(): void {
    this.phase = "idle";
    this.manifestId = null;
    this.manifest = null;
    this.mode = null;
    this.targetPlatform = "claude";
    this.workspaceIds = [];
    this.currentWorkspaceIndex = 0;
    this.completedWorkspaceIds = [];
    this.failedWorkspaces = [];
    this.manualWorkspaces = [];
    this.currentSteps = [];
    this.pendingConfirmStepId = null;
    this.pendingConfirmToken = null;
    this.confirmResolver = null;
    this.guidedInstructions = null;
    this.guidedResolver = null;
    this.memorySteps = [];
    this.instructionsDelivery = {};
    this.verifiedWorkspaceIds = [];
    this.createdWorkspaceIds = [];
    this.followUps = {};
    this.filesDelivered = {};
    this.projectMemoryWorkspaceIds = [];
    this.knowledgeLeftovers = {};
    this.memoryImported = null;
    this.pauseRequested = false;
    this.pauseResolver = null;
    this.migrationTabId = null;
    this.geminiAccount = null;
    this.duplicateTabWarning = null;
  }
}

// ─── Singleton & Message Handlers ────────────────────────────

const orchestrator = new MigrationOrchestrator();

/**
 * Migration control only comes from PortSmith's own pages (the side panel,
 * or the same page opened in a tab). Content scripts report the web page's
 * URL, so they never match.
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    (sender.url ?? "").startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

export function registerOrchestratorHandlers(): void {
  onMessage("MIGRATION_START", async (payload, sender) => {
    if (!fromExtensionPage(sender)) return { success: false };
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

  onMessage("MIGRATION_PAUSE", (_payload, sender) => {
    return { success: fromExtensionPage(sender) && orchestrator.pause() };
  });

  onMessage("MIGRATION_RESUME", async (_payload, sender) => {
    if (!fromExtensionPage(sender)) return { success: false };
    const success = await orchestrator.resume();
    return { success };
  });

  onMessage("MIGRATION_CANCEL", (_payload, sender) => {
    return { success: fromExtensionPage(sender) && orchestrator.cancel() };
  });

  onMessage("MIGRATION_CONFIRM", (payload, sender) => {
    if (!fromExtensionPage(sender)) return { success: false };
    return { success: orchestrator.confirmStep(payload.confirmed, payload.token) };
  });

  onMessage("MIGRATION_WORKSPACE_DONE", (payload, sender) => {
    if (!fromExtensionPage(sender)) return { success: false };
    return {
      success: orchestrator.markWorkspaceDone(payload.workspaceId, payload.skippedStepIds),
    };
  });

  onMessage("MIGRATION_MEMORY_DONE", (payload, sender) => {
    return {
      success: fromExtensionPage(sender) && orchestrator.markMemoryDone(payload?.allDone ?? true),
    };
  });

  onMessage("MIGRATION_UPDATE_DELIVERY", (payload, sender) => {
    if (!fromExtensionPage(sender)) return { success: false };
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
