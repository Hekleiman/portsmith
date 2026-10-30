# ChatGPT automatic import, fix from review: message size cap headroom

## TASK
Lower `MAX_MESSAGE_FILE_BYTES` so a file at the cap actually fits through one extension message, on the existing PR #6 branch. One small commit, push, no merge.

## CONTEXT (settled, do not re-research)
- Chromium's extension message limit is `kMaxMessageLength = 1024 * 1024 * 64` (`extensions/renderer/messaging_util.cc`); a longer serialized message fails with "Message length exceeded maximum allowed length".
- `src/shared/constants.ts` sets `MAX_MESSAGE_FILE_BYTES = 48 * 1024 * 1024`. Base64 of exactly 48 MiB is exactly 64 MiB of text, and the JSON envelope (`__portsmith`, `type`, file name, mime type) pushes a file at or just under the cap over the limit. Part 2's own report called this out.
- `tests/unit/chatgpt-guided.test.ts:182` asserts `(MAX_MESSAGE_FILE_BYTES * 4) / 3 <= 64 MiB`, which passes at equality and so does not catch it.
- Review of the rest of PR #6 found nothing else to change: 690 unit tests and all four stubbed E2E scripts pass on a fresh clone, and the built importer was run live against chatgpt.com on 2026-10-30 (fitted 63-character name to 46, 14,691-character instructions to 7,988 plus the overflow file, created the project, uploaded the overflow file, a project memory document and a PNG through all four steps, all three visible in Sources, duplicate lookup found it afterwards).

## SCOPE
Branch `feat/chatgpt-autofill` (`git fetch origin && git checkout feat/chatgpt-autofill && git pull --ff-only`).
- `src/shared/constants.ts`: `MAX_MESSAGE_FILE_BYTES = 47 * 1024 * 1024` (base64 is then about 62.7 MiB, leaving over 1 MiB for the envelope). Update the comment to say why 47, not 48. Change `TOO_LARGE_FOR_MESSAGE` to say "over 47 MB".
- `tests/unit/chatgpt-guided.test.ts:182`: assert `Math.ceil(MAX_MESSAGE_FILE_BYTES / 3) * 4 + 1024 * 1024 <= 64 * 1024 * 1024` (base64 length plus 1 MiB of envelope headroom).
- Grep for any other "48 MB" / "48 MiB" text (code, tests, docs, the PR description via `gh pr view 6`) and update it to 47.

## ACCEPTANCE CRITERIA
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- [ ] No "48 MB" or "48 MiB" left in `src/`, `tests/`, `docs/`, `README.md`, `CLAUDE.md`.

## EXCLUDES
- No other changes. No merge. No version bump.

## FINISH
Commit `fix(messaging): leave room for the message envelope under Chrome's 64 MiB cap`, push, and if the PR body mentions 48 MB update it with `gh pr edit 6`. Leave the tree clean. Report the commit hash and test count.
