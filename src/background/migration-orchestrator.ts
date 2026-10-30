import type { PortsmithManifest, Workspace } from "@/core/schema/types";
import type {
  OrchestratorStatus,
  MigrationStep,
  MigrationStepFallback,
  MigrationGuidedInstructions,
  InstructionsDelivery,
  KnowledgeLeftover,
} from "@/shared/messaging";
import { onMessage, safeSendTabMessage, sendTabMessage } from "@/shared/messaging";
import { MAX_MESSAGE_FILE_BYTES, TOO_LARGE_FOR_MESSAGE } from "@/shared/constants";
import { autofillWorkspace } from "@/core/adapters/claude-autofill";
import { generateInstructions } from "@/core/adapters/claude-adapter";
import {
  GEMINI_GEM_MANAGER_URL,
  generateGeminiInstructions,
  geminiGemEditUrl,
} from "@/core/adapters/gemini-guided";
import { generateChatGPTInstructions } from "@/core/adapters/chatgpt-guided";
import { buildMemoryStepsForTarget } from "@/core/adapters/memory-steps";
import { generateGeminiMemoryInstructions } from "@/core/adapters/gemini-guided";
import { buildManualCreateFallback, handOverNote } from "@/core/adapters/manual-fallback";
import {
  hasProjectMemory,
  projectMemoryFileName,
  renderProjectMemoryMarkdown,
} from "@/core/transform/project-memory";
import { textToBase64 } from "@/shared/encoding";
import {
  CHATGPT_INSTRUCTIONS_MAX,
  CHATGPT_PROJECT_NAME_MAX,
  fitInstructions,
  fitProjectName,
} from "@/core/transform/chatgpt-limits";
import {
  SAVED_INFO_MAX_LENGTH,
  savedInfoKey,
  splitSavedInfoText,
} from "@/content-scripts/gemini/saved-info";
import {
  getInstructionsForTarget,
  isPlatformId,
  platformLabel,
  supportedModesForTarget,
  type PlatformId,
} from "@/core/platforms";
import {
  loadSavedMemoryIds,
  saveSavedMemoryIds,
} from "@/core/storage/gemini-saved-memory";
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

