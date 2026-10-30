# Chrome Web Store: submission sheet (v0.5.0)

Everything the dashboard asks for, in the order the dashboard asks for it. Written 2026-10-30 for 0.5.0. The live package is 0.4.0; 0.4.1 was never published, so this release carries the 0.4.1 ChatGPT extraction fix as well as automatic import into ChatGPT.

## The item

| | |
|---|---|
| Item name | PortSmith |
| Item ID | `jgicdjjebakiobiehdfdbgkfknkidhcd` |
| Publisher account | Hekleiman@gmail.com (contact address confirmed 2026-03-01) |
| Package | `portsmith-v0.5.0.zip`, 227,756 bytes, sha256 `ced06cdeeb9672e31f12a8575f1583f365e9d6ad0a3ddb981914ea4f5c51394e` |
| Built from | `release/v0.5.0`: `main` at `9c33ad8` plus the 0.5.0 version bump (`cc9e33f`) in `manifest.json`, `package.json`, `package-lock.json` and `src/shared/constants.ts`. Clean `dist/` (34 files, 38 zip entries), `.vite/` build metadata excluded |
| Copy for upload | `~/Desktop/portsmith-v0.5.0.zip` (same sha256) |
| Live package | 0.4.0, the CRX served by the store, downloaded 2026-10-30 |

## Package verification

Run against `portsmith-v0.5.0.zip` itself, not against `dist/`.

| Check | Result |
|---|---|
| Manifest version inside the zip | 0.5.0 |
| Zip entries / files | 38 / 34 (0.4.x: 34 / 30; the new files are the ChatGPT importer and its shared chunks) |
| `.vite` entries | 0 |
| Paths referenced by `manifest.json` | 29 referenced, **0 missing** |
| Zip file list vs `dist/` | identical both ways, 0 extra, 0 absent |
| Side panel HTML's own references | 8 referenced, 0 broken |
| Version baked into the bundle | `0.5.0` in `manifest.json` and the shared constants chunk; **no stale `0.4.0` or `0.4.1` anywhere** in the package |

## Manifest diff vs live 0.4.0

The check that matters for an auto-update: when 0.3.0 updated to 0.4.0, Chrome disabled the
extension until the user accepted added permissions. The live CRX was downloaded from the
store, its CRX3 header stripped (12 bytes plus the header length stored at bytes 8 to 12),
and its manifest compared against the one in this package.

| Field | Live 0.4.0 | New 0.5.0 | Added |
|---|---|---|---|
| `permissions` | storage, sidePanel, scripting | storage, sidePanel, scripting | none |
| `host_permissions` | chatgpt.com, claude.ai, gemini.google.com | chatgpt.com, claude.ai, gemini.google.com | none |
| `content_scripts[].matches` | chatgpt.com, claude.ai x2, gemini.google.com x2 | chatgpt.com x2, claude.ai x2, gemini.google.com x2 | none (one more entry on a host already granted) |
| `optional_permissions` | none | none | none |
| `optional_host_permissions` | none | none | none |

Beyond the table, the full manifest diff shows only the version string, the new ChatGPT
importer content-script entry, content-hashed bundle filenames, and the `update_url` the store
injects into the live copy. No permission or host is added, so 0.5.0 will not disable the
extension on update.

## Changes in this version

> Paste into the CWS "Changes in this version" field. The same text is in `store-listing.md`
> under "What's New in v0.5.0".

```
- New: automatic migration into ChatGPT: projects, instructions, files and project memory
- New: names and instructions longer than ChatGPT allows are shortened, and the full instructions are kept as a project file
- Fixed: ChatGPT projects and custom GPTs were not found, so extraction stopped with nothing to migrate
- Fixed: PortSmith reported "Not logged in to ChatGPT" on a signed-in account
- Improved: reading from ChatGPT works from any ChatGPT page
- Improved: files too large to pass through the extension are listed for manual upload instead of failing
```

## Permission evidence, unchanged since 0.4.0

The 2026-03-03 review rejected version 0.1.0 for Use of Permissions, reference ID
**Purple Potassium**, routing ID FZSL: "Requesting but not using the following
permission(s): storage." That was a correct call at the time. It was addressed in 0.4.0 and
nothing below changed in 0.5.0, but it is kept here in case a reviewer revisits it.

Each permission, with the shipped call that uses it, re-checked in the 0.5.0 bundle and not only in source:

| Permission | Shipped call | Reached by |
|---|---|---|
| `storage` | `chrome.storage.local.get` / `.set` in `assets/index.html-*.js` and `assets/service-worker.ts-*.js` | `setPreference` on every source and target pick (`migration-store.ts:289,302`), `getPreference` when the panel opens (`:361-362`), `saveSavedMemoryIds` during a Gemini run (`migration-orchestrator.ts:817,857`) |
| `sidePanel` | `chrome.sidePanel.setPanelBehavior` in `assets/service-worker.ts-*.js` | Service worker startup; the whole UI is the side panel |
| `scripting` | `chrome.scripting.executeScript` in `assets/service-worker.ts-*.js` and `assets/messaging-*.js` | MAIN-world requests on chatgpt.com, MAIN-world clicks, and re-injection into already-open tabs after install |

