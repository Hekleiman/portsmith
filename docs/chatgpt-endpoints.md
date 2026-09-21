# ChatGPT endpoints PortSmith depends on

**Status: observed live on 2026-09-20**, in a signed-in chatgpt.com tab, read-only GETs only. See "Observed" below. The earlier note that chatgpt.com could not be opened no longer applies.

This page lists what the code expects, then what was actually observed. Use redacted examples only.

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

Checked on 2026-09-20 against a signed-in personal account. Read-only GETs only;
nothing was created, changed or deleted. Values are redacted.

### Auth

`GET /api/auth/session` returns 200 with `accessToken`, a three-part JWT of about
1.9 KB whose `exp` claim is 10 days out. The sibling `expires` field is the
**session** expiry (90 days), not the token's, so it must not be used as a cache
expiry. Top-level keys: `WARNING_BANNER`, `accessToken`, `account`, `authProvider`,
`expires`, `rumViewTags`, `sessionToken`, `user`.

Cookies alone are **not** enough. Measured against
`GET /backend-api/memories?include_memory_entries=false`:

| Request | Status |
|---|---|
| cookies only, no headers | 401 |
| `authorization` alone | 200 |
| `authorization` + `oai-*` headers | 200 |
| `authorization` with a junk token | 401 |

So the bearer token is the only gate; the `oai-*` headers the web app sends are not
required for reads. A 401 means a stale token, which is why `chatgptRequest` refreshes
once and retries. No `/backend-api/sentinel/*` proof-of-work token is involved.

`oai-device-id` comes from the `oai-did` cookie (a 36-char UUID, also mirrored in
localStorage).

### Projects

`GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&limit=20` returns
`{ items: [ { gizmo: { id, display: { name }, instructions, ... }, files, tools, ... } ], cursor }`.
Returned 14 projects in about 733 ms. Every `items[].gizmo.id` matched
`^g-p-[0-9a-f]{32}$`.

Paging: pass the previous response's `cursor` back as `&cursor=`. Confirmed with
`limit=5`: page 2 returned distinct items. `cursor` comes back null at the end.

`limit` has a ceiling: 20, 21 and 50 returned 200, **100 returned 422**. PortSmith
uses 20.

### The sidebar DOM no longer carries projects

This is why discovery moved to the API. On a signed-in account:

| Selector | Matches |
|---|---|
| `a[href$="/project"]` | 0 |
| `nav a[href$="/project"]` | 0 |
| any anchor containing `g-p-` | 0 |
| `[data-testid="profile-button"]` | 0 (renamed `accounts-profile-button`) |
| `button[aria-label='Open Profile Menu']` | 0 |
| `nav` anchor count (login last resort needs 3) | 1 |

Projects render as `<button aria-label="Open project home">` under a "Projects"
section with a "Show more" control. Names survive in
`aria-label="Open project options for <name>"`, but **no gizmo ID appears in the DOM
at all**, so no selector change can restore discovery.
`PROJECT_SIDEBAR.projectLinks` and `GPT_LIST.gptCards` are both dead for this reason.

The only href patterns left in the sidebar are `/`, `/images`,
`/library?entry_point=sidebar`, `/scheduled`, `/plugins`, `/codex` and `/c/<conversation>`.

The **page** URL is unchanged and still matches what the code expects: `https://chatgpt.com/g/g-p-<32 hex>/project`, plus `?tab=sources` for the Sources tab. So `extractSingleProject()`, which is driven by a gizmo ID rather than by the link, is unaffected. The breakage is scoped to discovery.

### Custom GPTs: which endpoint lists them

`/backend-api/gizmos/bootstrap` is **not** the right source: it returns
`{ gizmos: [ { flair, resource } ] }` and gave only 1 entry, which looks like recency
or pinning rather than a listing.

The listing endpoint is **`GET /backend-api/gizmos/mine`**:

```
{ cuts: [ { info: { id, title, description, display_group, display_type, locale },
            list: { items: [ { resource: { gizmo, files, tools, ... } } ], cursor } } ],
  locale, workspace_filtered }
```

- `cuts[].info.id` is `"mine"` (title "My GPTs") or `"recent"` (title "Recently Used").
- **Use the `mine` cut.** On this account it held 1 GPT; `recent` held 3, which
  includes GPTs the user does not own.
- Items are nested one level deeper than the projects listing:
  `cuts[].list.items[].resource.gizmo`, not `items[].gizmo`.
- `/backend-api/gizmos/discovery/mine` returns **404**.

#### `gizmo.display`, as observed

Checked on 2026-09-20 against a real GPT. Field names and value types only:

| Field | Type | Populated |
|---|---|---|
| `name` | string | yes |
| `description` | string | yes |
| `prompt_starters` | string[] | yes (4 entries) |
| `categories` | array | empty |
| `emoji` | null | no |
| `theme` | null | no |
| `profile_pic_id` | string | yes |
| `profile_picture_url` | string | yes |

`instructions` is a populated string on `gizmo` itself, not under `display`. There is
no other conversation-starter field on `gizmo`: `prompt_starters` under `display` is
the only one. `gizmo.gizmo_type` is `"gpt"`. The GPT's `id` matched `^g-[A-Za-z0-9]{9}$`.

PortSmith maps `display.name`, `display.description`, `display.prompt_starters` and
`gizmo.instructions` into `ExtractedCustomGPT`, and leaves anything absent empty.

