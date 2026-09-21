# Chrome Web Store: submission sheet (v0.4.1)

Everything the dashboard asks for, in the order the dashboard asks for it. Written 2026-09-17 for 0.4.0, updated 2026-09-20 for the 0.4.1 hotfix.

## The item

| | |
|---|---|
| Item name | PortSmith |
| Item ID | `jgicdjjebakiobiehdfdbgkfknkidhcd` |
| Publisher account | Hekleiman@gmail.com (contact address confirmed 2026-03-01) |
| Package | `portsmith-v0.4.1.zip`, 222,642 bytes, sha256 `424cdf80ceca9750dd8845d434bbf64b3f5354958021be8afcbb1ada4ee9dcae` |
| Built from | `feat/chatgpt-api-auth`, code at `913b762` plus the 0.4.1 version bump in `manifest.json`, `package.json` and `src/shared/constants.ts`, clean `dist/` (30 files, 34 zip entries), `.vite/` build metadata excluded |
| Previous package | `portsmith-v0.4.0.zip`, 219,406 bytes, sha256 `9fad374ab7b64f20d6fd2e29e249703b2a6adaf05ee4a4acc4fd701ac54bf944`, built from `main` at `7427189` |

## Package verification

Run against `portsmith-v0.4.1.zip` itself, not against `dist/`.

| Check | Result |
|---|---|
| Manifest version inside the zip | 0.4.1 |
| Zip entries / files | 34 / 30, same shape as 0.4.0 |
| `.vite` entries | 0 |
| Paths referenced by `manifest.json` | 25 referenced, **0 missing** |
| Zip file list vs `dist/` | identical both ways, 0 extra, 0 absent |
| Side panel HTML's own references | 7 referenced, 0 broken |
| Version baked into the bundle | `0.4.1` in `manifest.json` and the shared constants chunk; **no stale `0.4.0` anywhere** in the package |

## This is a hotfix to a live listing

0.4.0 is live. 0.4.1 changes no permissions, no manifest structure and no UI flow. It fixes
ChatGPT extraction, which is broken for every user on 0.4.0.

ChatGPT stopped rendering sidebar projects and custom GPTs as links, so the selectors that
discovered them resolved zero elements and the wizard stopped at "Nothing to migrate yet".
No gizmo ID survives anywhere in the page, so no selector change could fix it. Discovery now
reads the signed-in account through ChatGPT's own web API. Details in
`docs/chatgpt-endpoints.md`.

### Changes in this version

> Paste into the CWS "Changes in this version" field. Note `store-listing.md` still carries
> the v0.4.0 notes; this block supersedes it for 0.4.1.

```
- Fixed: ChatGPT projects and custom GPTs were not found, so extraction stopped with nothing to migrate
- Fixed: PortSmith reported "Not logged in to ChatGPT" on a signed-in account
- Improved: custom GPTs now come through with their instructions, description and conversation starters, without opening each one
- Improved: reading from ChatGPT works from any ChatGPT page, and no longer depends on the sidebar being open
```

### No new permission warnings

This is the check that matters for an auto-update: when 0.3.0 updated to 0.4.0, Chrome
disabled the extension until the user accepted added permissions. The live CRX was pulled
from the store and its manifest compared field by field against this package.

| Field | Live 0.4.0 | New 0.4.1 | Added |
|---|---|---|---|
| `permissions` | scripting, sidePanel, storage | scripting, sidePanel, storage | none |
| `host_permissions` | chatgpt.com, claude.ai, gemini.google.com | chatgpt.com, claude.ai, gemini.google.com | none |
| `content_scripts[].matches` | chatgpt.com, claude.ai x2, gemini.google.com x2 | chatgpt.com, claude.ai x2, gemini.google.com x2 | none |
| `optional_permissions` | none | none | none |
| `optional_host_permissions` | none | none | none |

Nothing added and nothing removed. A full manifest diff against the live CRX shows only the
version string, two content-script bundle filenames whose content hashes changed, and the
`update_url` the store itself injects. So 0.4.1 will not disable the extension on update.

Moving the hosts to `optional_host_permissions` is the real long-term fix for this class of
problem, but it changes behaviour and belongs in its own release, not a hotfix.

## Permission evidence, unchanged from 0.4.0

The 2026-03-03 review rejected version 0.1.0 for Use of Permissions, reference ID
**Purple Potassium**, routing ID FZSL: "Requesting but not using the following
permission(s): storage." That was a correct call at the time. It was addressed in 0.4.0 and
nothing below changed in 0.4.1, but it is kept here in case a reviewer revisits it.

Each permission, with the shipped call that uses it, verified in the built bundle and not only in source:

