# TASK

Ship 0.5.1: fix ChatGPT project file copying, bump the version, update the store docs, and build the upload zip. Erik uploads and submits it himself.

# CONTEXT

0.5.1 has to clear Chrome Web Store review before Nov 17, 2026, when Gemini starts turning Gems into skills. It carries:
1. The Gemini skill route that's already on `main` (PR #8, merge `7db9699`).
2. A ChatGPT file-copy bug found live by the Cowork session on 11/9/26. See Part 1.

**Precondition:** `src/core/transform/skill-package.ts` must exist on `main` and `git log -1 --format=%H 7db9699` must succeed. If either fails, stop and report.

# Part 1: fix ChatGPT knowledge file downloads (about 10 min)

**Symptom (verified live on Erik's Plus account, 11/9/26, 6 projects, every file):** `GET /backend-api/gizmos/{g-p-...}` returns `files[]` entries with these keys: `file_response_type, id, file_id, name, type, size, created_at, last_modified, location, metadata, library_file_id, file_size_tokens`. **`id` and `file_id` are different values.**
- `GET /backend-api/files/download/{id}?gizmo_id=...` → **422** `{"detail":"Invalid file_id, expected to start with 'file-' or 'file_': 6ae53..."}`
- `GET /backend-api/files/download/{file_id}?gizmo_id=...` → **200** with `download_url`, and the blob downloads (85 bytes for `portsmith-probe.md`).

`src/content-scripts/chatgpt/extractor.ts` passes `f.id` from the raw `/gizmos/{id}` response into `downloadFileBlobs()` → `downloadFileBlob(f.id, gizmoId)` (around lines 611 to 650 and 720 to 730). So every ChatGPT project file currently fails to copy and falls back to manual upload.

**Fix:**
- Where `apiFiles` comes from `apiResult.files` in `extractSingleProject`, use `file_id` when it's a string that starts with `file-` or `file_`. Otherwise fall back to `id`.
- Update the `GizmoAPIResponse` file type to include an optional `file_id`.
- Keep the downloaded file's `contentRef` stable and unique. Using whichever id was used for the download is fine.
- Add a unit test where `id: "6ae53..."` and `file_id: "file_abc"` differ, and assert that the download URL uses `file_abc`.
- If `scripts/e2e-chatgpt-autofill.mjs` or any test fixture stubs gizmo files with only `id`, add a `file_id` that differs from `id` so the stub matches the live shape.

# Part 2: version 0.5.1 (about 5 min)

Set `0.5.1` in `manifest.json`, `package.json`, both version fields at the top of `package-lock.json`, and `APP_VERSION` in `src/shared/constants.ts`. Update the "Current version" line in `CLAUDE.md` (it still says 0.4.0) to 0.5.1. Then grep the built bundle for stale `0.5.0` and `0.4.` strings and report any you find.

# Part 3: store docs (about 10 min)

- `docs/chrome-web-store/store-listing.md`:
  - The line "Into Gemini, automatically: PortSmith creates each Gem and adds the files and project memory to its knowledge" is no longer true for personal Google accounts after Nov 17. Rewrite it to say that Gems are created automatically where Gemini still offers them, and that on personal accounts, from Nov 17, PortSmith hands over a Gemini skill (with a SKILL.md file) to add by hand.
  - Add a "What's New in v0.5.1" section with exactly:
    ```
    - New: Gemini is turning Gems into skills on Nov 17. On personal Google accounts, PortSmith now gives you a ready-made skill to add, with a SKILL.md file
    - Fixed: files in ChatGPT projects weren't copied, so each one had to be uploaded by hand
    ```
- `docs/chrome-web-store/submission-sheet.md`: rewrite it for 0.5.1 in the same structure as the 0.5.0 sheet:
  - Item table, with the package size and sha256.
  - Package verification table, run against the zip itself.
  - Manifest diff against the **live 0.5.0** CRX. Download it from `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3Djgicdjjebakiobiehdfdbgkfknkidhcd%26uc`, then strip the CRX3 header: 12 bytes plus the header length stored little-endian at bytes 8 to 12.
  - The "Changes in this version" text from above.
  - If the live CRX can't be fetched, say so in the sheet and diff against `main`'s 0.5.0 manifest instead. Never claim a live diff you didn't run.
- Privacy policy (`docs/privacy-policy.html`): data handling hasn't changed. Leave it alone unless it names a version number. If it does, report that and still leave it.
- All copy follows CLAUDE.md: no em dashes.

# Part 4: build and package (about 5 min)

`npm run typecheck && npm run lint && npm test && npm run build`. Then zip `dist/` into `portsmith-v0.5.1.zip` at the repo root, the same way 0.5.0 was zipped: no `.vite/` entries, and every path that `manifest.json` references must be present. Copy the zip to `~/Desktop/portsmith-v0.5.1.zip` and confirm the sha256 matches.

# ACCEPTANCE CRITERIA

- [ ] A new unit test proves the download uses `file_id` when it differs from `id`. The full suite passes (707 plus new tests).
- [ ] The zip's manifest says 0.5.1, it has 0 `.vite` entries and 0 missing referenced paths, and the bundle contains no stale `0.5.0`.
- [ ] The permission diff against the live 0.5.0 CRX shows no added `permissions`, `host_permissions`, `optional_*` or new content-script hosts. If anything was added, stop and report before opening the PR.

# EXCLUDES

- No changes to the Gemini skill code from PR #8, the GPT extraction logic, or any importer.
- Don't touch `AGENTS.md` (untracked).
- Don't submit to the Chrome Web Store or touch the dashboard.
- Don't merge.

# GIT

Branch `release/v0.5.1` from `main`. Commit Part 1 (`fix(chatgpt): download knowledge files by file_id`) and Parts 2 and 3 (`release: v0.5.1`) separately. Push and open a PR against `main` titled `Release 0.5.1`. Put the submission sheet's verification tables in the body.

# REPORT

Branch, both commit SHAs, PR URL, test count, zip size and sha256, the result of the permission diff (and whether it ran against the live CRX), and anything you had to decide.