`resource.files` is an array, but it was **empty** on the only GPT available, so the
item shape is unverified for GPTs. The parser reads a string `name` off each entry and
skips the rest, matching the projects listing's `files[]` shape. Knowledge-file
download for GPTs is not implemented.

#### Paging, unverified

`cuts[].list.cursor` exists and came back empty on this account, so paging could not be
exercised. Worse, **`/gizmos/mine` silently ignores unknown query parameters**: verified
that `?zzz_not_a_param=1`, `?cursor=abc123` and `?cursor=abc123&cut_id=mine` all return
200 with the same single item as the plain call. So `?cursor=` is a guess and may be a
no-op.

`listGptSummaries` handles this by ending the loop when a page adds no new gizmo ID,
so a cursor that is ignored costs one extra request rather than spinning. If an account
with more than one page of GPTs turns up, confirm the real parameter name before
trusting multi-page results.

### Still unchecked

Items 3 (file download), 4 (memories listing shape), 4b (custom instructions) and 5
(`ChatGPT-Account-Id` on a Team or Enterprise workspace) from the table above were not
part of this pass.

### Method

The write contract below was observed live on 2026-09-20 against a signed-in Free-plan account, by patching `window.fetch` and `XMLHttpRequest.prototype.open` in the page and driving the real UI. Telemetry (`/ces/v1/t`) filtered out of every capture.

### Project details

Bare IDs confirmed. The sidebar fetches `GET /backend-api/gizmos/g-p-<32 hex>` with no slug appended. The slug-fallback path is not needed for this shape.

### Sentinel

No sentinel proof-of-work token gates any project read or write: `/backend-api/sentinel/chat-requirements/finalize` fires on page load and `/backend-api/sentinel/heartbeat` periodically, but neither is a per-request gate.

### Memories and custom instructions (endpoints seen)

`GET /backend-api/memories?include_memory_entries=false` and `GET /backend-api/user_system_messages` both exist and fire on page load. Reading these via API should remove the "only readable when the settings page is open" limitation noted in the v0.4.0 audit. Response shapes not yet inspected.

---

## Write API (observed live 2026-09-20)

Namespace is `/backend-api/projects`, not `/backend-api/gizmos`. Gizmos is read-only.

**Create** , `POST /backend-api/projects`

```json
{"instructions":"","name":"<name>","memory_scope":"unset"}
```

Returns 200 with the new gizmo; id is `g-p-<32 hex>`. `instructions` is accepted on create, so project plus instructions is one call.

**Update** , `PATCH /backend-api/projects/{gizmo_id}`

```json
{"name":"<name>","instructions":"<text>","emoji":null,"theme":null}
```

**Knowledge file** , three steps

1. `POST /backend-api/files`

```json
{"file_name":"x.txt","file_size":56,"use_case":"agent","gizmo_id":"g-p-...",
 "timezone_offset_min":420,"reset_rate_limits":false,
 "supports_direct_azure_multipart":true,"mime_type":"text/plain",
 "entry_surface":"project_sources","selection_method":"file_picker",
 "client_resolved_mime_type":"text/plain"}
```

2. `PUT https://sdmntpr<region>.oaiusercontent.com/files/{uuid}/raw` , raw bytes, sent as XHR. Host comes from step 1; do not hardcode it.

3. `POST /backend-api/files/process_upload_stream`

```json
{"file_id":"file_<hex>","use_case":"agent","gizmo_id":"g-p-...",
 "index_for_retrieval":true,"file_name":"x.txt","entry_surface":"project_sources",
 "metadata":{"store_in_library":true,"is_temporary_chat":false,"is_project_thread":true}}
```

**`entry_surface` decides where the file lands.** `"chat_composer"` attaches it to a pending chat message and leaves the project's Sources tab empty; `"project_sources"` puts it in Sources. Both were run and the difference confirmed on screen. This mirrors the Gemini shape (content-push upload, `ProcessFile`, then `kHv0Vd`).

## Caveats

- Free plan only. Rate limits, the per-plan file cap (Free 5, Plus/Go 25, Pro and business 40) and Team/Enterprise behaviour are unverified. `ChatGPT-Account-Id` still unverified.
- Upload exercised with one small `text/plain` file. `supports_direct_azure_multipart: true` implies a separate large-file path that was not observed.
- Deletion not probed.
- Whether `/backend-api/gizmos/snorlax/sidebar` also returns GPTs (as opposed to projects only) is **not** established. `/backend-api/gizmos/bootstrap` was seen on page load and may be the GPT source.

## Proposal: read memories and custom instructions via the API

Only apply this after step 4 of the check confirms the endpoints.

1. Add a `FETCH_CHATGPT_PERSONALIZATION` handler in the service worker next to `FETCH_GIZMO_API`. It should use the same cached bearer token, run in the MAIN world, and accept only requests from the ChatGPT content script.
2. **Memories:** `GET /backend-api/memories` (with whatever query the UI sends). Map each item's text and update time to a `MemoryItem`. If the response is paged, follow the cursor until it's done or a cap of 1,000 is reached.
3. **Custom instructions:** `GET /backend-api/user_system_messages`. Map the "about you" and "how to respond" fields to `globalInstructions`, and skip the fields that are turned off.
4. **Workspaces:** if step 5 shows the header is required, read the current account from `/backend-api/accounts/check` or from the page, and send `ChatGPT-Account-Id` on every call (gizmos, files, memories).
5. Keep the settings UI reader as the fallback. When an API call fails, add a warning and fall back to the UI. Don't fail the extraction.
6. **Tests:** add unit tests with recorded, redacted response fixtures in `tests/fixtures/`.
