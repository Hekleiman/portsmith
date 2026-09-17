# PortSmith Codebase Audit
Generated: 2026-03-16
Version: 0.1.1 (from package.json)
Total test count: 285 tests passed across 9 test files

## Summary Stats
- Total files audited: 22 (19 exist + 3 noted as non-existent)
- Total lines of code: 5,935 (sum of all audited files that exist)
- Files that don't exist:
  - `src/core/transform/file-converter.ts` — DOES NOT EXIST
  - `src/shared/utils.ts` — DOES NOT EXIST
  - `src/sidepanel/hooks/useMigration.ts` — DOES NOT EXIST

---

## Group 1: Guided Mode & Step UI

### src/core/adapters/claude-adapter.ts
- **Lines**: 172
- **Exports**:
  - `interface CopyBlockData { label: string; content: string; }` (line 5-8)
  - `interface ImportStep { id: string; title: string; description: string; copyBlocks: CopyBlockData[]; fileNames?: string[]; link?: string; }` (line 10-17)
  - `interface ImportInstructions { workspaceId: string; workspaceName: string; steps: ImportStep[]; }` (line 19-23)
  - `function generateInstructions(workspace: Workspace): ImportInstructions` (line 34-136)
  - `function generateMemoryInstructions(items: MemoryItem[]): ImportStep[]` (line 139-171)
- **Key functions**:
  - `generateInstructions(workspace: Workspace): ImportInstructions` (line 34-136)
    - Two-phase step generation: Phase 1 (creation modal) + Phase 2 (project dashboard)
    - Phase 1 steps: navigate → create → name → description → save
    - Phase 2 steps: open-instructions → instructions → save-instructions → files (if any) → verify
    - Step generation logic (line 44-135):
    ```typescript
    const steps: ImportStep[] = [
      // ── Phase 1: Creation modal ─────────────────────────
      {
        id: `${workspace.id}-navigate`,
        title: "Go to Claude Projects",
        description: "Open the Claude Projects page in your browser.",
        copyBlocks: [],
        link: "https://claude.ai/projects",
      },
      {
        id: `${workspace.id}-create`,
        title: "Create a new project",
        description:
          'On the Projects page, click the "Create a project" button (or the + icon) to open the creation modal.',
        copyBlocks: [],
      },
      {
        id: `${workspace.id}-name`,
        title: "Enter the project name",
        description:
          "On the project creation screen, paste the project name into the Name field.",
        copyBlocks: [{ label: "Project name", content: workspace.name }],
      },
      {
        id: `${workspace.id}-description`,
        title: "Enter the description",
        description:
          "On the project creation screen, paste the description into the Description field.",
        copyBlocks: [{ label: "Description", content: description }],
      },
      {
        id: `${workspace.id}-save`,
        title: 'Click "Create project"',
        description:
          'Click the "Create project" button. After creation, you\'ll be taken to the project dashboard — this is a different page where you\'ll add instructions.',
        copyBlocks: [],
      },
    ];
    ```
  - `generateMemoryInstructions(items: MemoryItem[]): ImportStep[]` (line 139-171)
    - Generates navigate-to-settings step + one step per memory item, sorted by priority descending
    - Uses `item.migration.truncatedVersion ?? item.fact` for content
- **Imports from project**: `@/core/schema/types` (Workspace, MemoryItem)
- **Notes**: The step IDs use `${workspace.id}-<suffix>` pattern, which is important for matching autofill steps to guided fallbacks. Phase 1 ends at guided index 4, Phase 2 starts at index 5.

---

### src/sidepanel/components/GuidedMigration.tsx
- **Lines**: 263
- **Props interface**: No props — default export function component with no arguments
- **State**:
  - `useState<PortsmithManifest | null>(null)` — manifest
  - `useState(true)` — loading
  - `useState<Set<string>>(new Set())` — completedIds
  - `useState(0)` — currentIdx
  - Zustand selectors: `manifestId`, `selectedWorkspaceIds`, `goToStep`
- **Renders**:
  - Progress header with done/total count and percentage bar
  - Current section label (workspace name or "Memory")
  - Single `StepCard` for the current step
  - Navigation: Back / Next Step / Complete Migration buttons
- **Step navigation logic** (line 139-145):
  ```typescript
  const goNext = useCallback(() => {
    setCurrentIdx((i) => Math.min(i + 1, allSteps.length - 1));
  }, [allSteps.length]);

  const goPrev = useCallback(() => {
    setCurrentIdx((i) => Math.max(i - 1, 0));
  }, []);
  ```
- **Section building** (line 88-113): Uses `useMemo` to build `StepSection[]` — iterates selected workspaces calling `generateInstructions()`, then appends memory section
- **Persistence**: Saves completed step IDs to `chrome.storage.local` under key `portsmith_guided_progress`
- **Imports from project**: `@/core/schema/types`, `@/core/adapters/claude-adapter`, `@/core/storage/indexed-db`, `../store/migration-store`, `./StepCard`
- **Notes**: This component is used in the OLD flow (pre-orchestrator). The Migrate.tsx page now handles guided mode through the orchestrator. This component may be dead code or used only when deliveryMode is "guided" via AutofillMigration.tsx's path. Actually, looking at App.tsx, the `migrating` phase maps to `Migrate.tsx`, not this component. GuidedMigration is not directly referenced in App.tsx.

---

### src/sidepanel/components/StepCard.tsx
- **Lines**: 101
- **Props interface** (line 4-9):
  ```typescript
  export interface StepCardProps {
    step: ImportStep;
    stepNumber: number;
    done: boolean;
    onToggleDone: () => void;
  }
  ```
- **State**: None (stateless)
- **Renders**:
  - Card with step number badge (green check when done, blue number when pending)
  - Title + description
  - Optional link (opens in new tab)
  - CopyBlock components for each `step.copyBlocks`
  - File list with file icons for `step.fileNames`
  - "Mark as done" checkbox
- **Imports from project**: `@/core/adapters/claude-adapter` (ImportStep), `./CopyBlock`

---

### src/sidepanel/components/CopyBlock.tsx
- **Lines**: 69
- **Props interface** (line 3-6):
  ```typescript
  export interface CopyBlockProps {
    label: string;
    content: string;
  }
  ```
- **State**:
  - `useState(false)` — copied
  - `useState(false)` — expanded
- **Renders**:
  - Collapsible preview with "Preview {label}" / "Hide {label}" toggle
  - Character count display
  - Copy button with clipboard API + fallback via `document.execCommand("copy")`
  - When expanded: `<pre>` with the full content, max-h 200px, scrollable
- **Copy handler** (line 15-33): Uses `navigator.clipboard.writeText()` with fallback to textarea + `execCommand("copy")`
- **Imports from project**: None (React only)

---

