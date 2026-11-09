# TASK

Allow Claude to Claude migration between two different Claude accounts (for example, a Sign in with Apple "Hide My Email" account into the account with the user's real email), with a hard guard that never writes into the account the data was copied from. Then merge the PR.

# CONTEXT

- Claude doesn't let users change their account email or merge accounts, and personal projects can't be shared or transferred (support.claude.com article 8452276 and the data export article, read 11/8/26). PortSmith can fill that gap: it already extracts Claude projects, instructions, text docs, project memory, global memory and "Instructions for Claude", and it already writes Claude projects.
- Today same-platform runs are blocked in `src/sidepanel/store/migration-store.ts` (`setSourcePlatform` and `setTargetPlatform` both return early when `platform === sourcePlatform`) and in `src/sidepanel/pages/TargetSelect.tsx` (`available = PLATFORMS.filter((p) => p.id !== sourcePlatform)`). They're blocked because a Claude to Claude run into the same account duplicated everything.
- Extracted data lives in the extension's IndexedDB, not in the site's session, so the user can extract from account A, sign out of claude.ai, sign in to account B and import.
- Verified live on 11/9/26 on Erik's claude.ai session: `GET https://claude.ai/api/account` (same-origin, cookies only, like the rest of `src/content-scripts/claude/api.ts`) returns 200 with keys including `uuid`, `email_address`, `full_name`, `display_name` and `memberships`. The org comes from the `lastActiveOrg` cookie, as now.

# SCOPE (about 30 to 40 minutes)

Modify:
- `src/content-scripts/claude/api.ts`: add `getClaudeAccount()`.
- `src/content-scripts/claude/extractor.ts`: record the source account during extraction.
- `src/content-scripts/claude/importer.ts`: a `CLAUDE_GET_ACCOUNT` handler.
- `src/shared/messaging.ts`: the message type.
- `src/core/schema/types.ts`: optional source account fields.
- `src/sidepanel/store/migration-store.ts` and `src/sidepanel/pages/TargetSelect.tsx`: allow Claude to Claude only.
- `src/background/migration-orchestrator.ts`: the account guard step.
- `docs/privacy-policy.html`: a disclosure, because PortSmith now reads the account ID and email.
- `scripts/e2e-claude-autofill.mjs`: stub `/api/account` if the run now calls it.

Create: `src/core/transform/account-guard.ts` and `tests/unit/account-guard.test.ts`.

# IMPLEMENTATION REQUIREMENTS

1. **Account identity.** `getClaudeAccount(): Promise<{ uuid: string; email: string } | null>` reads `/api/account` through the existing request helper. Return null when the request fails or either field is missing.
2. **Recording the source.** Add optional `accountId: string` and `accountLabel: string` to `PlatformIdentifierSchema` so older manifests still validate. Claude extraction fills them: `accountLabel` is the masked email (first character, `***`, `@domain`, for example `e***@gmail.com` or `h***@privaterelay.appleid.com`). Never store the full email.
3. **`account-guard.ts`** (pure functions):
   - `maskEmail(email)`.
   - `checkTargetAccount(source: { accountId?: string }, current: { uuid: string } | null): "ok" | "same-account" | "unknown-current" | "unknown-source"`.
4. **Enabling it in the UI.**
   - When the source is `claude`, the target list also offers Claude, labelled "Claude (another account)" with the description "Move projects into a different Claude account. You'll switch accounts before anything is written."
   - ChatGPT to ChatGPT and Gemini to Gemini stay blocked.
   - `setTargetPlatform("claude")` with source `claude` is allowed, and `setSourcePlatform` must not clear a Claude target when the source is Claude.
5. **The guard in the orchestrator.** When source and target are both `claude`, check the account before the first write (before any create, upload or doc call):
   - Ask the Claude tab for `CLAUDE_GET_ACCOUNT` and run `checkTargetAccount`.
   - `"ok"`: continue. Log the masked labels only, never full emails.
   - `"same-account"`: show a pending step titled "Switch to the Claude account you're moving into", described as "You're signed in to <source label>, the account PortSmith copied from. Sign out of claude.ai, sign in to the account you're moving to in this browser, then click "I've switched"." Use `confirmLabel: "I've switched"` and `skipLabel: "Stop"`, through the existing `waitForConfirmation` pattern. On confirm, re-read the account and check again, looping until it's "ok" or the user stops. On stop, end the run with nothing written.
   - `"unknown-current"`: stop with "PortSmith couldn't read which Claude account is signed in, so nothing was written. Open claude.ai, make sure you're signed in, and try again."
   - `"unknown-source"`: stop with "This data was copied before PortSmith recorded which account it came from. Copy it again from the original account, then switch accounts."
   - The guard fails closed: nothing is written unless the result is "ok".
6. **Same-platform details.** For Claude to Claude, deliver the raw instructions with no translation, and keep the existing name check before every create.
7. **Privacy policy.** In the section that lists what PortSmith reads from Claude, add: "Your Claude account ID and a shortened form of your email address (for example e***@gmail.com), so that a move between two Claude accounts never writes into the account it copied from. These stay in the extension's storage on your computer and are deleted with the rest of your saved data." Keep the policy's existing style and dates as they are. Release handles the version.
8. Copy rules from CLAUDE.md apply: no em dashes.

# ACCEPTANCE CRITERIA

- [ ] Unit tests cover:
  - `checkTargetAccount` returns all four results.
  - `maskEmail` handles a normal address, a privaterelay address, and an address with a one-character local part.
  - The store allows Claude to Claude and still rejects ChatGPT to ChatGPT and Gemini to Gemini.
- [ ] An orchestrator test with a stubbed `CLAUDE_GET_ACCOUNT`:
  - With the same uuid as the source, no create or upload message is sent and the run waits on the switch step.
  - After the stub returns a different uuid and the step is confirmed, the create proceeds.
  - With a null account, the run stops and nothing is written.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass. If you touched `scripts/e2e-claude-autofill.mjs`, run it against `dist` (`npm i --no-save playwright` first; Chromium can be pointed at with `CHROMIUM_PATH` if needed) and report the result. If you can't run it, say why.

# EXCLUDES

- No ChatGPT to ChatGPT or Gemini to Gemini.
- No copying of binary files, styles or skills (later prompts).
- No version bump or store listing edits. A separate release run handles 0.5.2 after 0.5.1 is approved.
- Don't touch `portsmith-v0.5.1.zip`, the Desktop copy or `AGENTS.md`.

# GIT AND MERGE

- Pull `main` first. It should contain the GPT rescue PR. If `src/core/transform/gpt-backup.ts` isn't on `main`, continue anyway but say so in the report.
- Branch `feat/claude-same-platform`. Commit as `feat(claude): Claude to Claude migration between accounts, with account guard`, push, and open a PR against `main`.
- **Then merge it.** At 3:32pm on 11/9/26, Erik wrote in the Cowork chat: "do i really have to spell out 'finish the damn job' every time? the merge shoudl have been part of the workflow." That is a standing instruction: once typecheck, lint, tests and build pass, merge with `gh pr merge <n> --merge --delete-branch`, then `git checkout main && git pull --ff-only`. If any check fails, don't merge, and report instead.

# REPORT

The PR number and URL, the merge SHA, the test count before and after, the e2e result, the branch you ended on, and the decisions you made.