| Permission | Shipped call | Reached by |
|---|---|---|
| `storage` | `chrome.storage.local.get` / `.set` in `assets/index.html-*.js` and `assets/service-worker.ts-*.js` | `setPreference` on every source and target pick (`migration-store.ts:289,302`), `getPreference` when the panel opens (`:361-362`), `saveSavedMemoryIds` during a Gemini run (`migration-orchestrator.ts:739`) |
| `sidePanel` | `chrome.sidePanel.setPanelBehavior` in `assets/service-worker.ts-*.js` | Service worker startup; the whole UI is the side panel |
| `scripting` | `chrome.scripting.executeScript` in `assets/service-worker.ts-*.js` and `assets/messaging-*.js` | MAIN-world requests on chatgpt.com, MAIN-world clicks, and re-injection into already-open tabs after install |

`clipboardWrite` and `windows` were in 0.1.0 and are gone from the manifest. The optional `chat.openai.com` host is gone too. The manifest now asks for three permissions and three hosts, nothing else.

## Store listing tab

| Field | Value |
|---|---|
| Name | PortSmith |
| Short description | `store-listing.md` → "Short Description". 118 characters, byte-identical to `description` in `manifest.json` (checked). |
| Detailed description | `store-listing.md` → "Full Description" |
| Category | Productivity |
| Language | English |
| Screenshots | Unchanged. The store does not require new shots for an update, and the existing ones are 0.3.0 era. Replacing them is still worth doing, but not as part of this hotfix. |
| What's new / release notes | "Changes in this version" above, not `store-listing.md`, which still says v0.4.0. |

## Privacy tab

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

- **Website content** — check it. This is what PortSmith reads: project and GPT instructions, knowledge files, project memory, saved memories, all from the user's own accounts on chatgpt.com, claude.ai and gemini.google.com.
- **Personally identifiable information** — Erik's call. PortSmith does not ask for or target personal information, but saved memories and custom instructions are free text and often contain names, places and other personal detail. Checking it costs nothing on the listing and closes a gap a reviewer could open. Leaving it unchecked is defensible on the grounds that PortSmith never treats the content as personal information.
- Health, financial, authentication, personal communications, location, web history, user activity — leave unchecked. PortSmith has no `tabs`, `history`, `cookies` or `webRequest` permission, reads no chat history, and records no clicks or keystrokes.

Certifications, all three can be signed:

1. Not sold or transferred to third parties outside the approved use cases. The only transfer is to the assistant the user picked, into the user's own account, which is the product's single purpose.
2. Not used or transferred for anything unrelated to the single purpose.
3. Not used for creditworthiness or lending.

## Before pressing Submit

- [ ] `feat/chatgpt-api-auth` merged and pushed. The privacy policy at the listing URL is
      served from `main:/docs`, so it is stale until then. Reload it and confirm the version
      it names.
- [ ] `portsmith-v0.4.1.zip` uploaded and the dashboard shows version 0.4.1.
- [ ] "Changes in this version" pasted from the block above.
- [ ] Nothing else touched. No permission field, no justification and no listing text needs
      editing for this release.
- [ ] Test items removed: Claude project "PortSmith test (delete me)", Gemini Gem
      "PortSmith test Gem (delete me)", and any Gems left over from test runs.

## Known risks, in order

1. **A second Use of Permissions review.** A reviewer re-checking a prior violation looks harder. The justification now names files and line numbers, which is what closes that.
2. **No privacy disclosure inside the side panel.** The panel has no privacy text or policy link before it reads anything. The only such line is "Nothing leaves your computer", inside the "Saved in this browser" box, which appears only after data is already stored. The verbatim in-UI requirement in the Limited Use policy is scoped to web browsing activity, which PortSmith does not touch, so this is not a clear violation. The August 1, 2026 Disclosure Requirements update broadened disclosure expectations, and a line on the first screen with a link to the policy is cheap insurance.
3. **ChatGPT extraction now depends on ChatGPT's internal web API**, which is unversioned
   and can change without notice, exactly as the sidebar DOM just did. The contract was
   checked live on 2026-09-20 and is written down in `docs/chatgpt-endpoints.md`. Two parts
   of it are explicitly unverified: the `?cursor=` parameter on `/backend-api/gizmos/mine`
   (the test account had one page of GPTs, and that endpoint ignores unknown parameters),
   and the `resource.files` item shape for GPTs (the test account's GPT had no knowledge
   files).
4. **Auto-update disabling the extension** is the failure 0.3.0 to 0.4.0 hit. Checked
   explicitly for this release, see "No new permission warnings". It will recur on any future
   release that adds a host or permission, until the hosts move to
   `optional_host_permissions`.