### src/sidepanel/components/AutofillMigration.tsx
- **Lines**: 475
- **Props interface**: No props — default export function component
- **State**:
  - `useState<PortsmithManifest | null>(null)` — manifest
  - `useState(true)` — loading
  - `useState(0)` — currentWsIdx (current workspace index)
  - `useState<AutofillStepResult[]>([])` — steps
  - `useState<"idle" | "running" | "paused" | "memory" | "done">("idle")` — phase
  - `useState<string | null>(null)` — pendingConfirm
  - `useRef<((confirmed: boolean) => void) | null>(null)` — confirmResolverRef
  - `useState<Set<string>>(new Set())` — memoryCompletedIds
  - `useState(0)` — memoryStepIdx
  - Zustand selectors: `manifestId`, `selectedWorkspaceIds`, `deliveryMode`, `goToStep`
- **Renders**:
  - Phases: idle (start button), running (step list with StepRow), paused (hybrid confirm), memory (StepCard for memory), done (completion screen)
  - `StepRow` internal component (line 18-55): renders icon + title for each autofill step status
  - `findClaudeTab()` (line 124-140): queries `chrome.tabs` for active Claude tab, falls back to any Claude tab
- **Key logic — runWorkspace** (line 143-201): Calls `autofillWorkspace()` generator, iterates results, handles hybrid pending/confirm flow via Promise + ref pattern
- **Imports from project**: `@/core/schema/types`, `@/core/adapters/claude-autofill`, `@/core/adapters/claude-adapter`, `@/core/storage/indexed-db`, `../store/migration-store`, `./StepCard`, `@/shared/messaging`
- **Notes**: This is also part of the OLD flow. The Migrate.tsx page now handles autofill via the orchestrator. This component calls `autofillWorkspace()` directly from the side panel rather than going through the service worker. It has its own tab finding logic separate from the orchestrator.

---

### src/sidepanel/pages/Migrate.tsx
- **Lines**: 811
- **Props interface**: No props — default export function component
- **State**:
  - `useState(0)` — guidedStepIdx
  - `useState<Set<string>>(new Set())` — guidedCompletedIds
  - `useState(0)` — memoryStepIdx
  - `useState<Set<string>>(new Set())` — memoryCompletedIds
  - `useRef(false)` — startedRef (prevents double-init)
  - `useRef<number | undefined>(undefined)` — prevWsIdx (tracks workspace changes)
  - Zustand selectors: `manifestId`, `selectedWorkspaceIds`, `deliveryMode`, `goToStep`
- **Key hook — useOrchestratorStatus** (line 13-37): Polls `MIGRATION_STATUS` message every 500ms
- **Renders**: Multiple phase/mode-specific UIs:
  - Loading/idle: "Starting migration..."
  - Complete phase: success screen with clipboard/pending instructions handling
  - Memory phase: guided steps for memory items
  - Paused: resume/cancel controls
  - Running/guided: StepCard with back/next/workspace-done navigation
  - Running/autofill+hybrid: step list with StepRow, fallback cards, clipboard notifications, navigate_failed prompts, field status indicators, pause/cancel controls
- **Init logic** (line 144-176): On mount, checks orchestrator status, tries resume, then starts fresh via `MIGRATION_START` message
- **Actions** (line 194-248):
  - `handlePause()` → `MIGRATION_PAUSE`
  - `handleResume()` → `MIGRATION_RESUME`
  - `handleCancel()` → `MIGRATION_CANCEL` then `goToStep("mode_selection")`
  - `handleConfirm(confirmed)` → `MIGRATION_CONFIRM`
  - `handleGuidedWorkspaceDone(workspaceId)` → `MIGRATION_WORKSPACE_DONE`
  - `handleMemoryDone()` → `MIGRATION_MEMORY_DONE`
  - `handleConfirmDelivery(workspaceId)` → `MIGRATION_UPDATE_DELIVERY` with delivery "manual"
- **Imports from project**: `@/shared/messaging`, `../store/migration-store`, `../components/StepCard`, `../components/CopyBlock`
- **Notes**: This is the ACTIVE migration page used in production. Communicates with the orchestrator via messages. Contains a `StepRow` component duplicated from AutofillMigration.tsx (line 40-83). Has detailed clipboard/instructions delivery tracking UI.

---

### src/sidepanel/pages/ModeSelect.tsx
- **Lines**: 128
- **Props interface**: No props — default export function component
- **State**: Zustand selectors: `deliveryMode`, `setDeliveryMode`
- **Renders**:
  - Title "How should we import?" + subtitle
  - 3 ModeCard components: autofill, guided, hybrid
  - Each mode card shows: title, description, badge, icon, pros/cons
  - Hybrid is pre-selected as default via `useEffect` (line 95-99)
- **Mode definitions** (line 6-88): Array of objects with id, title, description, badge, pros, cons, icon
- **Imports from project**: `@/core/storage/migration-state` (DeliveryMode), `../components/ModeCard`, `../store/migration-store`

---

## Group 2: Tab Management & Autofill

### src/background/migration-orchestrator.ts
- **Lines**: 519
- **Exports**:
  - `function registerOrchestratorHandlers(): void` (line 470-517)
  - `orchestrator` (line 519) — singleton instance of MigrationOrchestrator
- **Class: MigrationOrchestrator** (line 25-464)
  - **Public methods**:
    - `async start(manifestId: string, mode: DeliveryMode, workspaceIds: string[]): Promise<boolean>` (line 53-73)
    - `pause(): boolean` (line 75-79)
    - `async resume(): Promise<boolean>` (line 81-116)
    - `cancel(): boolean` (line 118-126)
    - `getStatus(): OrchestratorStatus` (line 128-174)
    - `confirmStep(confirmed: boolean): boolean` (line 176-182)
    - `markWorkspaceDone(workspaceId: string): boolean` (line 184-191)
    - `markMemoryDone(): boolean` (line 193-197)
    - `updateDelivery(workspaceId: string, delivery: InstructionsDelivery): boolean` (line 199-206)
  - **Private methods**:
    - `getCurrentWorkspace(): Workspace | null` (line 210-215)
    - `findClaudeTab(): Promise<number | null>` (line 217-232)
    - `getTabForAutofill(): Promise<number | null>` (line 238-253)
    - `processWorkspaces(): Promise<void>` (line 255-297)
    - `processGuidedWorkspace(workspace: Workspace): Promise<void>` (line 299-310)
    - `processAutofillWorkspace(workspace: Workspace): Promise<void>` (line 312-415)
    - `updateStep(step: MigrationStep): void` (line 417-424)
    - `checkpointState(): Promise<void>` (line 426-443)
    - `resetState(): void` (line 445-463)