/** Why an automatic run left a Claude project for the user. */
function autoDeclineReason(step: MigrationStep): string {
  if (!step.fallback) {
    // The only question without a card: the name is already taken.
    return "A project with this name is already in Claude";
  }
  const first = step.fallback.description.split("\n")[0]?.trim() ?? "";
  return first || "Not created in Claude";
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

const CHATGPT_TABS = "https://chatgpt.com/*";
const CHATGPT_TAB_URL = /^https:\/\/chatgpt\.com\//;
const CHATGPT_HOME_URL = "https://chatgpt.com/";
/** How long a new ChatGPT tab gets to load its content script. */
const CHATGPT_TAB_READY_MS = 15_000;

/** A ChatGPT project's Sources tab. */
export function chatgptSourcesUrl(gizmoId: string): string {
  return `https://chatgpt.com/g/${gizmoId}/project?tab=sources`;
}

/** Decoded size of base64 data, without decoding it. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
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
  /** Cards an automatic run skipped instead of waiting, per workspace */
  private leftoverSteps: Record<string, MigrationStepFallback[]> = {};
  private memoryImported: boolean | null = null;
  /** Memory items saved to the target by PortSmith ("custom-instructions" for those) */
  private savedMemoryIds: string[] = [];
  private memoryAutoSaved: { saved: number; total: number } | null = null;
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
      this.leftoverSteps = { ...(snap.leftoverSteps ?? {}) };
      this.memoryImported = snap.memoryImported ?? null;
      this.savedMemoryIds = [...(snap.savedMemoryIds ?? [])];
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
      leftoverSteps: { ...this.leftoverSteps },
      memoryImported: this.memoryImported,
      memoryAutoSaved: this.memoryAutoSaved,
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

  /**
   * The ChatGPT tab for this run. With none open, one is opened in the
   * background and given time to load PortSmith's content script.
   */
  private async getChatGPTTab(): Promise<number | null> {
    if (this.migrationTabId !== null) {
      try {
        const tab = await chrome.tabs.get(this.migrationTabId);
        if (tab && CHATGPT_TAB_URL.test(tab.url ?? "")) return this.migrationTabId;
      } catch {
        // Tab was closed
      }
      this.migrationTabId = null;
    }

    const open = await this.findTab(CHATGPT_TABS);
    if (open !== null) {
      this.migrationTabId = open;
      return open;
    }

    let tabId: number | null;
    try {
      const tab = await chrome.tabs.create({ url: CHATGPT_HOME_URL, active: false });
      tabId = tab.id ?? null;
    } catch {
      return null;
    }
    if (tabId === null) return null;
    this.migrationTabId = tabId;

    // Poll instead of a fixed sleep: the page is ready when it answers.
    const deadline = Date.now() + CHATGPT_TAB_READY_MS;
    while (Date.now() < deadline) {
      try {
        const reply = await sendTabMessage(tabId, "PING");
        if (reply?.pong) return tabId;
      } catch {
        // Still loading
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    // Requests below inject the script if it never showed up.
    console.warn("[PortSmith] The new ChatGPT tab didn't answer within 15 seconds");
    return tabId;
  }

  private async checkDuplicateTabs(): Promise<string | null> {
    const urlPattern =
      this.targetPlatform === "gemini"
        ? GEMINI_TABS
        : this.targetPlatform === "chatgpt"
          ? CHATGPT_TABS
          : "https://claude.ai/*";

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
            if (this.mode === "guided") {
              await this.processGuidedWorkspace(run, workspace);
            } else {
              await this.processChatGPTAutofillWorkspace(run, workspace);
            }
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
    if (this.targetPlatform === "gemini" && this.mode !== "guided") {
      await this.saveGeminiMemories(run);
      if (!this.isCurrent(run)) return;
    }
    this.phase = this.memorySteps.length > 0 ? "memory" : "complete";
    await this.checkpointState(run);
  }

  /**
   * Save memories and custom instructions to "Your instructions for
   * Gemini". Only what Gemini doesn't accept is left for copy and paste.
   */
  private async saveGeminiMemories(run: number): Promise<void> {
    const manifest = this.manifest;
    if (!manifest) return;
    const custom = manifest.globalInstructions.trim();
    const wanted = [
      ...(custom ? [{ id: "custom-instructions", text: custom }] : []),
      ...manifest.memory.map((m) => ({ id: m.id, text: m.fact.replace(/\s+/g, " ").trim() })),
    ].filter((w) => w.text.length > 0);
    if (wanted.length === 0) return;

    // The same fact can appear more than once in the source: save it once.
    const firstByKey = new Map<string, string>();
    const sameAs = new Map<string, string>();
    for (const w of wanted) {
      const key = savedInfoKey(w.text);
      const first = firstByKey.get(key);
      if (first) sameAs.set(w.id, first);
      else firstByKey.set(key, w.id);
    }

    // What earlier runs already saved to this account (Gemini's own list
    // can't be matched by text, since it rewrites the wording).
    let storedIdCount = 0;
    if (this.manifestId) {
      const stored = await loadSavedMemoryIds(this.manifestId, this.geminiAccount);
      storedIdCount = stored.length;
      for (const id of stored) {
        if (!this.savedMemoryIds.includes(id)) this.savedMemoryIds.push(id);
      }
      if (!this.isCurrent(run)) return;
    }
    const done = new Set(this.savedMemoryIds);
    const stepId = "memory-save";
    const progress = (): void => {
      this.currentSteps = [
        {
          id: stepId,
          title: `Saving your memories to Gemini (${done.size} of ${wanted.length})`,
          status: "running",
        },
      ];
    };
    progress();

    const tabId = wanted.some((w) => !done.has(w.id)) ? await this.getGeminiTab() : null;
    if (!this.isCurrent(run)) return;

    // Gemini's create call takes about 1500 characters, well under what its
    // own editor allows, so anything longer is cut into pieces it will take.
    // Longer than the editor allows still goes to the paste step rather than
    // turning one memory into dozens of entries.
    const partsById = new Map<string, string[]>();
    for (const w of wanted) {
      if (sameAs.has(w.id) || w.text.length > SAVED_INFO_MAX_LENGTH) continue;
      const parts = splitSavedInfoText(w.text);
      if (parts.length > 0) partsById.set(w.id, parts);
    }

    // Skip what's already in Gemini (a repeated run, or added by hand).
    let listedEntries = 0;
    let existingKeys: Set<string> | null = null;
    if (tabId !== null) {
      try {
        const existing = await safeSendTabMessage(tabId, "GEMINI_LIST_MEMORIES");
        if (!this.isCurrent(run)) return;
        if (existing.success && existing.texts) {
          listedEntries = existing.texts.length;
          const keys = new Set(existing.texts.map(savedInfoKey));
          existingKeys = keys;
          // A split memory counts as saved only when every piece is there.
          for (const [id, parts] of partsById) {
            if (parts.every((part) => keys.has(savedInfoKey(part)))) done.add(id);
          }

        } else {
          console.warn(`[PortSmith] Couldn't list Gemini's saved info: ${existing.error ?? "unknown error"}`);
        }
      } catch (err) {
        if (!this.isCurrent(run)) return;
        console.warn(`[PortSmith] Couldn't list Gemini's saved info: ${err instanceof Error ? err.message : String(err)}`);
      }
      progress();
    }

    const todo: Array<{ id: string; text: string }> = [];
    for (const [id, parts] of partsById) {
      if (done.has(id)) continue;
      for (const text of parts) {
        if (existingKeys?.has(savedInfoKey(text))) continue;
        todo.push({ id, text });
      }
    }
    // A memory is saved once every piece of it is.
    const partsLeft = new Map<string, number>();
    for (const item of todo) partsLeft.set(item.id, (partsLeft.get(item.id) ?? 0) + 1);
    const failedIds = new Set<string>();

    console.log(
      `[PortSmith] Gemini memories: ${listedEntries} entries in Gemini's list, ` +
        `${storedIdCount} recorded by earlier runs, ` +
        `${partsLeft.size} to send as ${todo.length} entr${todo.length === 1 ? "y" : "ies"}.`,
    );
    const markCopies = (): void => {
      for (const [id, first] of sameAs) if (done.has(first)) done.add(id);
    };

    const reasons = new Map<string, number>();
    // Small batches so the count on screen moves every few seconds rather
    // than once per 30 saves (a run of 234 takes about 13 minutes).
    const CHUNK = 5;
    for (let i = 0; tabId !== null && i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      try {
        const { results } = await safeSendTabMessage(tabId, "GEMINI_SAVE_MEMORIES", {
          texts: chunk.map((c) => c.text),
        });
        if (!this.isCurrent(run)) return;
        results.forEach((r, j) => {
          const item = chunk[j];
          if (!item) return;
          if (r.success) {
            partsLeft.set(item.id, (partsLeft.get(item.id) ?? 1) - 1);
          } else {
            failedIds.add(item.id);
            const reason = r.error ?? "no reason given";
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
            console.warn(`[PortSmith] Memory not saved (${reason}): ${item.text.slice(0, 80)}`);
          }
        });
        for (const item of chunk) {
          if (!failedIds.has(item.id) && (partsLeft.get(item.id) ?? 1) <= 0) done.add(item.id);
        }
      } catch (err) {
        if (!this.isCurrent(run)) return;
        console.warn(`[PortSmith] Saving memories failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      markCopies();
      this.savedMemoryIds = [...done];
      if (this.manifestId) {
        await saveSavedMemoryIds(this.manifestId, this.geminiAccount, this.savedMemoryIds);
      }
      progress();
      await this.checkpointState(run);
      if (!this.isCurrent(run)) return;
    }

    markCopies();
    const saved = wanted.filter((w) => done.has(w.id)).length;
    const topReasons = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => `${count}× ${reason}`);
    this.memoryAutoSaved = {
      saved,
      total: wanted.length,
      ...(topReasons.length > 0 ? { reasons: topReasons } : {}),
    };
    this.currentSteps = [
      {
        id: stepId,
        title:
          saved === wanted.length
            ? `Saved ${saved} memor${saved === 1 ? "y" : "ies"} to Gemini`
            : `Saved ${saved} of ${wanted.length} memories to Gemini`,
        status: saved === wanted.length ? "success" : "fallback",
      },
    ];

    // Only the leftovers go to the copy-and-paste steps.
    const leftItems = manifest.memory.filter((m) => !done.has(m.id));
    const leftCustom = custom && !done.has("custom-instructions") ? custom : "";
    this.memorySteps = generateGeminiMemoryInstructions(
      leftItems,
      this.sourceLabel(),
      leftCustom,
      manifest.source.platform,
      topReasons,
    );
    if (this.manifestId) {
      await saveSavedMemoryIds(this.manifestId, this.geminiAccount, [...done]);
    }
    if (saved === wanted.length) this.memoryImported = true;
    else await this.openLeftoverPage("https://gemini.google.com", "/saved-info");
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
    let declinedCreate: string | null = null;

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

        if (this.mode === "autofill" && step.status === "navigate_failed") {
          // Automatic runs retry on their own (the adapter caps attempts).
          nextInput = true;
          continue;
        }
        if (this.mode === "autofill" && step.status === "pending") {
          // Automatic runs never wait: leave it for the results page.
          if (step.id === `${workspace.id}-create-api`) {
            declinedCreate = autoDeclineReason(step);
          } else if (step.fallback) {
            this.addLeftoverStep(workspace.id, step.fallback);
          }
          nextInput = false;
          continue;
        }

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
        declinedCreate ?? (skipped
          ? (createStep?.title.startsWith("Skipped:")
              ? createStep.title.slice("Skipped:".length).trim().replace(/^./, (c) => c.toUpperCase())
              : "Skipped")
          : "Not created in Claude"),
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
      if (file.sizeBytes > MAX_MESSAGE_FILE_BYTES) {
        failures.push(`${file.originalName}: ${TOO_LARGE_FOR_MESSAGE}`);
        continue;
      }
      const record = await loadFile(file.contentRef!).catch(() => undefined);
      if (!this.isCurrent(run)) return;
      if (!record?.blob) {
        failures.push(`${file.originalName}: the copied file is missing`);
        continue;
      }
      if (base64Bytes(record.blob) > MAX_MESSAGE_FILE_BYTES) {
        failures.push(`${file.originalName}: ${TOO_LARGE_FOR_MESSAGE}`);
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

  // ─── ChatGPT Target ─────────────────────────────────────

  private async processChatGPTAutofillWorkspace(
    run: number,
    workspace: Workspace,
  ): Promise<void> {
    this.currentSteps = [];
    const stepId = `${workspace.id}-create`;
    const source = this.sourceLabel();
    const original = getInstructionsForTarget(workspace, "chatgpt");
    this.instructionsDelivery[workspace.id] = original.trim() ? "pending" : "none";
    // ChatGPT refuses the whole create when either is too long.
    const { name, trimmed } = fitProjectName(workspace.name);
    const { instructions, overflow } = fitInstructions(original, source);

    if (this.mode === "hybrid") {
      this.updateStep({
        id: stepId,
        title: `Create the project "${name}"?`,
        status: "pending",
        confirmLabel: "Create project",
        skipLabel: "Skip",
      });
      const go = await this.waitForConfirmation(stepId);
      if (!this.isCurrent(run)) return;
      if (!go) {
        this.updateStep({ id: stepId, title: `Skipped "${name}"`, status: "skipped" });
        this.addManualWorkspace(workspace, "Skipped");
        return;
      }
    }

    this.updateStep({
      id: stepId,
      title: `Checking your projects for "${name}"`,
      status: "running",
    });

    const tabId = await this.getChatGPTTab();
    if (!this.isCurrent(run)) return;

    // Don't create a second project with the same name without asking.
    const before = tabId === null ? null : await this.findChatGPTProjectsNamed(tabId, name);
    if (!this.isCurrent(run)) return;
    if (before && before.length > 0 && this.mode !== "hybrid") {
      // Automatic runs never stop to ask: leave it for the results page.
      this.updateStep({
        id: stepId,
        title: `Skipped "${name}": a project with this name is already in ChatGPT`,
        status: "skipped",
      });
      this.addManualWorkspace(workspace, "A project with this name is already in ChatGPT");
      return;
    }
    if (before && before.length > 0) {
      this.updateStep({
        id: stepId,
        title: `A project named "${name}" is already in ChatGPT. Create another one?`,
        status: "pending",
        confirmLabel: "Create another",
        skipLabel: "Skip this one",
      });
      const again = await this.waitForConfirmation(stepId);
      if (!this.isCurrent(run)) return;
      if (!again) {
        this.updateStep({ id: stepId, title: `Skipped "${name}"`, status: "skipped" });
        this.addManualWorkspace(workspace, "A project with this name is already in ChatGPT");
        return;
      }
    }

    this.updateStep({
      id: stepId,
      title: `Creating project "${name}"`,
      status: "running",
    });

    let error = "";
    let gizmoId: string | undefined;
    let mismatch = false;
    if (tabId === null) {
      error = "Couldn't open a ChatGPT tab";
    } else {
      try {
        const result = await safeSendTabMessage(tabId, "CHATGPT_CREATE_PROJECT", {
          name,
          instructions,
        });
        if (result.success) {
          gizmoId = result.gizmoId;
        } else if (result.instructionsMismatch && result.gizmoId) {
          // The project exists; only its instructions need a look.
          gizmoId = result.gizmoId;
          mismatch = true;
        } else {
          error = result.error ?? "Unknown error";
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (error && before !== null) {
        // The request may have gone through even though it reported a
        // problem. Only a project that wasn't there a moment ago can be ours.
        const after = await this.findChatGPTProjectsNamed(tabId, name);
        const known = new Set(before);
        const fresh = after?.filter((id) => !known.has(id)) ?? [];
        if (fresh.length === 1) {
          console.warn(`[PortSmith] Project create reported "${error}", but the project exists`);
          gizmoId = fresh[0];
          error = "";
        }
      }
    }
    if (!this.isCurrent(run)) return;

    if (!error) {
      this.updateStep({
        id: stepId,
        title: `Created project "${name}"`,
        status: "success",
        projectCreated: true,
      });
      if (original.trim()) {
        this.instructionsDelivery[workspace.id] = mismatch ? "manual" : "autofilled";
      }
      if (gizmoId) console.log(`[PortSmith] Created ChatGPT project ${gizmoId}`);
      await this.markCreated(run, workspace.id);
      if (!this.isCurrent(run)) return;

      if (trimmed) {
        this.addFollowUp(
          workspace.id,
          `ChatGPT allows ${CHATGPT_PROJECT_NAME_MAX} characters in a project name, so "${workspace.name.trim()}" was created as "${name}"`,
        );
      }
      if (mismatch) {
        this.addFollowUp(
          workspace.id,
          "ChatGPT saved different instructions than PortSmith sent: open the project's settings and check them",
        );
      }
      if (workspace.description.trim()) {
        this.addFollowUp(
          workspace.id,
          "ChatGPT projects have no description field, so the description wasn't added. It's on a card below if you want to keep it",
        );
        this.addLeftoverStep(workspace.id, {
          id: `${workspace.id}-description`,
          title: "Keep the description (optional)",
          description:
            'ChatGPT projects have no description field. If it matters, open the project\'s menu (three dots), choose "Project settings" and add it to the top of the instructions.',
          copyBlocks: [{ label: "Description", content: workspace.description.trim() }],
          link: gizmoId ? `https://chatgpt.com/g/${gizmoId}/project` : CHATGPT_HOME_URL,
        });
      }

      await this.addChatGPTSources(run, tabId, gizmoId, workspace, overflow, source);
      // Only now: a restart during the uploads lists it as unfinished.
      if (this.isCurrent(run)) this.completedWorkspaceIds.push(workspace.id);
      return;
    }

    if (this.mode !== "hybrid") {
      // Automatic runs keep going; the results page has the manual route.
      const unsure = before === null;
      this.updateStep({
        id: stepId,
        title: `Couldn't create "${name}". It's listed at the end`,
        status: "failed",
      });
      this.addManualWorkspace(
        workspace,
        unsure
          ? `ChatGPT didn't confirm the new project (${error}). Check your projects before creating it by hand`
          : `Not created in ChatGPT (${error})`,
      );
      return;
    }

    // API failed: offer the manual route and wait for the user.
    this.updateStep({
      id: stepId,
      title: `Couldn't create "${name}" automatically`,
      status: "pending",
      fallback: buildManualCreateFallback(
        workspace,
        "chatgpt",
        source,
        `ChatGPT didn't confirm the new project (${error}). Check your projects first. If "${name}" isn't there, create it by hand:`,
      ),
      confirmLabel: "It's in ChatGPT now",
      skipLabel: "Skip this one",
    });
    const done = await this.waitForConfirmation(stepId);
    if (!this.isCurrent(run)) return;
    if (done) {
      this.updateStep({ id: stepId, title: `Created "${name}" by hand`, status: "success", projectCreated: true });
      if (original.trim()) this.instructionsDelivery[workspace.id] = "manual";
      const note = handOverNote(
        workspace,
        original,
        hasProjectMemory(workspace) ? "memory" : "",
      );
      this.followUps[workspace.id] = [note];
      this.completedWorkspaceIds.push(workspace.id);
      await this.markCreated(run, workspace.id);
    } else {
      this.updateStep({ id: stepId, title: `"${name}" not created`, status: "skipped" });
      this.addManualWorkspace(workspace, `Not created in ChatGPT (${error})`);
    }
  }

  /**
   * Add the overflow instructions file, the project memory document and
   * the copied files to the project's Sources, one upload each (uploads
   * append, so nothing needs saving afterwards). Never waits for the user:
   * whatever doesn't make it is listed on the results page.
   */
  private async addChatGPTSources(
    run: number,
    tabId: number | null,
    gizmoId: string | undefined,
    workspace: Workspace,
    overflow: { fileName: string; content: string } | null,
    source: string,
  ): Promise<void> {
    const copied = workspace.knowledgeFiles.filter((f) => f.contentRef);
    const withMemory = hasProjectMemory(workspace);
    const total = copied.length + (withMemory ? 1 : 0) + (overflow ? 1 : 0);
    if (total === 0) return;

    const stepId = `${workspace.id}-sources`;
    const link = gizmoId ? chatgptSourcesUrl(gizmoId) : CHATGPT_HOME_URL;
    const shortened = `ChatGPT allows ${CHATGPT_INSTRUCTIONS_MAX} characters of instructions, so they were shortened at a paragraph break`;
    const leftover = (
      fileNames: string[],
      memory: boolean,
      instructionsFile: boolean,
      why: string,
    ): void => {
      if (fileNames.length === 0 && !memory && !instructionsFile) return;
      this.knowledgeLeftovers[workspace.id] = {
        link,
        fileNames,
        projectMemory: memory,
        ...(instructionsFile && overflow ? { instructionsFile: overflow.fileName } : {}),
      };
      const what = [
        ...(instructionsFile && overflow ? [overflow.fileName] : []),
        ...(fileNames.length > 0
          ? [`${fileNames.length} file${fileNames.length === 1 ? "" : "s"}`]
          : []),
        ...(memory ? ["the project memory document"] : []),
      ].join(" and ");
      this.addFollowUp(workspace.id, `Add ${what} to the project's Sources by hand (${why})`);
    };

    if (tabId === null || !gizmoId) {
      this.updateStep({
        id: stepId,
        title: "Sources left for the end",
        status: "skipped",
      });
      if (overflow) {
        this.addFollowUp(
          workspace.id,
          `${shortened}. The full instructions did not reach the project: add ${overflow.fileName} from the results page`,
        );
      }
      leftover(
        copied.map((f) => f.originalName),
        withMemory,
        overflow !== null,
        "PortSmith didn't get the new project's ID",
      );
      return;
    }

    this.updateStep({
      id: stepId,
      title: `Adding ${total} file${total === 1 ? "" : "s"} to the project's Sources`,
      status: "running",
    });

    const failures: string[] = [];
    const upload = async (fileName: string, mimeType: string, base64: string): Promise<boolean> => {
      try {
        const result = await safeSendTabMessage(tabId, "CHATGPT_UPLOAD_PROJECT_FILE", {
          gizmoId,
          fileName,
          mimeType,
          base64,
        });
        if (result.success) return true;
        failures.push(`${fileName}: ${result.error ?? "upload failed"}`);
      } catch (err) {
        failures.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    };

    let overflowAdded = false;
    if (overflow) {
      overflowAdded = await upload(overflow.fileName, "text/markdown", textToBase64(overflow.content));
      if (!this.isCurrent(run)) return;
      this.addFollowUp(
        workspace.id,
        overflowAdded
          ? `${shortened}. The full text is in the project file ${overflow.fileName}`
          : `${shortened}. The full instructions did not reach the project: add ${overflow.fileName} from the results page`,
      );
    }

    let memoryAdded = false;
    if (withMemory) {
      const doc = renderProjectMemoryMarkdown(workspace, source);
      memoryAdded = await upload(projectMemoryFileName(source), "text/markdown", textToBase64(doc));
      if (!this.isCurrent(run)) return;
    }

    const addedFiles: string[] = [];
    for (const file of copied) {
      if (file.sizeBytes > MAX_MESSAGE_FILE_BYTES) {
        failures.push(`${file.originalName}: ${TOO_LARGE_FOR_MESSAGE}`);
        continue;
      }
      const record = await loadFile(file.contentRef!).catch(() => undefined);
      if (!this.isCurrent(run)) return;
      if (!record?.blob) {
        failures.push(`${file.originalName}: the copied file is missing`);
        continue;
      }
      if (base64Bytes(record.blob) > MAX_MESSAGE_FILE_BYTES) {
        failures.push(`${file.originalName}: ${TOO_LARGE_FOR_MESSAGE}`);
        continue;
      }
      if (await upload(file.originalName, file.mimeType || record.mimeType, record.blob)) {
        addedFiles.push(file.originalName);
      }
      if (!this.isCurrent(run)) return;
    }

    if (addedFiles.length > 0) this.filesDelivered[workspace.id] = addedFiles.length;
    if (memoryAdded && !this.projectMemoryWorkspaceIds.includes(workspace.id)) {
      this.projectMemoryWorkspaceIds.push(workspace.id);
    }
    const added = addedFiles.length + (memoryAdded ? 1 : 0) + (overflowAdded ? 1 : 0);

    if (added === total) {
      this.updateStep({
        id: stepId,
        title: `Added ${total} file${total === 1 ? "" : "s"} to the project's Sources`,
        status: "success",
        filesDelivered: addedFiles.length,
      });
      return;
    }

    if (failures.length > 0) {
      console.warn(`[PortSmith] Sources for "${workspace.name}": ${failures.join("; ")}`);
    }
    this.updateStep({
      id: stepId,
      title: `Added ${added} of ${total} files to the project's Sources. The rest are listed at the end`,
      status: "fallback",
      filesDelivered: addedFiles.length,
    });
    leftover(
      copied.map((f) => f.originalName).filter((n) => !addedFiles.includes(n)),
      withMemory && !memoryAdded,
      overflow !== null && !overflowAdded,
      failures[0] ?? "ChatGPT didn't accept them",
    );
  }

  /** IDs of the user's ChatGPT projects with this name, or null if they can't be listed. */
  private async findChatGPTProjectsNamed(tabId: number, name: string): Promise<string[] | null> {
    try {
      const result = await safeSendTabMessage(tabId, "CHATGPT_FIND_PROJECTS", { name });
      return result.success ? (result.gizmoIds ?? []) : null;
    } catch {
      return null;
    }
  }

  /**
   * Open the page a leftover step needs, so the user lands on it instead of
   * following written directions.
   */
  private async openLeftoverPage(origin: string, path: string): Promise<void> {
    const account = this.geminiAccount && this.geminiAccount !== "/u/0/" ? this.geminiAccount.slice(0, -1) : "";
    try {
      await chrome.tabs.create({ url: `${origin}${account}${path}`, active: true });
    } catch {
      // The step still carries the link.
    }
  }

  private addLeftoverStep(workspaceId: string, card: MigrationStepFallback): void {
    const cards = (this.leftoverSteps[workspaceId] ?? []).filter((c) => c.id !== card.id);
    this.leftoverSteps[workspaceId] = [...cards, card];
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
      leftoverSteps: { ...this.leftoverSteps },
      ...(this.memoryImported !== null ? { memoryImported: this.memoryImported } : {}),
      ...(this.savedMemoryIds.length > 0 ? { savedMemoryIds: [...this.savedMemoryIds] } : {}),
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
    this.leftoverSteps = {};
    this.savedMemoryIds = [];
    this.memoryAutoSaved = null;
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
