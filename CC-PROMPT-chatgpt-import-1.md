# ChatGPT automatic import, part 1 of 2: the content-script importer

## TASK
Build the ChatGPT write layer: a content script that creates a ChatGPT project (name plus instructions in one call) and adds files to its Sources through ChatGPT's internal API, a helper that fits names and instructions to ChatGPT's hard limits, the typed messages for both, and unit tests. Commit and push a branch. Do not touch the orchestrator or UI (part 2 does that).

## CONTEXT
ChatGPT is guided-only as a target today (`src/core/platforms.ts:46` returns `["guided"]`). Every endpoint below was verified live on 2026-10-30 from a signed-in Plus account, by driving the real UI and then replaying each step from a page script sending only the headers `chatgptRequest` already sends (bearer token, `oai-device-id`, `oai-language`, `Content-Type`). Nothing here needs re-research. The repo's `docs/chatgpt-endpoints.md` "Write API" section is from 2026-09-20 and is now WRONG in two places (see "What changed" below); part 2 updates the doc.

Mirror the Gemini importer's structure: `src/content-scripts/gemini/importer.ts` (handlers at the bottom, `initMessageRouter()` then `onMessage(...)`) and its result types in `src/core/adapters/gemini-import-types.ts`. Requests go through `chatgptRequest` in `src/content-scripts/chatgpt/api.ts`, which already handles the bearer token, a 401 refresh and 429 back-off.

## THE CONTRACT (verified 2026-10-30)

**Create project, one call:** `POST /backend-api/projects` with JSON
`{"emoji":null,"instructions":"<text>","memory_scope":"unset","name":"<name>","theme":null}`
200 → `{ resource: { gizmo: { id: "g-p-<32 hex>", instructions, ... }, files, ... } }`. The new id is `resource.gizmo.id` (validate with `isProjectGizmoId`). The response echoes `resource.gizmo.instructions`; compare it to what was sent and report a mismatch as a failure with the project id set (the project exists).

**Hard limits** (server-side Pydantic, HTTP 422, nothing is created): `name` max **50**, `instructions` max **8000**, both counted in **Unicode code points** (`[...s].length`), not UTF-16 units: a string with JS `.length` 8001 containing one emoji was accepted. 422 body: `{"detail":[{"type":"string_too_long","loc":["body","instructions"],"msg":"...","ctx":{"max_length":8000}}]}`. An empty name passed validation.

**Add a file to Sources, FOUR steps** (all four are required):
1. `POST /backend-api/files` JSON `{"file_name","file_size":<bytes>,"gizmo_id":"g-p-...","mime_type","reset_rate_limits":false,"supports_direct_azure_multipart":true,"timezone_offset_min":<new Date().getTimezoneOffset()>,"use_case":"gizmo"}` → 200 `{ status: "success", upload_url, file_id: "file_<hex>" }`. Over 512 MiB (536,870,912 bytes is accepted, one more is not) → 400 `{detail:{code:"file_too_large"}}`.
2. `PUT <upload_url>` with the raw bytes and headers `Content-Type: <mime>`, `x-ms-blob-type: BlockBlob`, `x-ms-version: 2020-04-08`, `x-ms-blob-content-type: <mime>` → 201, empty body. Host is `sdmntpr<region>.oaiusercontent.com` with a SAS query string: take it from step 1, never build it. **Use plain `fetch`, NOT `chatgptRequest`: the bearer token must never be sent to oaiusercontent.com.** Verified to work from a chatgpt.com page context (Azure CORS allows that origin), so a content script can do it.
3. `POST /backend-api/files/process_upload_stream` JSON `{"entry_surface":"project_sources","file_id","file_name","gizmo_id","index_for_retrieval":true,"mime_type","use_case":"gizmo"}` → 200 with content-type `text/event-stream`, but the body is **newline-delimited JSON objects** (no `data:` prefix). Events in order: `file.processing.started`, a "ready to download" event (`file.processing.file_…`, name partly masked in the capture), `file.indexing.completed`, `file.processing.completed` (message "Succeeded processing file ..."). Success means a `file.processing.completed` event was seen; a body ending without it is a failure. `chatgptRequest` JSON-parses every body and will throw on this one, so add a text-returning variant in `api.ts` (same token, 401 and 429 handling; refactor the shared loop rather than copying it).
4. `POST /backend-api/projects/{gizmo_id}/files` JSON `{"files":[{"file_id","last_modified":<Date.now()>,"location":"fs","name","size","type":"<mime>"}]}` → 200 `{ resource: { gizmo, files: [...] } }`. This step is NEW since September: without it the file is processed but never appears in the project (verified both ways). It APPENDS (sending one file kept the earlier one). `resource.files` is the project's full list afterwards; confirm the new `file_id` is in it.

**What changed since the 2026-09-20 doc:** `use_case` is `"gizmo"` (was `"agent"`); `selection_method`, `client_resolved_mime_type` and `metadata` are no longer sent; step 4 is new.

**Duplicate check:** `listProjectSummaries()` in `api.ts` lists a just-created project immediately. Match names with `nameKey()`.

## SCOPE
Branch: `feat/chatgpt-autofill` from `origin/main`.

