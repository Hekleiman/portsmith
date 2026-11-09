# TASK

Merge PR #10 (Release 0.5.1) into `main` and leave the Mac's checkout on an up-to-date `main`.

# CONTEXT

- PR #10 (https://github.com/Hekleiman/portsmith/pull/10), branch `release/v0.5.1`.
- The Cowork session re-ran 711 tests on the branch, and they all passed. It also live-tested the `file_id` download fix against Erik's ChatGPT projects: 10 of 10 files downloaded.
- **Merge approval:** at 3:32pm on 11/9/26, Erik wrote in the Cowork chat: "do i really have to spell out 'finish the damn job' every time? the merge shoudl have been part of the workflow." That's a standing instruction: once checks pass, merging the PR is part of the job.
- The checkout is on `release/v0.5.1`. This run was started with a smoke marker for that reason.

# STEPS

1. Run `git status -sb`. You should be on `release/v0.5.1` with no changes, nothing untracked showing, and the branch in sync with origin. If not, stop and report.
2. Run `gh pr view 10 --json state,mergeable,baseRefName,headRefOid,statusCheckRollup`. It should be OPEN, MERGEABLE, with base `main`. If any check is failing, stop and report.
3. Run `gh pr merge 10 --merge --delete-branch`.
4. Run `git checkout main && git pull --ff-only origin main`. Confirm that `src/content-scripts/chatgpt/file-download.ts` exists and that `manifest.json` says 0.5.1.
5. Run `npm test`. Expect 711.

# EXCLUDES

No code changes. Don't touch `portsmith-v0.5.1.zip` or the Desktop copy, because Erik uploads that exact file.

# REPORT

The merge SHA, the branch you ended on, and the test count.
