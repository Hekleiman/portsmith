# PortSmith

A Chrome extension that moves Custom GPTs, Projects and Gems between ChatGPT, Claude and Gemini, so you can switch assistants (or use more than one) without rebuilding your setup by hand.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/jgicdjjebakiobiehdfdbgkfknkidhcd)

Version in `manifest.json`: **0.4.1**. The store build can trail `main` while an update is in review.

## What it moves

- **From ChatGPT:** custom GPTs, projects with their instructions and knowledge files, saved memories and custom instructions.
- **From Claude:** projects with their instructions, knowledge documents and project memory, plus memory outside projects and your "Instructions for Claude" preferences.
- **From Gemini:** Gems with their instructions.

Project memory (what the assistant learned from chats inside a project) travels as a document in the new project. Chat history does not move. GPT Actions and other platform-specific tools can't be copied; PortSmith flags them so you know.

## Directions

Six directions, between every pair of platforms. Same-platform migrations are blocked.

| From \ To | Claude | Gemini | ChatGPT |
|---|---|---|---|
| ChatGPT | Automated | Automated | n/a |
| Claude | n/a | Automated | Guided |
| Gemini | Automated | n/a | Guided |

- **Into Claude and Gemini (4 directions): fully automated.** PortSmith creates each project or Gem, sets the instructions, uploads the files and adds project memory. Anything it can't do becomes a manual card with the text to copy and the files to download.
- **Into ChatGPT (2 directions): guided.** There is no automated ChatGPT importer yet, so PortSmith walks you through each step with copy and download buttons.

For automated targets you can also pick guided mode, or a hybrid that asks for confirmation before each item.

## How it works

1. **Platform APIs.** Each assistant's web app talks to its own internal web API. PortSmith uses those same endpoints, mapped from the sites' network traffic, from content scripts running in your signed-in tabs. Claude uses `/api/organizations/{org}/...`, Gemini uses `batchexecute` RPCs, and ChatGPT uses `/backend-api/...` (with a DOM fallback for discovery). These APIs are internal and unversioned; the contracts PortSmith depends on are written down in [`docs/`](docs/).
2. **One interchange schema.** Every source is extracted into a single Zod-validated schema (`PortsmithManifest`, in `src/core/schema/types.ts`), and every target is written from it. Instructions are adapted per target by a rule-based translator (`src/core/transform/prompt-translator.ts`); no LLM is involved.
3. **Checkpointed, idempotent writes.** The migration runs in the MV3 service worker, which Chrome can stop at any time. Progress is checkpointed to IndexedDB (via Dexie), and every item created on the target is recorded the moment it exists. An interrupted migration resumes where it left off without creating duplicates.

The UI is a wizard in Chrome's side panel: read your current setup, review and edit what was found, then move it. The run ends with a summary of what was created, what was checked and what still needs you.

## Privacy

No PortSmith servers, no analytics, no third party; data travels only between your browser and the assistants.

PortSmith uses the accounts you are already signed in to. It asks for no sign-up and no API keys, and the ChatGPT access token is held in service worker memory for at most 5 minutes and never persisted. Copies of extracted data are kept in your browser's IndexedDB until you delete them, which takes one click. Privacy policy: [hekleiman.github.io/portsmith/privacy-policy.html](https://hekleiman.github.io/portsmith/privacy-policy.html).

Permissions: `storage`, `sidePanel`, `scripting`, plus host access to `chatgpt.com`, `claude.ai` and `gemini.google.com`.

## Stack

- Chrome Manifest V3, built with Vite and CRXJS
- React 19 and TypeScript (strict)
- Tailwind CSS
- Zustand for wizard state
- Zod for the interchange schema and runtime validation
- Dexie (IndexedDB) for manifests, file blobs and checkpoints; `chrome.storage.local` for preferences
- fflate for zip handling
- Vitest (unit and integration), Playwright scripts for E2E

## Build and test

Requires Node and npm.

```bash
npm ci
npm run build       # tsc --noEmit && vite build, output in dist/
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src/
npm run dev         # vite dev server
```

`npm test` currently runs **625 tests in 24 files**, all passing.

To load a local build: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select `dist/`.

E2E scripts stub the three sites with Playwright routes and never touch real accounts. Playwright is intentionally not a dependency:

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/e2e-duplicate-dispatch.mjs dist
node scripts/e2e-claude-autofill.mjs dist
```

## Project layout

```
src/
  background/        service worker and migration orchestrator (checkpoints, resume)
  content-scripts/   per-platform extractors and importers (chatgpt, claude, gemini)
  core/
    adapters/        per-target delivery: automated, guided, manual fallback
    schema/          interchange schema (Zod)
    storage/         Dexie database, migration state, preferences
    transform/       manifests, prompt translator, memory mapping
  shared/            typed message router, encoding, constants
  sidepanel/         wizard UI (React, Zustand)
tests/               unit and integration tests (Vitest)
scripts/             Playwright E2E scripts
docs/                platform API notes, privacy policy, store materials
```
