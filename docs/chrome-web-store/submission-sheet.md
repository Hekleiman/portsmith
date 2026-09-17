# Chrome Web Store: submission sheet (v0.4.0)

Everything the dashboard asks for, in the order the dashboard asks for it. Written 2026-09-17.

## The item

| | |
|---|---|
| Item name | PortSmith |
| Item ID | `jgicdjjebakiobiehdfdbgkfknkidhcd` |
| Publisher account | Hekleiman@gmail.com (contact address confirmed 2026-03-01) |
| Package | `portsmith-v0.4.0.zip`, 219,406 bytes, sha256 `9fad374ab7b64f20d6fd2e29e249703b2a6adaf05ee4a4acc4fd701ac54bf944` |
| Built from | `main` at `7427189`, clean `dist/` (31 files), `.vite/` build metadata excluded |

## This is a resubmission after a rejection

The 2026-03-03 review rejected version 0.1.0.

- Violation: Use of Permissions, reference ID **Purple Potassium**, routing ID FZSL.
- Reason: "Requesting but not using the following permission(s): storage."
- **It was a correct call.** At `8f37d6b`, the submitted tree, `src/core/storage/preferences.ts` defined the `chrome.storage.local` wrappers and shipped them inside the side panel chunk, but nothing in the codebase called them. The permission was requested and the API was never invoked.

What is different in 0.4.0, verified in the built bundle and not only in source:

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
| Screenshots | 1280x800, per `screenshot-checklist.md`. The listing already holds shots from the March submission; they show the 0.1.x UI and need replacing. Order in the dashboard: 1, 4, 5, 6, 7. |
| What's new / release notes | `store-listing.md` → "What's New in v0.4.0" |

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

- [ ] `main` pushed. The privacy policy at the listing URL is served from `main:/docs`, so it is stale until then. Reload it and confirm it says "version 0.4.0" and mentions Gemini.
- [ ] `portsmith-v0.4.0.zip` uploaded and the dashboard shows version 0.4.0.
- [ ] Screenshots replaced with 0.4.0 shots.
- [ ] `storage` justification pasted with the call sites in it.
- [ ] Test items removed: Claude project "PortSmith test (delete me)", Gemini Gem "PortSmith test Gem (delete me)", and any Gems left over from test runs.

## Known risks, in order

1. **A second Use of Permissions review.** A reviewer re-checking a prior violation looks harder. The justification now names files and line numbers, which is what closes that.
2. **No privacy disclosure inside the side panel.** The panel has no privacy text or policy link before it reads anything. The only such line is "Nothing leaves your computer", inside the "Saved in this browser" box, which appears only after data is already stored. The verbatim in-UI requirement in the Limited Use policy is scoped to web browsing activity, which PortSmith does not touch, so this is not a clear violation. The August 1, 2026 Disclosure Requirements update broadened disclosure expectations, and a line on the first screen with a link to the policy is cheap insurance.
3. **ChatGPT endpoint checks are unfinished** in `docs/live-contract-checks.md`. Not a store requirement, but ChatGPT extraction is the least verified path in the release.