- **Key functions**:
  - `getTabForAutofill()` (line 238-253):
    ```typescript
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
    ```
  - `findClaudeTab()` (line 217-232):
    ```typescript
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
    ```
  - `processAutofillWorkspace(workspace)` (line 312-415): Gets tab via `getTabForAutofill()`, initializes instructions delivery tracking, runs `autofillWorkspace()` generator, handles hybrid confirm and navigate_failed pauses, tracks success/failure
  - `processWorkspaces()` (line 255-297): Loop over all workspace IDs, handles pause between workspaces, delegates to guided or autofill, checkpoints after each workspace, transitions to "memory" or "complete" phase at end
- **Tab ID storage**: Tab ID is fetched fresh for each workspace via `getTabForAutofill()`. It is NOT stored — re-queried every time. This means if the user closes the Claude tab between workspaces, it will try the active tab.
- **State machine transitions**:
  - `idle` → `running` (via `start()`)
  - `running` → `paused` (via `pause()` / `pauseRequested`)
  - `paused` → `running` (via `resume()`)
  - `running` → `memory` (when all workspaces done and memory exists)
  - `running` → `complete` (when all workspaces done and no memory)
  - `memory` → `complete` (via `markMemoryDone()`)
  - Any → `idle` (via `cancel()`)
- **Message handlers registered** (line 470-517):
  - `MIGRATION_START` → `orchestrator.start()`
  - `MIGRATION_STATUS` → `orchestrator.getStatus()`
  - `MIGRATION_PAUSE` → `orchestrator.pause()`
  - `MIGRATION_RESUME` → `orchestrator.resume()`
  - `MIGRATION_CANCEL` → `orchestrator.cancel()`
  - `MIGRATION_CONFIRM` → `orchestrator.confirmStep()`
  - `MIGRATION_WORKSPACE_DONE` → `orchestrator.markWorkspaceDone()`
  - `MIGRATION_MEMORY_DONE` → `orchestrator.markMemoryDone()`
  - `MIGRATION_UPDATE_DELIVERY` → `orchestrator.updateDelivery()`
- **Imports from project**: `@/core/schema/types`, `@/shared/messaging`, `@/core/adapters/claude-autofill`, `@/core/adapters/claude-adapter`, `@/core/storage/indexed-db`

---

### src/core/adapters/claude-autofill.ts
- **Lines**: 533
- **Exports**:
  - `interface AutofillStepResult { id: string; title: string; status: AutofillStepStatus; fallback?: ImportStep; instructionsDelivery?: InstructionsDelivery; }` (line 13-21)
  - `async function* autofillWorkspace(workspace: Workspace, tabId: number, options: { hybrid?: boolean }): AsyncGenerator<AutofillStepResult, void, boolean | undefined>` (line 256-533)
- **Key internal types**:
  - `AutofillStepDef` (line 128-143): `{ id, title, action, target?, value?, guidedIndex, phase }`
  - `action` type: `"click" | "fill" | "clear_and_fill" | "navigate" | "manual" | "wait_for_navigation" | "fill_instructions"`
- **Key internal functions**:
  - `delay(ms: number): Promise<void>` (line 25-27)
  - `executeOnTab(tabId, action, target, value?): Promise<boolean>` (line 29-45): Sends `AUTOFILL_EXECUTE` tab message
  - `clipboardWrite(tabId, text): Promise<boolean>` (line 47-59): Sends `CLIPBOARD_WRITE` tab message
  - `navigateAndWaitForLoad(tabId, url, timeoutMs?): Promise<boolean>` (line 65-102): Uses `chrome.tabs.update()` + `onUpdated` listener
  - `waitForContentScript(tabId, maxRetries?): Promise<boolean>` (line 108-124): PING loop, first attempt uses `safeSendTabMessage` for auto-injection
  - `buildPhase1Defs(workspace: Workspace): AutofillStepDef[]` (line 149-206)
  - `buildPhase2Defs(workspace: Workspace): AutofillStepDef[]` (line 212-243)
- **buildPhase1Defs step sequence** (line 156-206):
  1. `{id}-navigate` — action: "navigate", guidedIndex: 0
  2. `{id}-create` — action: "click", target: "projects.createButton", guidedIndex: 1
  3. `{id}-name` — action: "clear_and_fill", target: "form.nameInput", guidedIndex: 2
  4. `{id}-description` — action: "clear_and_fill", target: "form.descriptionInput", guidedIndex: 3
  5. `{id}-save` — action: "click", target: "form.saveButton", guidedIndex: 4
  6. `{id}-wait-nav` — action: "wait_for_navigation", guidedIndex: -1
- **buildPhase2Defs step sequence** (line 212-243):
  7. `{id}-instructions` — action: "fill_instructions", guidedIndex: 5 (only if instructions non-empty)
  8. `{id}-files` — action: "manual", guidedIndex: 6 (only if compatible files exist)
- **Generator flow** (line 256-533):
  - Iterates over all defs (phase1 + phase2)
  - For hybrid: yields "pending" then waits for boolean input (confirmed/skipped)
  - Navigate: multi-attempt with navigate_failed yields, content script wait, tab activation
  - wait_for_navigation: sends `WAIT_FOR_NAVIGATION` message, falls back to clipboard on timeout
  - fill_instructions: sends `FILL_PROJECT_INSTRUCTIONS`, falls back to clipboard then guided fallback
  - DOM actions (click/fill): sends `AUTOFILL_EXECUTE`, falls back to guided step on failure
  - Final: yields instructions-status step (success/clipboard/fallback)
- **Imports from project**: `@/core/schema/types`, `./claude-adapter`, `@/shared/messaging`

---

### src/content-scripts/claude/importer.ts
- **Lines**: 441
- **Exports**: None (self-initializing content script)
- **Message handlers registered**:
  - `AUTOFILL_EXECUTE` (line 85-97): Resolves selector via `SELECTOR_MAP`, calls `executeAction()`
  - `WAIT_FOR_NAVIGATION` (line 101-157): Polls URL + MutationObserver for SPA navigation detection
  - `CLIPBOARD_WRITE` (line 161-184): Clipboard API with textarea fallback
  - `FILL_PROJECT_INSTRUCTIONS` (line 338-395): Compound 7-step action for instructions
  - `GET_PAGE_URL` (line 399-401): Returns `window.location.href`
  - `VERIFY_PROJECTS` (line 405-430): Scans page for project names
  - `PING` (line 434-436): Returns `{ pong: true }`
- **Key internal functions**:
  - `clickElement(el: Element): void` (line 12-18)
  - `fillElement(el: Element, value: string, clear: boolean): void` (line 21-47): Uses native value setter for React compatibility
  - `executeAction(action, strategies, value?): Promise<{ success: boolean; error?: string }>` (line 49-81)
  - `findInstructionsSection(): HTMLElement | null` (line 196-223): Multi-strategy DOM search for "Instructions" section heading
  - `findAddButtonInSection(section: HTMLElement): HTMLElement | null` (line 228-255)
  - `findModalTextarea(timeoutMs?): Promise<HTMLTextAreaElement | null>` (line 262-300): Waits for modal dialog with textarea
  - `findModalSaveButton(textarea: HTMLTextAreaElement): HTMLElement | null` (line 306-336)
