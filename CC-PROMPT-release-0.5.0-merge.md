# PortSmith 0.5.0: merge the release PR and confirm the policy is live

## TASK
Merge PR #7 (`release/v0.5.0`) into `main`, confirm `main` passes the gates, and confirm the GitHub Pages privacy policy shows version 0.5.0. No other changes.

## CONTEXT
PR #7 was prepared by the previous run: version 0.5.0, privacy policy and store-listing updates, submission sheet, zip `portsmith-v0.5.0.zip` (sha256 `ced06cdeeb9672e31f12a8575f1583f365e9d6ad0a3ddb981914ea4f5c51394e`, also on the Desktop). 690 tests and all four E2E scripts passed on the branch. The policy must be live before the store submission, and Pages serves `main:/docs`.

## SCOPE
1. `git fetch origin && git checkout main && git pull --ff-only`.
2. `gh pr merge 7 --merge --delete-branch=false`. If GitHub refuses, stop and report why; do not force.
3. `git pull --ff-only`, then `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.
4. Poll https://hekleiman.github.io/portsmith/privacy-policy.html (with a cache-busting query) every 30 seconds for up to 10 minutes until it contains "version 0.5.0"; report what it shows.
5. Rebuild the zip from `main` exactly as the previous run did and confirm its sha256 equals `ced06cde...394e`. If it differs, report both hashes and the file-level difference; do not replace the Desktop copy.

## EXCLUDES
No code or doc changes, no version change, no store submission.

## FINISH
Tree clean on `main`. Report the merge commit, test count, the live policy's effective-date line, and the zip hash comparison.
