# PortSmith 0.5.0 release prep: version, policy, listing copy, store package

## TASK
Prepare PortSmith 0.5.0 for Chrome Web Store submission: bump the version, update the privacy policy and store docs for automatic ChatGPT import, build and verify the store zip, copy it to Erik's Desktop, and open a release PR. Do not merge and do not submit.

## CONTEXT (settled from the Cowork seat on 2026-10-30; do not re-research)
- `main` is at `9c33ad8` (PR #6 merged: ChatGPT as an automatic target). 690 tests pass there.
- The live store package is **0.4.0** (downloaded the served CRX on 2026-10-30 and read its manifest). 0.4.1 was never published, so this release carries both the 0.4.1 ChatGPT extraction fix and the new ChatGPT import. **Version: 0.5.0** (new feature, minor bump).
- The privacy policy is served by GitHub Pages from `main:/docs` at https://hekleiman.github.io/portsmith/privacy-policy.html, so it goes live when the release PR merges.
- Its current text is wrong for this release: under "What PortSmith writes" the ChatGPT bullet says "nothing. PortSmith shows the steps...", and "What PortSmith sends over the network" does not mention ChatGPT's file storage. Since PR #6, uploads go from the ChatGPT tab to an `sdmntpr<region>.oaiusercontent.com` URL that ChatGPT returns for each upload (no bearer token is sent there).
- Permissions and host permissions are unchanged from 0.4.0 (`storage`, `sidePanel`, `scripting`; chatgpt.com, claude.ai, gemini.google.com). The only manifest change besides the version is a second `chatgpt.com/*` content-script entry, the same host, so no new permission warning and no disable on auto-update.
- Erik has an older uncommitted privacy-policy edit stashed on this Mac as "privacy policy 0.4.1 wording". It is superseded by this prompt's text. Leave the stash alone (do not pop or drop it).

## SCOPE
Branch `release/v0.5.0` from `origin/main`.

1. **Version 0.5.0** in `manifest.json`, `package.json` (and `package-lock.json`'s root entries) and `src/shared/constants.ts` (`APP_VERSION`). Fix any test that pins the version string.
2. **`docs/privacy-policy.html`**:
   - Effective-date line: `Effective date: October 30, 2026 (version 0.5.0)`.
   - Replace the ChatGPT bullet under "What PortSmith writes" with: `<li><strong>ChatGPT:</strong> creates projects with their name and instructions, and adds the copied knowledge files and a project memory document to each project's Sources. When the instructions are longer than ChatGPT allows, it shortens them at a paragraph break and adds the full text as a file. Memories and custom instructions are not written: PortSmith shows the steps and the text to copy</li>`
   - In "What PortSmith sends over the network", after the Gemini upload sentence add: `When ChatGPT is the target, knowledge files are uploaded from the ChatGPT tab to ChatGPT's own file storage, at an oaiusercontent.com address that ChatGPT provides for each upload. Your ChatGPT session token is not sent there.`
   - Footer: `PortSmith v0.5.0 privacy policy. Last updated October 30, 2026.`
   - Read the rest of the policy for any other sentence that says ChatGPT is guided-only or that PortSmith writes nothing to ChatGPT, and fix it to match. No em dashes.
3. **`docs/chrome-web-store/store-listing.md`**: title to v0.5.0. In the full description, replace `- Into ChatGPT, step by step: PortSmith shows each step with copy and download buttons` with `- Into ChatGPT, automatically: PortSmith creates each project, sets the instructions and adds the files and project memory to its Sources`, and change the memory sentence to end `...or through Claude's own memory import in one paste. Into ChatGPT, memories and custom instructions are added step by step.` Replace the "What's New in v0.4.0" block with "What's New in v0.5.0":
   ```
   - New: automatic migration into ChatGPT: projects, instructions, files and project memory
   - New: names and instructions longer than ChatGPT allows are shortened, and the full instructions are kept as a project file
   - Fixed: ChatGPT projects and custom GPTs were not found, so extraction stopped with nothing to migrate
   - Fixed: PortSmith reported "Not logged in to ChatGPT" on a signed-in account
   - Improved: reading from ChatGPT works from any ChatGPT page
   - Improved: files too large to pass through the extension are listed for manual upload instead of failing
   ```
   Keep the short description at 132 characters or fewer.
4. **`docs/chrome-web-store/submission-sheet.md`**: rewrite for 0.5.0 in the same structure: package name, size, sha256, built-from commit; the package verification table re-run against the new zip; a "manifest diff vs live 0.4.0" table (download the live CRX from `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3Djgicdjjebakiobiehdfdbgkfknkidhcd%26uc`, strip the CRX3 header: 12 bytes plus the header length at bytes 8 to 12, unzip, compare `permissions`, `host_permissions`, `content_scripts[].matches`); the "Changes in this version" block (the What's New text above); and a short dashboard checklist: Package tab upload, Store listing tab (paste the full description, What's New), Privacy tab unchanged unless the dashboard asks about the new behaviour, then Submit for review.
5. **Build and package**: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then `node scripts/e2e-chatgpt-autofill.mjs dist` (and the other three E2E scripts) with `npm i --no-save playwright && npx playwright install chromium`. Zip `dist/` contents (manifest.json at the zip root, no `.vite/`) as `portsmith-v0.5.0.zip` in the repo root (gitignored). Verify: manifest version 0.5.0 inside the zip, every path the manifest references exists, no stale `0.4.0`/`0.4.1` string in the package. Then `cp portsmith-v0.5.0.zip ~/Desktop/`.

## ACCEPTANCE CRITERIA
- [ ] All gates and all four E2E scripts pass; test count reported.
- [ ] `~/Desktop/portsmith-v0.5.0.zip` exists and its sha256 matches the submission sheet.
- [ ] The manifest diff vs live 0.4.0 shows no added permission or host.
- [ ] One PR, `release/v0.5.0` to `main`, titled "Release 0.5.0: ChatGPT as an automatic target", body listing the version files, policy and listing changes, the zip sha256 and the manifest diff.

## EXCLUDES
- Do not merge. Do not submit to the store. No code changes beyond the version constant and tests pinning it.
- Do not touch Erik's stash.

## FINISH
Push the branch, open the PR, leave the tree clean (the run returns to `main`). Report the PR number, the zip size and sha256, the test count, and anything you could not do.