- **FILL_PROJECT_INSTRUCTIONS handler** (line 338-395) — the 7-step compound action:
  ```typescript
  // Step 1: Find the Instructions section by its text label
  // Step 2: Click the "+" / add button within the section
  // Step 3: Find the modal textarea (NOT the chat input)
  // Step 4: Focus the textarea before filling
  // Step 5: Fill the textarea using React-compatible value setter
  // Step 6: Verify the fill actually worked
  // Step 7: Click "Save instructions" in the modal
  ```
- **Imports from project**: `@/content-scripts/common/selector-engine`, `./selectors`, `@/shared/messaging`
- **Notes**: Calls `initMessageRouter()` at bottom (line 440). Uses `SELECTOR_MAP` from `./selectors` for DOM element targeting.

---

## Group 3: Extraction & Schema

### src/content-scripts/chatgpt/extractor.ts
- **Lines**: 888
- **Exports**:
  - `async function extractCustomGPTs(): Promise<CustomGPTExtractionResult>` (line 246-297)
  - `async function extractProjects(): Promise<ProjectExtractionResult>` (line 566-605)
  - `async function extractMemory(): Promise<MemoryExtractionResult>` (line 613-657)
  - `async function extractCustomInstructions(): Promise<CustomInstructionsExtractionResult>` (line 665-703)
  - `function scanSidebar(): SidebarScanResult` (line 712-758)
  - `function inspectDOM(): DOMInspectionReport` (line 767-780)
  - `async function extractProjectPage(): Promise<ProjectExtractionResult>` (line 790-803)
- **Key internal functions**:
  - `checkLoggedIn(): Promise<boolean>` (line 154-172): Checks login avatar, sidebar links, nav element
  - `detectPage(): ChatGPTPage` (line 184-192): URL-based page detection
  - `extractSingleGPT(warnings): Promise<ExtractedCustomGPT | null>` (line 200-240)
  - `extractSingleProject(warnings, gizmoId?, sidebarName?): Promise<ExtractedChatGPTProject | null>` (line 485-559): API-first path via `FETCH_GIZMO_API` message, DOM fallback
  - `extractInstructionsFromModal(warnings): Promise<string>` (line 305-473): Opens three-dot menu → "Project settings" → reads textarea → closes modal. Uses `CLICK_IN_MAIN_WORLD` for Radix UI compatibility.
  - `resolveAllElements(strategies): Element[]` (line 99-150): Multi-strategy DOM element finder
  - `readText(strategies, fieldName, warnings): string` (line 55-71)
  - `readTextAsync(strategies, fieldName, warnings, timeoutMs?): Promise<string>` (line 76-93)
- **Message handlers registered** (line 861-877):
  - `DOM_EXTRACT` → calls `handleExtractRequest(target)` which dispatches to `extractCustomGPTs()`, `extractProjects()`, `extractMemory()`, or `extractCustomInstructions()`
  - `DOM_INSPECT` → calls `inspectDOM()`
  - `SCAN_SIDEBAR` → calls `scanSidebar()`
  - `EXTRACT_PROJECT_PAGE` → calls `extractProjectPage()`
- **Sidebar scanning** (line 712-758): Finds project links matching `/g/<id>/project` href pattern and GPT links matching `/g/g-<id>` pattern
- **Project extraction flow** (line 566-605): Discovers projects from sidebar → extracts each via gizmo API using `FETCH_GIZMO_API` message → falls back to DOM on API failure
- **Imports from project**: `@/content-scripts/common/selector-engine`, `./selectors`, `@/shared/messaging`, `@/core/adapters/chatgpt-dom-types`
- **Notes**: Init guard prevents duplicate initialization (line 850-855). Sends `PAGE_STATE` message on init.

---

### src/core/schema/types.ts
- **Lines**: 213
- **All types (verbatim)**:

**PlatformIdentifier** (line 5-25):
```typescript
export const PlatformIdentifierSchema = z.object({
  platform: z.enum([
    "chatgpt", "claude", "gemini", "copilot", "poe", "custom",
  ]),
  version: z.string().optional(),
  tier: z.enum(["free", "plus", "pro", "max", "team", "enterprise"]).optional(),
  exportMethod: z.enum(["official_export", "dom_extraction", "api", "manual"]),
  exportedAt: z.string().datetime(),
});
export type PlatformIdentifier = z.infer<typeof PlatformIdentifierSchema>;
```

**KnowledgeFile** (line 76-88):
```typescript
export const KnowledgeFileSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  source: z.enum(["exported", "referenced", "reconstructed"]),
  contentRef: z.string().optional(),
  description: z.string().optional(),
  compatible: z.boolean(),
  conversionNeeded: z.string().optional(),
});
export type KnowledgeFile = z.infer<typeof KnowledgeFileSchema>;
```

**MemoryItem** (line 100-119):
```typescript
export const MemoryItemSchema = z.object({
  id: z.string(),
  fact: z.string(),
  category: z.enum([
    "identity", "preference", "project", "skill",
    "relationship", "tool", "context", "instruction",
  ]),
  confidence: z.number().min(0).max(1),
  source: z.enum(["explicit", "inferred"]),
  workspaceIds: z.array(z.string()),
  migration: MemoryItemMigrationSchema,
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
```

**MemoryItemMigration** (line 92-98):
```typescript
export const MemoryItemMigrationSchema = z.object({
  fitsConstraints: z.boolean(),
  truncatedVersion: z.string().optional(),
  priority: z.number().int().min(1).max(10),
});
```

**Workspace** (line 147-175):
```typescript
export const WorkspaceSchema = z.object({
  id: z.string(),
  sourceId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  instructions: WorkspaceInstructionsSchema,
  knowledgeFiles: z.array(KnowledgeFileSchema),
  category: z.enum([
    "coding", "writing", "research", "data_analysis", "creative",
    "business", "education", "personal", "customer_support", "other",
  ]),
  tags: z.array(z.string()),
  behavior: WorkspaceBehaviorSchema,
  capabilities: z.array(WorkspaceCapabilitySchema),
  conversationCount: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime(),
  sampleTopics: z.array(z.string()),
  migration: WorkspaceMigrationSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
```

**WorkspaceInstructions** (line 140-145):
```typescript
export const WorkspaceInstructionsSchema = z.object({
  raw: z.string(),
  translated: z.record(z.string(), z.string()).optional(),
});
```