- **Create** `src/core/transform/chatgpt-limits.ts`:
  - `export const CHATGPT_PROJECT_NAME_MAX = 50; export const CHATGPT_INSTRUCTIONS_MAX = 8000;`
  - `fitProjectName(name: string): { name: string; trimmed: boolean }`: trim whitespace; if over 50 code points, cut at the last space at or before 49 code points, drop trailing punctuation, append "…" (total ≤ 50); hard-cut at 49 + "…" when there is no space.
  - `fitInstructions(text: string, sourceLabel: string): { instructions: string; overflow: { fileName: string; content: string } | null }`: unchanged when ≤ 8000 code points. Otherwise `overflow.fileName` is `full-instructions-from-<slug>.md` (slug of `sourceLabel`, lowercase, non-alphanumerics to `-`), `overflow.content` is the full original text under a one-line heading, and `instructions` is the text cut at the last blank line (else last newline, else last space) such that the cut text plus `\n\n` plus the pointer line `The full instructions are in the project file <fileName>.` is ≤ 8000 code points. Never split a surrogate pair.
- **Create** `src/core/adapters/chatgpt-import-types.ts`: `ChatGPTProjectConfig { name; instructions }`, `ChatGPTCreateResult { success; gizmoId?; error?; maybeCreated?; instructionsMismatch? }`, `ChatGPTUploadResult { success; fileId?; error?; step?: "reserve" | "upload" | "process" | "attach" }`.
- **Edit** `src/content-scripts/chatgpt/api.ts`: the text-returning request variant described above, and `readValidationError(err: ChatGPTApiError): string | null` that turns a 422 `detail[]` into a short sentence ("ChatGPT allows at most 50 characters in a project name").
- **Create** `src/content-scripts/chatgpt/importer.ts`: `createProject(config)`, `uploadProjectFile({ gizmoId, fileName, mimeType, base64 })` (the four steps; `base64ToBytes` from `@/shared/encoding`), `findProjectsNamed(name): Promise<string[] | null>` (null when listing fails). Refuse in code, before any request, a name over 50 or instructions over 8000 code points, and a file over 512 MiB, with a clear error. A network error or 5xx on create returns `maybeCreated: true`, as Gemini's does. Handlers at the bottom: `initMessageRouter()`, then `CHATGPT_CREATE_PROJECT`, `CHATGPT_UPLOAD_PROJECT_FILE`, `CHATGPT_FIND_PROJECTS`; end with the same "content script loaded" log line the other importers use. Never log or return the token, the `upload_url`, or any response body that could contain them.
- **Edit** `src/shared/messaging.ts`: the three message types (request and response typed from the new types file; `CHATGPT_FIND_PROJECTS` is `{ name } → { success; gizmoIds?; error? }`) and timeouts: create 60_000, upload 180_000, find 60_000.
- **Edit** `manifest.json`: a second `chatgpt.com/*` content-script entry for `src/content-scripts/chatgpt/importer.ts`, after the extractor's, the way Claude and Gemini each have two. No new permissions or hosts (the PUT is a CORS request from the page origin and needs none).
- **Create** `tests/unit/chatgpt-limits.test.ts` and `tests/unit/chatgpt-importer.test.ts`. Reuse the fetch-stub pattern from `tests/unit/chatgpt-api.test.ts`. Fixtures inline, redacted (`g-p-` + 32 `a`, `file_` + hex, `https://sdmntprwestus.oaiusercontent.com/files/x/raw?sig=REDACTED`).

## ACCEPTANCE CRITERIA
- [ ] `fitProjectName`: a 51-code-point name comes back ≤ 50 with `trimmed: true`; a 50-code-point name is unchanged; an emoji at the cut is never split.
- [ ] `fitInstructions`: 8000 code points with one emoji (JS length 8001) passes through unchanged with `overflow: null`; 9000 returns ≤ 8000 code points ending in the pointer line, and `overflow.content` holds the full original text.
- [ ] `createProject` sends exactly the create body above and returns `resource.gizmo.id`; a 422 returns `success: false` with the readable sentence and no `maybeCreated`; a 500 or thrown fetch returns `maybeCreated: true`; an echoed-instructions mismatch returns `success: false`, `gizmoId` set, `instructionsMismatch: true`.
- [ ] `uploadProjectFile` makes the four calls in order with the bodies above; the PUT carries no `Authorization` header (assert it); a stream without `file.processing.completed` fails at `step: "process"` and step 4 is not called; a step-4 response whose `resource.files` lacks the `file_id` fails at `step: "attach"`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass, and the built `dist/manifest.json` lists the new content script.

## EXCLUDES
- No changes to `migration-orchestrator.ts`, `platforms.ts`, side panel pages, `chatgpt-guided.ts` or docs (part 2).
- No delete-project call, no memories or custom-instructions writes.
- No version bump. No new dependencies.
- No live requests to chatgpt.com from the run.

## FINISH
Commit in logical commits, push `feat/chatgpt-autofill` to origin. Do not open a PR and do not merge. Leave the tree clean. End your report with: the commit list, the test count before and after, and anything in the contract above that the code could not follow and why.
