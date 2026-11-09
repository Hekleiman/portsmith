# TASK

Merge PR #8 into `main` and leave the Mac's checkout on an up-to-date `main`.

# CONTEXT

- PR #8 (https://github.com/Hekleiman/portsmith/pull/8), branch `feat/gemini-skills-fallback`, adds the Gemini skill route for Gems retiring Nov 17, 2026.
- The Cowork session re-ran its checks independently on the branch head (`cff679c`): typecheck, lint, 707 tests and build all pass.
- **Merge approval:** Erik wrote "merge PR #8" in the Cowork chat at 3:18pm on 11/9/26.
- The previous dispatched run left this checkout on `feat/gemini-skills-fallback` instead of `main`. The untracked `AGENTS.md` at the root is probably why. This run was started with a smoke marker so it could run from that branch.

# STEPS

1. `git status -sb`. Confirm you're on `feat/gemini-skills-fallback`, the only untracked file is `AGENTS.md`, and nothing is modified. If anything else is dirty, stop and report it without merging.
2. `gh pr view 8 --json state,mergeable,headRefOid,baseRefName`. It should be OPEN, MERGEABLE, base `main`, head `cff679c...`. If any of these differ, stop and report.
3. `gh pr merge 8 --merge --delete-branch`. Use a merge commit, the same as PR #7.
4. `git checkout main && git pull --ff-only origin main`. Confirm that `src/core/transform/skill-package.ts` exists on `main`.
5. `npm test`. Report the count, which should be 707.

# EXCLUDES

- Don't edit, commit, move or delete `AGENTS.md`.
- No other code changes, no version bump.

# REPORT

Merge commit SHA, the branch you ended on, the test count, and anything that stopped you.