**PortsmithManifest** (line 201-213):
```typescript
export const PortsmithManifestSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  source: PlatformIdentifierSchema,
  user: UserProfileSchema,
  workspaces: z.array(WorkspaceSchema),
  memory: z.array(MemoryItemSchema),
  globalInstructions: z.string(),
  conversationSummaries: z.array(ConversationSummarySchema).optional(),
  metadata: ManifestMetadataSchema,
});
export type PortsmithManifest = z.infer<typeof PortsmithManifestSchema>;
```

---

### src/shared/messaging.ts
- **Lines**: 591
- **MessageMap type (COMPLETE, verbatim)** (line 156-282):
```typescript
export interface MessageMap {
  EXTRACT_START: {
    request: { platform: string };
    response: { success: boolean };
  };
  EXTRACT_PROGRESS: {
    request: { step: string; percent: number };
    response: void;
  };
  EXTRACT_COMPLETE: {
    request: { manifest: PortsmithManifest };
    response: void;
  };
  AUTOFILL_STEP: {
    request: { step: AutofillStep };
    response: { success: boolean };
  };
  AUTOFILL_EXECUTE: {
    request: AutofillExecuteRequest;
    response: AutofillExecuteResponse;
  };
  GET_MIGRATION_STATE: {
    request: void;
    response: MigrationState;
  };
  PAGE_STATE: {
    request: { url: string; platform: string };
    response: void;
  };
  DOM_INSPECT: {
    request: void;
    response: DOMInspectionReport;
  };
  SCAN_SIDEBAR: {
    request: void;
    response: SidebarScanResult;
  };
  EXTRACT_PROJECT_PAGE: {
    request: void;
    response: ProjectExtractionResult;
  };
  DOM_EXTRACT: {
    request: { target: DOMExtractionTarget };
    response: { success: boolean };
  };
  DOM_EXTRACT_RESULT: {
    request: DOMExtractionResult;
    response: void;
  };
  MIGRATION_START: {
    request: {
      manifestId: string;
      mode: "autofill" | "guided" | "hybrid";
      workspaceIds: string[];
    };
    response: { success: boolean };
  };
  MIGRATION_STATUS: {
    request: void;
    response: OrchestratorStatus;
  };
  MIGRATION_PAUSE: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_RESUME: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_CANCEL: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_CONFIRM: {
    request: { confirmed: boolean };
    response: { success: boolean };
  };
  MIGRATION_WORKSPACE_DONE: {
    request: { workspaceId: string };
    response: { success: boolean };
  };
  MIGRATION_MEMORY_DONE: {
    request: void;
    response: { success: boolean };
  };
  MIGRATION_UPDATE_DELIVERY: {
    request: { workspaceId: string; delivery: InstructionsDelivery };
    response: { success: boolean };
  };
  VERIFY_PROJECTS: {
    request: { projectNames: string[] };
    response: { found: string[]; notFound: string[] };
  };
  WAIT_FOR_NAVIGATION: {
    request: { urlPattern: string; timeoutMs: number };
    response: { success: boolean; currentUrl: string; error?: string };
  };
  CLIPBOARD_WRITE: {
    request: { text: string };
    response: { success: boolean; error?: string };
  };
  GET_PAGE_URL: {
    request: void;
    response: { url: string };
  };
  FILL_PROJECT_INSTRUCTIONS: {
    request: { instructions: string };
    response: { success: boolean; saved?: boolean; error?: string };
  };
  CLICK_IN_MAIN_WORLD: {
    request: { selector: string };
    response: boolean;
  };
  FETCH_GIZMO_API: {
    request: { gizmoId: string };
    response: GizmoAPIResponse;
  };
  PING: {
    request: void;
    response: { pong: true };
  };
}
```

- **Other key types** (line 9-152):
  - `MigrationState` (line 9-21): `{ status, sourcePlatform, targetPlatform, progress, error }`
  - `AutofillAction = "click" | "fill" | "clear_and_fill"` (line 23)
  - `AutofillExecuteRequest` (line 25-29): `{ action, target, value? }`
  - `AutofillExecuteResponse` (line 31-34): `{ success, error? }`
  - `AutofillStepStatus` (line 36-44): `"pending" | "running" | "success" | "failed" | "fallback" | "skipped" | "clipboard" | "navigate_failed"`
  - `DOMExtractionTarget` (line 53-57): `"custom_gpts" | "projects" | "memory" | "custom_instructions"`
  - `GizmoAPIResponse` (line 61-74)
  - `SidebarItem` / `SidebarScanResult` (line 78-87)
  - `DOMInspectionReport` (line 91-98)
  - `MigrationStepFallback` (line 102-109)
  - `InstructionsDelivery` (line 111-116): `"autofilled" | "clipboard" | "manual" | "none" | "pending"`
  - `MigrationStep` (line 118-125): `{ id, title, status, fallback?, instructionsDelivery? }`
  - `MigrationGuidedInstructions` (line 127-131)
  - `OrchestratorStatus` (line 133-152)

- **Helper functions**:
  - `sendMessage<K>(name, ...data): Promise<response>` (line 402-444): Sends via `chrome.runtime.sendMessage` with 10s timeout
  - `sendTabMessage<K>(tabId, name, ...data): Promise<response>` (line 446-493): Sends via `chrome.tabs.sendMessage` with 10s timeout
  - `safeSendTabMessage<K>(tabId, name, ...data): Promise<response>` (line 507-538): Wraps `sendTabMessage` with auto-injection on `NoListenerError`
  - `onMessage<K>(name, handler): () => void` (line 554-562): Registers handler, returns unregister function
  - `initMessageRouter(): void` (line 571-591): Adds `chrome.runtime.onMessage` listener that dispatches to registered handlers
  - `_resetHandlers(): void` (line 565-567): Test-only handler reset

- **Wire protocol**: Messages wrapped in `{ __portsmith: true, type, payload }` envelope; responses as `{ __portsmith: true, ok: true, data }` or `{ __portsmith: true, ok: false, error }`
- **Error classes**: `MessageError`, `MessageTimeoutError`, `NoListenerError` (line 323-348)
- **Content script injection**: `injectContentScript(tabId)` (line 369-395), `matchesUrlPattern(url, pattern)` (line 357-363)
- **Constants**: `MESSAGE_TIMEOUT_MS = 10_000` (line 319)

---

## Group 4: Transform & Dependencies

### src/core/transform/file-converter.ts
**DOES NOT EXIST**

---

### src/core/transform/prompt-translator.ts
- **Lines**: 389
- **Exports**:
  - `interface TranslationResult { translated: string; rulesApplied: string[]; }` (line 7-10)
  - `interface TranslationRule { name: string; apply: (text: string) => string | null; }` (line 12-15)
  - `interface DetectedCapabilities { usesDallE: boolean; usesCodeInterpreter: boolean; usesBrowsing: boolean; usesCanvas: boolean; usesApiActions: boolean; }` (line 19-25)
  - `function detectCapabilities(instructions: string): DetectedCapabilities` (line 59-69)
  - `function translateForClaude(instructions: string): TranslationResult` (line 347-364)
  - `function generateCapabilityWarnings(capabilities: DetectedCapabilities): string[]` (line 369-389)
