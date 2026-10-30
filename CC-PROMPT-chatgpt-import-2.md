# ChatGPT automatic import, part 2 of 2: orchestrator, modes, UI, docs, stubbed E2E

## TASK
Wire the ChatGPT importer from part 1 into the migration orchestrator so Autofill and Hybrid work with ChatGPT as the target, turn those modes on, fix the copy and leftover cards that assume Gemini, feed the guided flow the same name and instruction limits, update the docs, add a stubbed E2E script, and open a PR. Do not merge.

## PART 0: preconditions (stop and report if any fails)
1. `git fetch origin && git checkout feat/chatgpt-autofill && git pull --ff-only`. The branch must contain part 1's work: `src/content-scripts/chatgpt/importer.ts`, `src/core/transform/chatgpt-limits.ts`, the `CHATGPT_CREATE_PROJECT` / `CHATGPT_UPLOAD_PROJECT_FILE` / `CHATGPT_FIND_PROJECTS` messages in `src/shared/messaging.ts`, and the importer's entry in `manifest.json`.
2. `npm ci && npm test` passes before you change anything. Record the test count.
If either fails, make no changes, leave the tree on `main`, and report exactly what is missing.

## CONTEXT
Facts already settled (verified live 2026-10-30; do not re-research):
- ChatGPT project names max 50 code points, instructions max 8000; over either, the create call returns 422 and nothing is made. `fitProjectName` and `fitInstructions` in `src/core/transform/chatgpt-limits.ts` handle both.
- Files land in Sources only after all four upload steps; part 1's `uploadProjectFile` does all four, one file per call. Uploads append.
- ChatGPT projects have no description field.
- The project page is `https://chatgpt.com/g/{gizmoId}/project`, Sources tab `?tab=sources`.
- The sidebar UI on 2026-10-30: a "Projects" heading with a **+** button that opens a **Create project** modal (Project name field, a "Default memory" dropdown, **Create project** button); inside a project, the three-dot menu at top right holds **Project settings** (Project name, Instructions, Memory, Library access, Delete project, Cancel, Save) and the **Sources** tab has **Add sources**.
- Bodies are base64 in messages, as the Gemini path does (`loadFile(contentRef)` returns `record.blob` as base64).

The template for nearly all of this is the Gemini automatic path in `src/background/migration-orchestrator.ts`: `processGeminiAutofillWorkspace` (around line 998), `addGemKnowledge` (around line 1190), `getGeminiTab` (around line 471), `findGemsNamed`, and the `switch (this.targetPlatform)` in `processWorkspaces` (around line 559, where `case "chatgpt"` currently always runs `processGuidedWorkspace`).

