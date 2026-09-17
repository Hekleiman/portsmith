# ChatGPT endpoints PortSmith depends on

**Status: not observed live yet.** On 2026-09-17, the browser automation used for the Claude and Gemini checks (see `live-contract-checks.md`) could not open chatgpt.com: each navigation stayed on the New Tab page. Nothing below has been confirmed against a live account.

This page lists what the code expects, so the check can be done by hand in DevTools. It needs about 10 minutes, and only GET requests are involved. Fill in the "Observed" column, and use redacted examples only.

---

## What the code expects

| # | Item | Code | Expected |
|---|------|------|----------|
| 1 | Project URLs | `src/shared/chatgpt-ids.ts`, `scanSidebar` and `extractSingleProject` in `src/content-scripts/chatgpt/extractor.ts` | Sidebar link `/g/g-p-<32 hex>-<slug>/project`. The page URL is the same. The extractor reads the page only when the path matches `^/g/<bare id>(-<slug>)?/project/?$`. Other code still matches the older `/project/<id>` form. |
| 2 | Project details | `FETCH_GIZMO_API` in `src/background/service-worker.ts` | `GET /backend-api/gizmos/{bare id}` with `Authorization: Bearer <accessToken from GET /api/auth/session>`. The bare ID is tried first, then the ID with its slug (only after a 404). The extractor reads `gizmo.instructions`, `gizmo.display.name`, `gizmo.display.description` and `files[]` with `id, name, type, size`. |
| 3 | File download | `downloadFileBlob` in the extractor | `GET /backend-api/files/download/{file_id}?gizmo_id={id}` returns `{download_url}`. `GET /backend-api/files/{file_id}/simple?gizmo_id={id}` returns `{file_name, mime_type}`. Then the extractor fetches `download_url`. |
| 4 | Memories | none (read from the Settings > Personalization > Memory UI) | No API use today |
| 5 | Workspace header | none | No `ChatGPT-Account-Id` header is sent today |

## How to check (read-only)

1. Open chatgpt.com and DevTools, go to the Network panel, and filter by `backend-api`.
2. Hover a project in the sidebar and note the link, redacting the hex and slug. Open the project and note the page path.
3. Reload the project page. Find the `gizmos/` request and note its path (bare ID or with slug), the status and the top-level keys. Under `gizmo`, check that `instructions` and `display` exist. Under `files[]`, note the item keys.
4. In the project's files list, open or download one file. Note the requests and the response keys.
5. Open Settings > Personalization > Manage memories. Note any `memories` request (path, query and top-level keys) and the keys of one item. Don't copy the text.
6. Open Customize ChatGPT. Note the request that loads custom instructions (likely `user_system_messages`) and its keys.
7. If a Team or Enterprise workspace is available, switch to it and repeat step 3. Note whether requests carry a `ChatGPT-Account-Id` header, and what happens without it (for example, 404 or the personal workspace's data).

## Observed

| # | Request | Status | Keys | Notes |
|---|---------|--------|------|-------|
| 1 | Sidebar link / page path | | | |
| 2 | `GET /backend-api/gizmos/...` | | | |
| 3 | File download requests | | | |
| 4 | Memories request | | | |
| 4b | Custom instructions request | | | |
| 5 | `ChatGPT-Account-Id` | | | |

## Proposal: read memories and custom instructions via the API

Only apply this after step 4 of the check confirms the endpoints.

1. Add a `FETCH_CHATGPT_PERSONALIZATION` handler in the service worker next to `FETCH_GIZMO_API`. It should use the same cached bearer token, run in the MAIN world, and accept only requests from the ChatGPT content script.
2. **Memories:** `GET /backend-api/memories` (with whatever query the UI sends). Map each item's text and update time to a `MemoryItem`. If the response is paged, follow the cursor until it's done or a cap of 1,000 is reached.
3. **Custom instructions:** `GET /backend-api/user_system_messages`. Map the "about you" and "how to respond" fields to `globalInstructions`, and skip the fields that are turned off.
4. **Workspaces:** if step 5 shows the header is required, read the current account from `/backend-api/accounts/check` or from the page, and send `ChatGPT-Account-Id` on every call (gizmos, files, memories).
5. Keep the settings UI reader as the fallback. When an API call fails, add a warning and fall back to the UI. Don't fail the extraction.
6. **Tests:** add unit tests with recorded, redacted response fixtures in `tests/fixtures/`.