`clipboardWrite` and `windows` were in 0.1.0 and are gone from the manifest. The optional `chat.openai.com` host is gone too. The manifest now asks for three permissions and three hosts, nothing else.

## Store listing tab

| Field | Value |
|---|---|
| Name | PortSmith |
| Short description | `store-listing.md` → "Short Description". 118 characters, byte-identical to `description` in `manifest.json` (checked). Unchanged. |
| Detailed description | `store-listing.md` → "Full Description". Changed for 0.5.0: ChatGPT is now an automatic target. Paste it in full. |
| Category | Productivity |
| Language | English |
| Screenshots | Unchanged. The store does not require new shots for an update. |
| What's new / release notes | "Changes in this version" above |

## Privacy tab

Unchanged from 0.4.0. Leave it as it is unless the dashboard asks about the new behaviour (PortSmith now writes projects and files to ChatGPT, as it already did to Claude and Gemini). If it does, the answer is the "What PortSmith writes" and "What PortSmith sends over the network" sections of the privacy policy.

| Field | Value |
|---|---|
| Single purpose | `screenshot-checklist.md` → "Fields to paste into the dashboard" |
| `storage` justification | `permission-justifications.md` → `storage`. Lead with the call sites; this is the permission that was rejected. |
| `sidePanel` justification | `permission-justifications.md` → `sidePanel` |
| `scripting` justification | `permission-justifications.md` → `scripting` |
| Host justifications | `permission-justifications.md`, one block each for chatgpt.com, claude.ai and gemini.google.com |
| Privacy policy URL | https://hekleiman.github.io/portsmith/privacy-policy.html |

### Data usage disclosures

The Chrome Web Store defines handling user data as "collecting, transmitting, using, or sharing" it, and says the disclosure applies even when the data is only processed or stored locally. PortSmith reads the user's projects, instructions, knowledge files and memories, keeps copies in the browser, and sends them to the target assistant. So the honest answer is not "collects nothing".

Recommended:

- **Website content**: check it. This is what PortSmith reads: project and GPT instructions, knowledge files, project memory, saved memories, all from the user's own accounts on chatgpt.com, claude.ai and gemini.google.com.
- **Personally identifiable information**: Erik's call. PortSmith does not ask for or target personal information, but saved memories and custom instructions are free text and often contain names, places and other personal detail. Checking it costs nothing on the listing and closes a gap a reviewer could open. Leaving it unchecked is defensible on the grounds that PortSmith never treats the content as personal information.
- Health, financial, authentication, personal communications, location, web history, user activity: leave unchecked. PortSmith has no `tabs`, `history`, `cookies` or `webRequest` permission, reads no chat history, and records no clicks or keystrokes.

Certifications, all three can be signed:

1. Not sold or transferred to third parties outside the approved use cases. The only transfer is to the assistant the user picked, into the user's own account, which is the product's single purpose.
2. Not used or transferred for anything unrelated to the single purpose.
3. Not used for creditworthiness or lending.

## Dashboard checklist

- [ ] Release PR merged into `main`. The privacy policy is served from `main:/docs`, so it is
      stale until then. Reload https://hekleiman.github.io/portsmith/privacy-policy.html and
      confirm it says "version 0.5.0" and that the ChatGPT bullet under "What PortSmith writes"
      describes creating projects.
- [ ] **Package tab:** upload `~/Desktop/portsmith-v0.5.0.zip`. After it processes, the
      dashboard should show version 0.5.0.
- [ ] **Store listing tab:** paste the full description from `store-listing.md`, and paste
      "Changes in this version" from the block above if the field is offered.
- [ ] **Privacy tab:** unchanged, unless the dashboard asks about the new behaviour (see
      "Privacy tab" above).
- [ ] Test items removed from the test accounts: ChatGPT projects, Claude projects and Gemini
      Gems named "PortSmith test ... (delete me)" or left over from test runs.
- [ ] **Submit for review.**

## Known risks, in order

1. **A second Use of Permissions review.** A reviewer re-checking a prior violation looks harder. The justification names files and line numbers, which is what closes that.
2. **New write behaviour on ChatGPT.** PortSmith now creates projects and uploads files in the user's ChatGPT account, and file bytes go to an `oaiusercontent.com` upload URL that ChatGPT returns. That host is not in `host_permissions`: the ChatGPT content script sends a plain `fetch` PUT with `credentials: "omit"` and no bearer token to the signed URL ChatGPT issued (`src/content-scripts/chatgpt/importer.ts`), much as Gemini uploads go to `content-push.googleapis.com`. The privacy policy states both.
3. **No privacy disclosure inside the side panel.** The panel has no privacy text or policy link before it reads anything. The verbatim in-UI requirement in the Limited Use policy is scoped to web browsing activity, which PortSmith does not touch, so this is not a clear violation, but a line on the first screen with a link to the policy is cheap insurance.
4. **ChatGPT reads and writes depend on ChatGPT's internal web API**, which is unversioned and can change without notice. The contract is written down in `docs/chatgpt-endpoints.md`.
5. **Auto-update disabling the extension** is the failure 0.3.0 to 0.4.0 hit. Checked for this release, see "Manifest diff vs live 0.4.0". It will recur on any future release that adds a host or permission, until the hosts move to `optional_host_permissions`.
