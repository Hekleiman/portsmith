# TASK

Add a "rescue your GPTs" path for OpenAI's Dec 11, 2026 custom GPT retirement: a dated notice, a one-click GPT backup zip (with a SKILL.md per GPT), and a correct message once GPTs are gone. Then merge the PR.

# CONTEXT

- OpenAI's retirement FAQ (help.openai.com article 20001519, read 11/8/26) sets **Dec 11, 2026** as the standard retirement for all plans: "custom GPTs and their GPT pages become inaccessible." FedRAMP and Enterprise workspaces with an approved deferral move on Feb 11, 2027. OpenAI offers no GPT export, and its own "Migrate to plugin" drops custom actions, the model and sharing.
- Verified live on Erik's Plus account, 11/9/26:
  - `/gpts/mine` shows "GPTs will be retired on December 11".
  - The GPT editor is read-only, with "GPT creation and editing are currently unavailable".
  - A public GPT's `/backend-api/gizmos/{id}` still returns `gizmo.instructions`, `gizmo.display.name`, `display.description` and `display.prompt_starters`, which are the fields `listGptSummaries()` reads.
- PortSmith already extracts GPTs (`src/content-scripts/chatgpt/api.ts` `listGptSummaries`) into workspaces through `buildWorkspaceFromGPT` in `src/core/transform/workspace-mapper.ts`:
  - `sourceId` is the bare GPT id (`g-...`, never `g-p-...`). Project ids start with `g-p-`.
  - `behavior.triggerPhrases` holds the conversation starters.
  - `knowledgeFiles` holds the file names only. **GPT knowledge files are not downloaded**, and that stays out of scope: it can't be tested because no account here owns a GPT.
- `src/core/transform/skill-package.ts` (merged in PR #8) has `renderSkillMd`, `toSkillName` and `skillFileName`. Reuse them.
- `fflate` is already a dependency (`unzipSync` is used in `chatgpt-adapter.ts`). Use `zipSync`/`strToU8` from it. Add no new dependency.

# SCOPE (about 30 minutes)

Create:
- `src/core/transform/gpt-backup.ts`
- `tests/unit/gpt-backup.test.ts`

Modify:
- `src/sidepanel/pages/Welcome.tsx`: a notice under the ChatGPT option.
- `src/sidepanel/pages/Review.tsx`: the backup button.
- `src/sidepanel/pages/Extract.tsx`: the empty-GPT label after retirement.
- `docs/chrome-web-store/store-listing.md`: draft text only. The release prompt publishes it.

# IMPLEMENTATION REQUIREMENTS

1. `gpt-backup.ts`, pure with no chrome APIs:
   - `GPT_RETIREMENT_DATE = "2026-12-11"`.
   - `gptsRetired(now = new Date())` returns true from 2026-12-11T00:00:00-08:00.
   - `isGptWorkspace(ws)` returns true when `ws.sourceId` matches `^g-(?!p-)[A-Za-z0-9]+`.
   - `buildGptBackupZip(workspaces, now = new Date()): Uint8Array` uses only GPT workspaces and writes:
     - `README.md`: a one-paragraph explanation of what's in the zip and that knowledge files aren't included (file names are listed per GPT), then one section per GPT with name, description, instructions in a fenced block, conversation starters as a list, and knowledge file names as a list.
     - `gpts.json`: an array of `{ id, name, description, instructions, conversationStarters, knowledgeFileNames }` with the raw (untranslated) instructions.
     - `skills/<skill-name>/SKILL.md` per GPT, from `renderSkillMd({ name, description, instructions: raw, fileNames, sourceLabel: "ChatGPT" })`. Add a `## Conversation starters` section to the SKILL.md body when there are starters.
     - When two GPTs map to the same skill name, suffix them `-2`, `-3`, and so on, so every folder is unique.
   - `gptBackupFileName(now)` returns `portsmith-gpt-backup-YYYY-MM-DD.zip`, with the date taken in America/Los_Angeles.
2. `Review.tsx`: when at least one selected-or-available workspace passes `isGptWorkspace`, show a button "Download a backup of your GPTs" above the workspace list. Under it, one line of small gray text: "Instructions, descriptions, conversation starters and file names, plus a skill file for each GPT. Knowledge files aren't included." Trigger the download the same way `DownloadButton.tsx` does (object URL plus a temporary anchor), with a `Blob` of type `application/zip`. Match the existing Tailwind styles on that page.
3. `Welcome.tsx`: under the ChatGPT option, small gray text:
   - Before retirement: "OpenAI retires custom GPTs on Dec 11. PortSmith can move each GPT's instructions and conversation starters, and save a backup."
   - After `gptsRetired()`: "OpenAI retired custom GPTs on Dec 11. Projects, memory and custom instructions still move."
4. `Extract.tsx`: when 0 GPTs are found and `gptsRetired()` is true, the step label reads "No custom GPTs found (OpenAI retired them on Dec 11)". Keep calling `listGptSummaries()` after the date, because deferred Enterprise workspaces still have GPTs until Feb 11, 2027.
5. `store-listing.md`: add a "Draft for v0.5.2 (not yet published)" section with one line for the summary area, "Rescue your custom GPTs before OpenAI retires them on Dec 11", and a What's New line: "- New: download a backup of your custom GPTs, with a skill file for each, before OpenAI retires them on Dec 11".
6. Copy rules from CLAUDE.md apply: no em dashes, and never claim something was moved that wasn't.

# ACCEPTANCE CRITERIA

- [ ] Unit tests unzip the result with `unzipSync` and check: `README.md`, `gpts.json` and one `skills/*/SKILL.md` per GPT are present; project workspaces (`g-p-...`) are excluded; two GPTs named "Helper" produce `skills/helper/` and `skills/helper-2/`; each SKILL.md starts with `---\nname: ` and includes the starters section when there are starters; `gpts.json` parses and holds the raw instructions.
- [ ] Date tests at 2026-12-10T23:59-08:00 and 2026-12-11T00:01-08:00 cover `gptsRetired`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass.

# EXCLUDES

- No GPT knowledge file downloading, no ChatGPT plugin ZIP format, and no plugins or skills reader.
- No change to extraction logic, importers or the Gemini skill code.
- No version bump, manifest change or privacy policy edit. Release 0.5.2 is a separate run after 0.5.1 is approved.
- Don't touch `portsmith-v0.5.1.zip`, the Desktop copy or `AGENTS.md`.

# GIT AND MERGE

- Branch `feat/gpt-rescue` from an up-to-date `main` (pull first). The PR #10 merge should already be on `main`. Confirm `manifest.json` says 0.5.1 before you branch, and if it doesn't, stop and report.
- Commit as `feat(chatgpt): GPT backup and Dec 11 retirement notices`, push, and open a PR against `main` titled `GPT rescue: backup zip and Dec 11 notices`.
- **Then merge it.** At 3:32pm on 11/9/26, Erik wrote in the Cowork chat: "do i really have to spell out 'finish the damn job' every time? the merge shoudl have been part of the workflow." That is a standing instruction: once typecheck, lint, tests and build pass, merge the PR yourself. Run `gh pr merge <n> --merge --delete-branch`, then `git checkout main && git pull --ff-only`. If any check fails, don't merge, and report instead.

# REPORT

The PR number and URL, the merge SHA, the test count before and after, the branch you ended on, and any decisions you made.