- **Translation rules** (8 rules, applied in order):
  1. `remove_roleplay_framing` — "Act as..." → "Help as...", "You are a..." → "You have expertise as..."
  2. `soften_directives` — "You MUST always" → "Please always", "NEVER" → "Avoid", "ALWAYS" → "Prefer to always"
  3. `code_interpreter_to_artifacts` — "Code Interpreter" → "Artifacts for code"
  4. `dalle_unavailable_warning` — Adds "[Note: Image generation is not available on Claude]"
  5. `browsing_to_web_search` — "Browse the web" → "Use web search"
  6. `canvas_to_artifacts` — "Use Canvas" → "Use Artifacts"
  7. `wrap_xml_tags` — Wraps markdown heading sections in XML tags
  8. `add_artifacts_hint` — Adds Artifacts hint for code-heavy content (3+ code indicators)
- **Imports from project**: None (standalone module)

---

### package.json (dependencies only)
```json
{
  "dependencies": {
    "dexie": "^4.3.0",
    "fflate": "^0.8.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.3.6",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.27",
    "@types/chrome": "^0.0.287",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "fake-indexeddb": "^6.2.5",
    "jsdom": "^28.1.0",
    "postcss": "^8.4.47",
    "prettier": "^3.3.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

---

### manifest.json
```json
{
  "manifest_version": 3,
  "name": "PortSmith",
  "version": "0.1.1",
  "description": "Migrate AI assistant configurations between platforms",
  "permissions": ["storage", "sidePanel", "scripting", "clipboardWrite", "windows"],
  "host_permissions": [
    "https://chatgpt.com/*",
    "https://claude.ai/*"
  ],
  "optional_host_permissions": [
    "https://chat.openai.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "action": {
    "default_popup": "src/popup/index.html"
  },
  "content_scripts": [
    {
      "matches": ["https://chatgpt.com/*"],
      "js": ["src/content-scripts/chatgpt/extractor.ts"]
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["src/content-scripts/claude/importer.ts"]
    }
  ]
}
```

---

## Group 5: Shared Infrastructure

### src/shared/constants.ts
- **Lines**: 2
- **Exports**:
  - `export const APP_NAME = "PortSmith";` (line 1)
  - `export const APP_VERSION = "0.1.0";` (line 2)
- **Notes**: Version is "0.1.0" here but "0.1.1" in package.json and manifest.json — these are out of sync.

---

### src/shared/utils.ts
**DOES NOT EXIST**

---

### src/background/service-worker.ts
- **Lines**: 163
- **Exports**: None (self-initializing)
- **Key setup**:
  - Calls `initMessageRouter()` (line 8)
  - Calls `registerOrchestratorHandlers()` (line 9)
  - Sets `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` (line 12)
- **Platform tab tracking** (line 18-28):
  - `platformTabs` Map: platform string → tab ID
  - Updated when content scripts send `PAGE_STATE` messages
- **Message handlers**:
  - `PAGE_STATE` (line 20-28): Records tab ID per platform
  - `VERIFY_PROJECTS` (line 32-34): Delegates to `verifyProjects()`
  - `FETCH_GIZMO_API` (line 84-110): Fetches gizmo data from ChatGPT backend API via `chrome.scripting.executeScript` in MAIN world
  - `CLICK_IN_MAIN_WORLD` (line 118-152): Dispatches pointer/mouse events from MAIN world for Radix UI compatibility
- **ChatGPT access token** (line 41-77):
  - `getChatGPTAccessToken(tabId): Promise<string | null>`: Fetches from `/api/auth/session` in MAIN world
  - Cached in `accessTokenCache` Map with 5-minute TTL
- **Tab cleanup** (line 155-163): `chrome.tabs.onRemoved` listener clears token cache and platform tab entries
- **Imports from project**: `@/shared/constants`, `@/shared/messaging`, `./migration-orchestrator`, `@/core/adapters/claude-verifier`

---

### src/sidepanel/App.tsx
- **Lines**: 98
- **Exports**: Default function `App(): React.JSX.Element`
- **Phase → Page mapping** (line 15-38):
  ```typescript
  function getPageForPhase(phase: MigrationPhase): React.ComponentType {
    switch (phase) {
      case "idle":
      case "source_selection":     return SourceSelect;
      case "target_selection":     return TargetSelect;
      case "extraction_method":    return ExtractionMethod;
      case "extracting":           return Extract;
      case "review":               return Review;
      case "editing":              return WorkspaceEditor;
      case "mode_selection":       return ModeSelect;
      case "migrating":
      case "verification":         return Migrate;
      case "complete":             return Complete;
    }
  }
  ```
- **State**: Zustand selectors: `phase`, `pendingResume`, `resumeChecked`, `checkForResume`, `acceptResume`, `declineResume`
- **Renders**:
  - Loading state while checking for checkpoint
  - Resume prompt if `pendingResume` exists
  - WizardLayout wrapping the phase-appropriate Page component
- **Imports from project**: `./components/WizardLayout`, `./store/migration-store`, `@/core/storage/migration-state`, 9 page components

---

### src/sidepanel/hooks/useMigration.ts
**DOES NOT EXIST**

---

### src/sidepanel/store/migration-store.ts (bonus — referenced everywhere)
- **Lines**: 318
- **Exports**:
  - `const STEP_LABELS = ["Source", "Extract", "Review", "Mode", "Migrate", "Complete"]` (line 46-52)
  - `const TOTAL_STEPS = STEP_LABELS.length` (line 54)
  - `function phaseToStep(phase: MigrationPhase): number` (line 57-65)
  - `function canProceed(state: MigrationState): boolean` (line 128-147)
  - `const useMigrationStore = create<MigrationStore>(...)` (line 151-295)
  - `type MigrationStore = MigrationState & MigrationActions` (line 109)
- **MigrationPhase order** (line 21-33): idle → source_selection → target_selection → extraction_method → extracting → review → editing → mode_selection → migrating → verification → complete
- **Store actions**: nextStep, prevStep, goToStep, setSourcePlatform, setTargetPlatform, setExtractionMethod, setManifestId, setSelectedWorkspaceIds, toggleWorkspace, setEditingWorkspaceId, setDeliveryMode, reset, checkForResume, acceptResume, declineResume
- **Auto-checkpoint**: Subscribes to state changes, checkpoints on every phase change (except idle) and workspace selection changes during review

---

### src/core/storage/indexed-db.ts (bonus — referenced by orchestrator)
- **Lines**: 159
- **Key types**:
  - `MigrationPhase` (line 46-57): Same as in migration-store
  - `ExtractionMethod = "upload" | "browser" | "both"` (line 59)
  - `DeliveryMode = "autofill" | "guided" | "hybrid"` (line 61)
  - `MigrationStateSnapshot` (line 29-44): `{ phase, sourcePlatform, targetPlatform, extractionMethod, deliveryMode, manifestId, selectedWorkspaceIds, completedWorkspaceIds, errors, instructionsDelivery? }`
  - `ManifestRecord` (line 6-11): `{ id, data: PortsmithManifest, createdAt, updatedAt }`
  - `FileRecord` (line 13-18): `{ id, blob, mimeType, originalName }`
  - `CheckpointRecord` (line 20-26): `{ id, migrationState, timestamp, workspaceIndex, stepIndex }`
- **Database**: Dexie instance with tables: manifests, files, checkpoints

---

## Cross-Cutting Observations

### Current guided mode step sequence

For a sample workspace with ID "ws-1", name "My Project", description "A tool for X", and instructions (1200 chars):

1. `ws-1-navigate` — "Go to Claude Projects" (link: claude.ai/projects)
2. `ws-1-create` — "Create a new project"
3. `ws-1-name` — "Enter the project name" (copyBlock: "My Project")
4. `ws-1-description` — "Enter the description" (copyBlock: "A tool for X")
5. `ws-1-save` — 'Click "Create project"'
6. `ws-1-open-instructions` — "Open the instructions editor"
7. `ws-1-instructions` — "Paste the project instructions" (copyBlock: 1,200 chars)
8. `ws-1-save-instructions` — "Save the instructions"
9. `ws-1-verify` — "Verify the project"

If the workspace also has compatible knowledge files:
- Step 9 would be `ws-1-files` — "Upload knowledge files"
- Step 10 would be `ws-1-verify`

If the workspace has NO instructions, steps 6-8 are omitted.

For memory items (sorted by priority desc):
1. `memory-navigate` — "Go to Settings" (link: claude.ai/settings)
2. `memory-{item.id}` — "Add memory: {item.category}" (copyBlock: fact text)

---

### Current autofill step sequence

**Phase 1 (buildPhase1Defs):**
1. `{id}-navigate` — action: "navigate" — Navigates tab to `claude.ai/projects`, waits for load, pings content script, activates tab
2. `{id}-create` — action: "click" — target: `projects.createButton` (guidedIndex 1)
3. `{id}-name` — action: "clear_and_fill" — target: `form.nameInput`, value: workspace.name (guidedIndex 2)
4. `{id}-description` — action: "clear_and_fill" — target: `form.descriptionInput`, value: description (guidedIndex 3)
5. `{id}-save` — action: "click" — target: `form.saveButton` (guidedIndex 4)
6. `{id}-wait-nav` — action: "wait_for_navigation" — Waits for URL matching `^https://claude\.ai/project/[a-f0-9-]+`, 15s timeout. On timeout: clipboard fallback for instructions