## SCOPE
- **`src/background/migration-orchestrator.ts`**
  - `getChatGPTTab()`: pin a `https://chatgpt.com/*` tab like `getGeminiTab` (no account path logic); when none is open, create one at `https://chatgpt.com/` inactive and wait for its content script to answer `PING` (poll up to 15 s) rather than a fixed sleep.
  - `checkDuplicateTabs()`: drop the early `return null` for ChatGPT so the generic "N tabs are open" note applies.
  - `processChatGPTAutofillWorkspace(run, workspace)`, following `processGeminiAutofillWorkspace` step for step: hybrid confirmation ("Create the project "<name>"?", labels "Create project" / "Skip"); `fitProjectName` and `fitInstructions` (instructions from `getInstructionsForTarget(workspace, "chatgpt")`, source label from `this.sourceLabel()`); the duplicate check on the FITTED name via `CHATGPT_FIND_PROJECTS` (automatic skips and lists it; hybrid asks "Create another"); `CHATGPT_CREATE_PROJECT`; on an error with a prior listing, re-list and adopt exactly one new id, as Gemini does; `markCreated` immediately on success; the same failed and hand-made branches using `buildManualCreateFallback(workspace, "chatgpt", ...)`. When the name was trimmed, add a follow-up: `ChatGPT allows 50 characters in a project name, so "<original>" was created as "<fitted>"`. When instructions overflowed, add a follow-up saying the instructions were shortened at a paragraph break and the full text is in the project file `<fileName>`. When `workspace.description` is non-empty, add a follow-up that ChatGPT projects have no description field, with the text available on the results card. An `instructionsMismatch` result is a created project whose instructions need checking: mark it created, set delivery to `"manual"`, and add a follow-up saying so.
  - `addChatGPTSources(...)`, following `addGemKnowledge`: upload, in order, the overflow instructions file (if any), the project memory document (`renderProjectMemoryMarkdown`, `projectMemoryFileName`), then each copied file (`contentRef`). One `CHATGPT_UPLOAD_PROJECT_FILE` per file; no final "update" call is needed. Count successes per file. Leftovers go to `knowledgeLeftovers[workspace.id]` with link `https://chatgpt.com/g/<gizmoId>/project?tab=sources`, and a follow-up naming the first failure. The step title says "Sources", not "Knowledge". If the overflow file fails, the follow-up must say the full instructions did not reach the project.
  - **Message size cap (from part 1's report):** files reach the content script as base64 inside one `chrome.tabs.sendMessage`, which Chrome caps at 64 MiB, so a file over about 48 MiB can never arrive. Check what cap, if any, the Gemini path (`addGemKnowledge`) and the Claude path already apply and reuse it; if neither has one, add a shared `MAX_MESSAGE_FILE_BYTES` (48 MiB) in `src/shared/constants.ts`, apply it to all three targets, and send any larger file straight to the leftovers with the reason "too large to pass through the extension (over 48 MB): add it by hand". Unit-test the ChatGPT case.
  - In `processWorkspaces`, route `case "chatgpt"` to `processChatGPTAutofillWorkspace` unless `this.mode === "guided"`.
  - Add `CHATGPT_*` to whatever per-message bookkeeping the Gemini messages have in this file (timeouts live in `messaging.ts` already).
- **`src/core/platforms.ts`**: `supportedModesForTarget` returns all three modes for every target; update its comment.
- **`src/core/adapters/leftover-cards.ts`**: knowledge leftovers currently always build `buildGemKnowledgeStep`, which says "Gem". Make the card target-aware: for `chatgpt`, a card titled `Add files to "<name>"` that opens the Sources link, lists the remaining files with their downloads (reuse `buildDownloads` from `manual-fallback.ts`) and says to use **Add sources**. Gemini's card is unchanged.
- **`src/core/adapters/manual-fallback.ts`**: ChatGPT steps to the current labels: 'In the ChatGPT sidebar, click the + next to "Projects", paste the name and click "Create project".', then the Project settings step, then 'Open the project\'s Sources tab, click "Add sources" and add the files and the project memory document.'
- **`src/core/adapters/chatgpt-guided.ts`**: use `fitProjectName` and `fitInstructions` so guided users are never told to paste text ChatGPT refuses. When the name is trimmed, say so in the step. When the instructions overflow, the instructions block holds the fitted text and the files step adds the overflow file as a download (inline content). Fix the "New project" wording to the + button as above. Update the header comment (no longer "no automated importer").
- **`src/sidepanel/pages/TargetSelect.tsx`**: ChatGPT description "Creates projects with instructions and files; memory is added with guided steps".
- **`src/sidepanel/pages/ModeSelect.tsx`**: ChatGPT copy alongside the Gemini overrides: Autofill "PortSmith creates each project through ChatGPT's API and adds the files to its Sources.", cons "Needs a ChatGPT tab (opened for you)"; Hybrid "Like Autofill, but asks before creating each project."
- **`tests/unit/transforms-v04.test.ts:321`**: expect all three modes for ChatGPT.
- **Tests**: orchestrator tests for the ChatGPT path in `tests/unit/migration-orchestrator.test.ts` (mirror the Gemini cases): automatic create plus Sources upload; duplicate name skipped in automatic and asked in hybrid; trimmed name follow-up; overflow file uploaded first; one file failing lands in `knowledgeLeftovers` with the Sources link; a resumed run never creates twice (`createdWorkspaceIds`). Leftover-card test for the ChatGPT card. Guided test for trimmed name and overflow download.
- **`scripts/e2e-chatgpt-autofill.mjs`**: copy the shape of `scripts/e2e-gemini-autofill.mjs`. Stub `https://chatgpt.com/` (a page), `/api/auth/session` (`{accessToken:"stub"}`), `/backend-api/gizmos/snorlax/sidebar*`, `POST /backend-api/projects`, the four file steps (a stub upload host returning 201, an NDJSON `process_upload_stream`, and `/backend-api/projects/<id>/files` echoing the appended list). Assert: automatic mode creates the project with the fitted name and instructions, uploads the project memory document and the copied files through all four steps, sends no `Authorization` header to the upload host, and never stops to ask; a second run with the same name skips it.
- **Docs**: in `docs/chatgpt-endpoints.md` replace the "Write API (observed live 2026-09-20)" section with the 2026-10-30 contract from part 1's prompt (four-step upload, `use_case: "gizmo"`, the 50/8000 code-point limits, the 512 MiB ceiling, NDJSON stream, step 4 appends) and keep the caveats (Team/Enterprise and `ChatGPT-Account-Id` unverified, per-plan file caps unverified). `CLAUDE.md` line 9 and its ChatGPT API bullet, and `README.md` line 28: ChatGPT is now automatic for projects, instructions and files, guided for memory and custom instructions.

## ACCEPTANCE CRITERIA
- [ ] With ChatGPT as target, ModeSelect offers Autofill, Guided and Hybrid, defaulting to Hybrid, and TargetSelect shows no "Guided only" badge.
- [ ] Orchestrator unit tests above pass, including the resume case.
- [ ] `node scripts/e2e-chatgpt-autofill.mjs dist` passes after `npm run build`, as do the existing `e2e-claude-autofill.mjs`, `e2e-gemini-autofill.mjs` and `e2e-duplicate-dispatch.mjs` (install Playwright with `npm i --no-save playwright && npx playwright install chromium`).
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. Test count is reported before and after.

## EXCLUDES
- No live requests to chatgpt.com. The live walk in Erik's own Chrome comes after this run.
- No version bump, no store submission, no privacy-policy edit.
- No ChatGPT memory or custom-instructions writes; those stay guided.
- No `optional_host_permissions` work.
- Do not merge.

## FINISH
Commit in logical commits on `feat/chatgpt-autofill`, push, open ONE PR to `main` titled "ChatGPT as an automatic target (projects, instructions, Sources)" with a body listing what changed, the test counts, and a "Live walk still needed" checklist: load the unpacked `dist/` in Chrome, run Claude to ChatGPT in Autofill and Hybrid with a project whose name is over 50 characters, instructions over 8000 characters, two files and project memory; confirm in ChatGPT that the name, instructions and every Sources file arrived; run it again and confirm the duplicate is skipped. Leave the tree clean. End the report with the PR number and anything in this prompt the code could not follow and why.
