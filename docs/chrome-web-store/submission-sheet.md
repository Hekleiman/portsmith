# Chrome Web Store: submission sheet (v0.5.1)

Everything the dashboard asks for, in the order the dashboard asks for it. Written 2026-11-09 for 0.5.1. The live package is 0.5.0. This release has to clear review before 2026-11-17, when Gemini starts turning Gems into skills on personal Google accounts. It carries the Gemini skill route (PR #8) and a fix for ChatGPT project files, which 0.5.0 failed to copy.

## The item

| | |
|---|---|
| Item name | PortSmith |
| Item ID | `jgicdjjebakiobiehdfdbgkfknkidhcd` |
| Publisher account | Hekleiman@gmail.com (contact address confirmed 2026-03-01) |
| Package | `portsmith-v0.5.1.zip`, 229,550 bytes, sha256 `57ed17d5406a8f154fd29cab1ef4a3d4f6d746588c6d8b4f2880e82471319e2c` |
| Built from | `release/v0.5.1`: `main` at `7db9699` (PR #8, Gemini skill route), the ChatGPT file fix (`fix(chatgpt): download knowledge files by file_id`) and the 0.5.1 version bump in `manifest.json`, `package.json`, `package-lock.json` and `src/shared/constants.ts`. Clean `dist/` (35 files, 39 zip entries), `.vite/` build metadata excluded |
| Copy for upload | `~/Desktop/portsmith-v0.5.1.zip` (same sha256, checked) |
| Live package | 0.5.0, the CRX served by the store, downloaded 2026-11-09 |

## Package verification

Run against `portsmith-v0.5.1.zip` itself, not against `dist/`.

| Check | Result |
|---|---|
| Manifest version inside the zip | 0.5.1 |
| Zip entries / files | 39 / 35 (0.5.0: 38 / 34; the new file is the Gemini `skill-package` chunk) |
| `.vite` entries | 0 |
| Paths referenced by `manifest.json` | 30 referenced, **0 missing** |
| Zip file list vs `dist/` | identical both ways, 0 extra, 0 absent |
| Side panel HTML's own references | 9 referenced, 0 broken |
| Version baked into the bundle | `0.5.1` in `manifest.json` and the shared constants chunk; **no stale `0.5.0`, `0.4.0` or `0.4.1` anywhere** in the package |

## Manifest diff vs live 0.5.0

The check that matters for an auto-update: when 0.3.0 updated to 0.4.0, Chrome disabled the
extension until the user accepted added permissions. The live 0.5.0 CRX was downloaded from
the store on 2026-11-09 (HTTP 200, 233,181 bytes, `Cr24` magic, CRX3), its header stripped
(12 bytes plus the 1,309-byte header length stored little-endian at bytes 8 to 12), and its
manifest compared against the one inside `portsmith-v0.5.1.zip`.

| Field | Live 0.5.0 | New 0.5.1 | Added |
|---|---|---|---|
| `permissions` | storage, sidePanel, scripting | storage, sidePanel, scripting | none |
| `host_permissions` | chatgpt.com, claude.ai, gemini.google.com | chatgpt.com, claude.ai, gemini.google.com | none |
| `content_scripts[].matches` | chatgpt.com x2, claude.ai x2, gemini.google.com x2 | chatgpt.com x2, claude.ai x2, gemini.google.com x2 | none |
| `web_accessible_resources[].matches` | chatgpt.com, claude.ai, gemini.google.com | chatgpt.com, claude.ai, gemini.google.com | none |
| `optional_permissions` | none | none | none |
| `optional_host_permissions` | none | none | none |

Beyond the table, the full manifest diff shows only the version string, content-hashed
bundle filenames, one new resource (`assets/skill-package-*.js`) in the existing
gemini.google.com web-accessible entry, and the `update_url` the store injects into the live
copy. No permission or host is added, so 0.5.1 will not disable the extension on update.

## Changes in this version

> Paste into the CWS "Changes in this version" field. The same text is in `store-listing.md`
> under "What's New in v0.5.1".

```
- New: Gemini is turning Gems into skills on Nov 17. On personal Google accounts, PortSmith now gives you a ready-made skill to add, with a SKILL.md file
- Fixed: files in ChatGPT projects weren't copied, so each one had to be uploaded by hand
```

## Permission evidence, unchanged since 0.4.0

The 2026-03-03 review rejected version 0.1.0 for Use of Permissions, reference ID
**Purple Potassium**, routing ID FZSL: "Requesting but not using the following
permission(s): storage." That was a correct call at the time. It was addressed in 0.4.0 and
nothing below changed in 0.5.0 or 0.5.1, but it is kept here in case a reviewer revisits it.

Each permission, with the shipped call that uses it, re-checked in the 0.5.0 bundle and not only in source (0.5.1 adds no permission; see the manifest diff above):

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
| Short description | `store-listing.md` → "Short Description". Unchanged. |
| Detailed description | `store-listing.md` → "Full Description". Changed for 0.5.1: the "Into Gemini" line now says Gems are created automatically where Gemini still offers them, and that on personal accounts from Nov 17 PortSmith hands over a Gemini skill (with a SKILL.md file) to add by hand. Paste it in full. |
| Category | Productivity |
| Language | English |
| Screenshots | Unchanged. The store does not require new shots for an update. |
| What's new / release notes | "Changes in this version" above |

## Privacy tab

Unchanged from 0.5.0. Data handling did not change: the ChatGPT fix reads the same files from the same endpoint with a different ID, and the SKILL.md file is built in the browser and saved by the user. The privacy policy was not edited for this release, so it still reads "version 0.5.0"; that is expected.

| Field | Value |
|---|---|
| Single purpose | `screenshot-checklist.md` → "Fields to paste into the dashboard" |
| `storage` justification | `permission-justifications.md` → `storage`. Lead with the call sites; this is the permission that was rejected in March. |
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

- [ ] Release PR merged into `main`.
- [ ] **Package tab:** upload `~/Desktop/portsmith-v0.5.1.zip`. After it processes, the
      dashboard should show version 0.5.1.
- [ ] **Store listing tab:** paste the full description from `store-listing.md`, and paste
      "Changes in this version" from the block above if the field is offered.
- [ ] **Privacy tab:** unchanged.
- [ ] **Submit for review.** Review has to finish before 2026-11-17 for the skill route to
      reach users when Gems switch.

## Known risks, in order

1. **Review timing.** The skill route only helps if 0.5.1 is live by 2026-11-17. Until then the date switch in `skill-package.ts` keeps the Gem steps, so an early release changes nothing for users before the cutoff.
2. **A second Use of Permissions review.** A reviewer re-checking the March violation looks harder. The justification names files and line numbers, which is what closes that.
3. **ChatGPT reads and writes depend on ChatGPT's internal web API**, which is unversioned and can change without notice. The 0.5.0 file bug was exactly that: `/gizmos/{id}` returns a file `id` the download endpoint rejects, next to a `file_id` it accepts. The contract is written down in `docs/chatgpt-endpoints.md`.
4. **Gemini's skills switch hasn't happened yet.** From Nov 17 the manual skill steps point at `gemini.google.com/customize/skills`, "Create" then "Create manually" (`src/core/adapters/gemini-guided.ts`). Those steps could not be checked against a live skills page before the switch; if the page differs, they need a follow-up.
5. **Auto-update disabling the extension** is the failure 0.3.0 to 0.4.0 hit. Checked for this release, see "Manifest diff vs live 0.5.0". It will recur on any future release that adds a host or permission, until the hosts move to `optional_host_permissions`.