**Phase 2 (buildPhase2Defs):**
7. `{id}-instructions` — action: "fill_instructions" — Sends `FILL_PROJECT_INSTRUCTIONS` message (compound 7-step action: find section → click add → find modal textarea → focus → fill → verify → save). Fallback: clipboard copy, then guided step
8. `{id}-files` — action: "manual" — Always shows guided fallback (file upload is too fragile for DOM automation)

**Final status step:**
9. `{id}-instructions-status` — Status-only step reporting if instructions were autofilled, clipboard-copied, or need manual entry

**Fallback behavior per step:**
- Navigate: up to 3 attempts, yields `navigate_failed` for user retry, returns `failed` if all attempts fail
- Click/fill: yields `fallback` with guided step reference on failure
- fill_instructions: tries autofill → clipboard → guided fallback
- wait_for_navigation: tries navigation detection → clipboard for instructions on timeout

---

### Message flow for autofill migration

1. **User clicks "Start"** on Migrate page (or page auto-starts on mount)
2. **Side panel → Service worker**: `MIGRATION_START { manifestId, mode, workspaceIds }`
3. **Service worker** (orchestrator): Loads manifest from IndexedDB, calls `processWorkspaces()`
4. **For each workspace**, orchestrator calls `processAutofillWorkspace(workspace)`:
   a. `getTabForAutofill()` → `findClaudeTab()` → `chrome.tabs.query()`
   b. Creates `autofillWorkspace()` generator
   c. **Generator yields steps**, orchestrator updates `currentSteps` state

5. **Side panel polls** (every 500ms): `MIGRATION_STATUS` → orchestrator returns full `OrchestratorStatus`

6. **Navigate step** (generator):
   - Generator calls `chrome.tabs.update(tabId, { url })` via `navigateAndWaitForLoad()`
   - Calls `waitForContentScript(tabId)` which sends:
     - **Service worker → Content script (claude/importer.ts)**: `PING` → `{ pong: true }`
     - First attempt uses `safeSendTabMessage` which auto-injects on failure
   - Calls `chrome.tabs.update(tabId, { active: true })` to bring tab to foreground

7. **Click/fill steps** (generator → orchestrator → content script):
   - Generator calls `executeOnTab()` which sends:
     - **Service worker → Content script**: `AUTOFILL_EXECUTE { action, target, value }`
     - Content script resolves selector via `SELECTOR_MAP`, performs DOM action, returns `{ success }`

8. **Wait for navigation** (generator → content script):
   - **Service worker → Content script**: `WAIT_FOR_NAVIGATION { urlPattern, timeoutMs }`
   - Content script polls `window.location.href` + MutationObserver

9. **Fill instructions** (generator → content script):
   - **Service worker → Content script**: `FILL_PROJECT_INSTRUCTIONS { instructions }`
   - Content script performs 7-step compound action (find section, click add, find modal, fill, save)
   - On failure: generator calls `clipboardWrite()`:
     - **Service worker → Content script**: `CLIPBOARD_WRITE { text }`

10. **Hybrid mode**: Generator yields `pending` status → orchestrator sets `pendingConfirmStepId` → side panel shows confirm/skip buttons → user clicks → side panel sends `MIGRATION_CONFIRM { confirmed }` → orchestrator resolves Promise → generator continues

11. **Navigate failed**: Generator yields `navigate_failed` → orchestrator pauses with `pendingConfirmStepId` → side panel shows retry/cancel UI → user clicks → `MIGRATION_CONFIRM` → generator continues

12. **Workspace complete**: Orchestrator pushes to `completedWorkspaceIds`, checkpoints to IndexedDB, moves to next workspace

13. **All workspaces done**: Orchestrator transitions to `memory` phase (if memory exists) or `complete`

14. **Memory phase** (guided only): Side panel renders StepCard + guided navigation. User completes steps, clicks "Finish" → `MIGRATION_MEMORY_DONE` → orchestrator sets phase to `complete`

