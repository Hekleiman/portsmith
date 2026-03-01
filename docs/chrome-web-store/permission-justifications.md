# Chrome Web Store — Permission Justifications

> Copy-paste each block into the CWS developer dashboard "Justify permissions" form.
> Each justification is self-contained and references a specific feature.

---

## `storage`

PortSmith uses the `chrome.storage.local` API to persist two categories of user data locally on the device. First, user preferences such as the last-used source and target platforms, sidebar display state, and LLM mode setting — so the extension remembers your configuration between sessions. Second, guided migration progress — a list of step IDs the user has marked as complete, so they can close the side panel and resume later without losing their place. No data stored via this API is transmitted off-device or synced to any server. A less powerful alternative like cookies or localStorage would not work because the extension's side panel, background service worker, and content scripts all need access to the same preference data across different execution contexts, which only `chrome.storage.local` provides.

---

## `sidePanel`

PortSmith's core user interface is a multi-step migration wizard displayed in Chrome's Side Panel. The wizard guides users through source selection, data extraction, review, editing, and import — a flow that requires the panel to stay open alongside the ChatGPT and Claude tabs the user is working with. A popup would close every time the user clicks on the target page, breaking the workflow. A standalone tab would not be able to sit alongside the target page for side-by-side use. The Side Panel API is the only Chrome API that provides a persistent, always-visible panel adjacent to the active tab, which is required for this migration workflow.

---

## `scripting`

PortSmith uses `chrome.scripting.executeScript` with `world: "MAIN"` for two specific operations. First, to retrieve the user's existing ChatGPT session token from `chatgpt.com/api/auth/session` — this token is needed to read project data from ChatGPT's backend API, and the request must run in the page's MAIN world so it has access to the site's authentication cookies. Second, to dispatch trusted click events on Claude's UI during the autofill import process — Claude's React framework (Radix UI) ignores synthetic events from content scripts running in Chrome's isolated world, so the click must originate from the MAIN world to be treated as a real user interaction. Content scripts alone cannot perform either of these operations because they run in an isolated execution context without access to the page's cookies or the ability to dispatch trusted events.

---

## `clipboardWrite`

PortSmith uses the `clipboardWrite` permission as a fallback when automatic form-filling fails during the Claude import step. When the extension cannot programmatically enter project instructions into Claude's UI (due to DOM changes or timing issues), it copies the translated instruction text to the user's clipboard and prompts them to paste it manually. This ensures the migration can always complete even when the target site's UI structure changes. The permission is only exercised during active migration when autofill fails — it is never used in the background or without the user's knowledge. There is no less powerful alternative: the Clipboard API requires a user gesture in the page context, which is not available from the extension's service worker or side panel.

---

## `windows`

PortSmith uses the `chrome.windows.update` API with `{ focused: true }` during the autofill migration process to bring the browser window containing the Claude tab to the foreground. When the extension navigates the Claude tab to create a new project, the user needs to see the tab to monitor the autofill progress and intervene if a step requires manual action (like uploading a knowledge file). Without this permission, the Claude tab could remain behind other windows, leaving the user unable to see or interact with the migration as it happens. This permission is only used during the active migration flow and only affects the window that already contains the user's Claude tab.

---

## Host permission: `https://chatgpt.com/*`

PortSmith injects a content script on `chatgpt.com` pages to extract the user's AI assistant configurations directly from the ChatGPT DOM. The content script reads Custom GPT configs (name, description, instructions, conversation starters, knowledge file names), project data, memory items, and custom instructions from the page. It also communicates with the background service worker to fetch project details from ChatGPT's same-origin backend API. This host permission is required because the content script must run on `chatgpt.com` pages to access the DOM elements containing the user's configuration data. A narrower permission is not possible — ChatGPT uses client-side routing, so the extraction may occur on any path under the domain (e.g., `/gpts/editor/*`, `/project/*`, `/settings`).

---

## Host permission: `https://claude.ai/*`

PortSmith injects a content script on `claude.ai` pages to perform the import side of the migration. The content script fills Claude project creation forms (name, description), enters project instructions into Claude's settings modal, detects page navigation after project creation, copies text to the clipboard as a fallback, and verifies that migrated projects appear on the Claude projects page. This host permission is required because the content script must interact with Claude's DOM elements across multiple pages during the migration flow — the projects list page, the project creation modal, and individual project dashboard pages. A narrower path pattern would break the flow since Claude uses client-side navigation across these routes.

---

## Optional host permission: `https://chat.openai.com/*`

This optional permission provides compatibility with the legacy ChatGPT domain (`chat.openai.com`), which some users may still have bookmarked or be redirected to. It is not requested at install time — Chrome only prompts the user if the extension needs to run on this domain. The functionality is identical to the `chatgpt.com` host permission: content script injection for data extraction. It is offered as an optional permission rather than a required one because the majority of users access ChatGPT via `chatgpt.com`, and requesting access to both domains at install time would be unnecessarily broad for most users.
