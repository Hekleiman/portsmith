# Chrome Web Store: Permission Justifications (v0.4.0)

> Paste each block into the "Justify permissions" form in the CWS developer dashboard.
> v0.4.0 removed `clipboardWrite`, `windows` and the optional `chat.openai.com` host. Copy buttons use the Clipboard API from a click in the side panel, and focusing a window needs no permission.

---

## `storage`

PortSmith uses `chrome.storage.local` to remember the source and target platforms the user picked last, so the side panel wizard can pre-select them next time (`src/core/storage/preferences.ts`). Nothing stored with this API leaves the device. The side panel, service worker and content scripts all run in different contexts, and `chrome.storage.local` is the storage they share.

---

## `sidePanel`

PortSmith's interface is a step-by-step migration wizard in Chrome's side panel. It has to stay open next to the ChatGPT, Claude or Gemini tab while the user reviews what was found, confirms steps and copies text. A popup closes as soon as the user clicks the page, and a separate tab can't sit beside the page, so the Side Panel API is the only way to support this workflow.

---

## `scripting`

PortSmith uses `chrome.scripting.executeScript` in three places, all limited to its declared hosts:

1. On chatgpt.com, it runs requests in the page's own context (`world: "MAIN"`) to read the user's GPT and project settings from ChatGPT's API with the user's existing session (`src/background/service-worker.ts`).
2. On chatgpt.com and claude.ai, when an API isn't available, it dispatches a click in the page's own context so the site's UI components respond (`CLICK_IN_MAIN_WORLD` in `src/background/service-worker.ts`).
3. After install or update, it adds PortSmith's declared content scripts to matching tabs that were already open, so users don't have to reload them (`src/shared/messaging.ts`).

Content scripts alone can't do the first two, because they run in an isolated world.

---

## Host permission: `https://chatgpt.com/*`

PortSmith's content script on chatgpt.com reads what the user asked to move: custom GPTs (name, description, instructions, conversation starters, knowledge file names), projects (instructions and knowledge files), saved memories and custom instructions. It uses ChatGPT's same-origin API with the user's session, and copies knowledge files so they can be uploaded to the new assistant. ChatGPT navigates on the client side (`/g/*`, `/gpts/editor/*`, `/project/*`, settings), so a narrower path pattern would break extraction.

---

## Host permission: `https://claude.ai/*`

PortSmith runs two content scripts on claude.ai.

- **Extractor:** reads the user's Claude projects through Claude's same-origin API: name, description, instructions, knowledge documents, and project memory if the user asks for it. If the user leaves "Your memory and preferences" on, it also reads the memory Claude keeps outside projects and the "Instructions for Claude" preferences from the account settings. All of these are read-only.
- **Importer:** when Claude is the target, it creates projects, sets their instructions, adds knowledge documents and files, and adds a project memory document. It then reads the projects back to confirm they were created.

The organization ID comes from Claude's `lastActiveOrg` cookie. Claude navigates on the client side, so the scripts need the whole domain.

---

## Host permission: `https://gemini.google.com/*`

PortSmith runs two content scripts on gemini.google.com.

- **Extractor:** lists the user's Gems (name, description, instructions) through Gemini's own `batchexecute` endpoint, using the page's session token.
- **Importer:** creates Gems the same way when Gemini is the target, and adds the copied knowledge files to them. Files are uploaded from the Gemini tab to `content-push.googleapis.com`, the upload service Gemini's own page uses, then attached with Gemini's `ProcessFile` and Gem update requests. No extra host permission is needed because the request comes from the gemini.google.com page.

Requests use the user's existing Google session. Gemini navigates on the client side (`/app`, `/gem/*`, `/gems/*`), so the scripts need the whole domain.