15. **Completion**: Side panel shows summary, user clicks "Complete Migration" → `goToStep("complete")`

---

### Tab selection logic trace

```
Migrate.tsx mounts
  → sendMessage("MIGRATION_START", { manifestId, mode, workspaceIds })
  → orchestrator.start(manifestId, mode, workspaceIds)
  → orchestrator.processWorkspaces()
    → orchestrator.processAutofillWorkspace(workspace)

      Step 1: getTabForAutofill()
        → findClaudeTab()
          → chrome.tabs.query({ url: "https://claude.ai/*", active: true, currentWindow: true })
            → If found: return tab.id (PREFERRED: active Claude tab)
          → chrome.tabs.query({ url: "https://claude.ai/*" })
            → If found: return tabs[0].id (ANY Claude tab)
          → return null (no Claude tab)
        → If findClaudeTab() returned non-null: return it
        → chrome.tabs.query({ active: true, currentWindow: true })
          → If found: return activeTab.id (FALLBACK: whatever tab is active)
        → return null (FAILURE: no tabs at all)

      Step 2: If tabId is null → workspace fails with "No browser tab available"

      Step 3: autofillWorkspace(workspace, tabId, { hybrid })
        → Navigate step:
          → chrome.tabs.get(tabId) to check current URL
          → If not on claude.ai/projects: navigateAndWaitForLoad(tabId, "https://claude.ai/projects")
            → chrome.tabs.update(tabId, { url: "https://claude.ai/projects" })
            → Waits for chrome.tabs.onUpdated status === "complete"
          → waitForContentScript(tabId, 10 retries)
            → safeSendTabMessage(tabId, "PING") [first attempt - auto-injects]
            → sendTabMessage(tabId, "PING") [retries 2-10]
          → chrome.tabs.update(tabId, { active: true }) — bring tab to foreground
          → chrome.windows.update(windowId, { focused: true })

      Step 4: Phase 1 continues (click, fill, etc.) using same tabId
      Step 5: Phase 2 continues using same tabId

      *** NOTE: tabId is fixed for the entire workspace — it's captured once
          at the start of processAutofillWorkspace() and reused for all steps.
          But between workspaces, getTabForAutofill() is called again, so a
          different tab could be selected for the next workspace.
```

**Key observations for multiple-tabs fix:**
- Tab ID is queried ONCE per workspace, not per step
- `findClaudeTab()` prefers active Claude tab, then any Claude tab, then falls back to any active tab
- If user has multiple Claude tabs, `tabs[0]` is returned (first in Chrome's internal order, not necessarily the one the user expects)
- Between workspaces, a NEW tab lookup happens — could pick a different tab
- The navigate step may REDIRECT whichever tab is found to claude.ai/projects
- There's no mechanism to remember or prefer a specific tab across workspaces

---

### Current file handling

**Extraction pipeline (ChatGPT side):**
- `extractSingleGPT()` captures `knowledgeFileNames: string[]` (line 221-226) — just the file name text from the GPT editor DOM
- `extractSingleProject()` via API: gets `files` array from gizmo API with `{ name, type, size }` (line 506)
- `extractSingleProject()` via DOM: finds file elements via `PROJECT_PAGE.knowledgeFiles` selectors, reads `textContent` (line 538-543)
- **No actual file content is extracted** — only filenames/metadata

**Schema (KnowledgeFile type):**
```typescript
{
  id: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  source: "exported" | "referenced" | "reconstructed",
  contentRef: string | undefined,  // reference to blob in IndexedDB
  compatible: boolean,
  conversionNeeded: string | undefined,
}
```
- `contentRef` is optional — currently not populated by extraction
- `compatible` boolean determines if file appears in guided/autofill steps

**Claude adapter (import side):**
- `generateInstructions()` (line 112-122): Creates a "Upload knowledge files" step listing compatible file names — but no actual upload mechanism
- `buildPhase2Defs()` (line 230-240): Creates a "manual" step for files — always shows guided fallback, never attempts DOM file upload
- **File transfer is entirely manual** — user must download from ChatGPT and upload to Claude themselves

**Storage:**
- `FileRecord` type exists in IndexedDB: `{ id, blob, mimeType, originalName }`
- `saveFile()` / `loadFile()` functions exist in indexed-db.ts
- These are not currently called by the extraction or migration pipeline

**Where files appear in the UI:**
- StepCard renders `step.fileNames` as a bulleted list with file icons (line 60-83 of StepCard.tsx)
- In guided mode: the "Upload knowledge files" step shows the file name list
- In autofill mode: the files step yields a "fallback" with the guided step (file upload always manual)

**No `file-converter.ts` exists** — the transform layer does not handle file format conversion.

---

## Bugs/Issues Found

1. **Version mismatch**: `src/shared/constants.ts` has `APP_VERSION = "0.1.0"` but `package.json` and `manifest.json` both have `"0.1.1"`.

2. **Duplicate StepRow component**: `StepRow` is defined identically in both `AutofillMigration.tsx` (line 18-55) and `Migrate.tsx` (line 40-83). Should be extracted to a shared component.

3. **Potentially dead code**: `AutofillMigration.tsx` and `GuidedMigration.tsx` are components that perform migration directly from the side panel (calling `autofillWorkspace()` directly). However, `App.tsx` maps `migrating` phase to `Migrate.tsx`, which uses the orchestrator. These components may be unused dead code, or they may be imported elsewhere not in the audit scope.

4. **Tab ID not persisted across service worker restarts**: The orchestrator's `resume()` method restores checkpoint data from IndexedDB but must re-query for a Claude tab via `getTabForAutofill()`. If the service worker was terminated and restarted mid-migration, the tab association is lost. The resume flow calls `processWorkspaces()` which will query a fresh tab, so this works — but the comment could be clearer.

5. **Multiple Claude tabs ambiguity**: `findClaudeTab()` returns `tabs[0]` when there are multiple Claude tabs. Chrome's tab query ordering is not guaranteed to be deterministic or user-visible-order.

6. **No file content extraction**: The `KnowledgeFile` schema has `contentRef` and `sizeBytes` fields, but extraction only captures file names. The `FileRecord` storage exists but is never populated. This means file transfer requires users to manually download and re-upload.

7. **Legacy AutofillStep type**: `messaging.ts` line 47-51 has `AutofillStep` marked as "Legacy placeholder — kept for backward compatibility" but it's still in `MessageMap` under `AUTOFILL_STEP`. The `AUTOFILL_STEP` message type appears unused.

8. **Instructions delivery not always tracked**: In `processAutofillWorkspace()`, instructions delivery is initialized to "pending" or "none", but if the generator throws an exception, the workspace is added to `failedWorkspaces` and delivery status may remain "pending" forever.
