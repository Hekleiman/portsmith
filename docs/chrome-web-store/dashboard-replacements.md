# Dashboard replacements for v0.4.0

Paste these over what is in each field. Full replacements, nothing to merge. Every field is under 1,000 characters, which is the limit the single-purpose field shows; if a justification field allows more, the longer versions live in `permission-justifications.md`.

Dashboard: chrome.google.com/webstore/devconsole → PortSmith (ID `jgicdjjebakiobiehdfdbgkfknkidhcd`). Status is Published - public, so this is an update to a live listing.

## Order of operations

1. **Build → Package.** Upload `portsmith-v0.4.0.zip`. Do this first: the "Title from package" and "Summary from package" on the Store listing tab come from the manifest, and both are still 0.3.0 text until the new zip is in.
2. **Build → Store listing.** Replace the Description. Paste the release notes. Leave the screenshots unless you want to reshoot them (see below).
3. **Build → Privacy.** Replace the single purpose and all four justifications. Leave the data usage checkboxes alone (see below).
4. **Submit for review.** Expect the in-depth review the host-permission banner warns about.

Do not submit until `main` is pushed: the privacy policy URL on this listing is served from `main:/docs` and is stale until then.

---

## Store listing → Description

Replaces the whole description box. The live one has an em dash in it. This one does not, and it covers Gemini, project memory and the six directions, which the 0.3.0 text does not.

```
Switching AI assistants shouldn't mean starting from scratch.

If you've built custom GPTs or projects in ChatGPT, projects in Claude, or Gems in Gemini, you know how much work goes into them. PortSmith moves that setup to another assistant, so you can switch or use more than one without rebuilding everything by hand.

WHAT PORTSMITH MOVES

- From ChatGPT: custom GPTs, projects with their instructions and knowledge files, saved memories and custom instructions
- From Claude: projects with their instructions, knowledge documents and project memory, plus your memory outside projects and your "Instructions for Claude" preferences
- From Gemini: Gems with their instructions
- Project memory: what the assistant learned from chats inside a project comes along as a document in the new project

WHERE IT CAN GO

- Into Claude, automatically: PortSmith creates each project, sets the instructions, uploads the files and adds the project memory, then checks the result
- Into Gemini, automatically: PortSmith creates each Gem and adds the files and project memory to its knowledge
- Into ChatGPT, step by step: PortSmith shows each step with copy and download buttons

Your saved memories and custom instructions go into Gemini automatically (as "Your instructions for Gemini"), or through Claude's own memory import in one paste.

HOW IT WORKS

1. Read: open your current assistant in a tab. PortSmith reads your setup through the site's own interface, using the account you're already signed in to.
2. Review: see everything it found, choose what to move, and edit instructions or project memory first.
3. Move: pick automatic, step-by-step, or automatic with a confirmation before each item. Anything PortSmith can't do for you becomes a clear manual step, with the text to copy and the files to download.

At the end you get an honest summary: what was created, what was checked, and what still needs you.

PRIVATE BY DESIGN

- Runs entirely in your browser. PortSmith has no servers.
- No analytics, tracking or ads.
- No sign-up and no API keys.
- Your data only travels between your browser and the assistants you already use.
- One click deletes everything PortSmith saved.

SAFE TO STOP AND RESUME

PortSmith records its progress as it goes. If the browser closes mid-migration, it picks up where it left off and never creates the same project twice.

GOOD TO KNOW

- Chat history doesn't move.
- GPT Actions, image generation and other platform-specific tools can't be copied. PortSmith points these out.
- Gemini's memory import isn't available in every country or for every account type.
```

---

## Privacy → Single purpose description

Replaces the current 54-character line. Longer is better here: the reviewer uses this to judge whether every permission is in service of one job.

```
PortSmith moves a user's own AI assistant setup from one assistant to another. It reads the projects, custom GPTs, Gems, instructions, knowledge files, project memory and saved memories in the account the user is already signed in to, shows them for review, then recreates them on the assistant the user picked. Every feature serves that one job: read the setup, review it, write it to the target. Nothing is sent to PortSmith, which has no servers of its own.
```

---

## Privacy → storage justification

This is the one that matters. The live text claims the migration orchestrator uses chrome.storage.local to checkpoint progress. It does not; checkpoints go to IndexedDB through Dexie. You were rejected on 2026-03-03 for requesting storage without using it, so a justification a reviewer can disprove is the worst possible thing to leave in this box.

```
chrome.storage.local is used in exactly two places, both on the device.

1. Remembering the last platforms picked. setPreference runs when the user picks a source or a target (src/sidepanel/store/migration-store.ts, setSourcePlatform and setTargetPlatform); getPreference reads both back when the side panel opens, so a returning user's platforms are pre-selected.

2. Recording which Gemini memories were already saved. saveSavedMemoryIds stores the IDs Gemini returned for memories PortSmith created (src/core/storage/gemini-saved-memory.ts, called from src/background/migration-orchestrator.ts). Gemini rewrites the text it saves and accepts duplicates, so without this record a resumed migration would save every memory twice.

The side panel and the service worker are separate contexts and both need this data. In the package the calls are in assets/index.html-*.js and assets/service-worker.ts-*.js. Bulk data (extracted setups, file copies, checkpoints) goes to IndexedDB, not here.
```

---

## Privacy → sidePanel justification

Full replacement.

```
PortSmith's entire interface is a step-by-step migration wizard in Chrome's side panel. It has to stay open beside the ChatGPT, Claude or Gemini tab while the user reviews what was found, confirms each step and copies text, and while a migration runs for several minutes. A popup closes the moment the user clicks the page, and a separate tab cannot sit beside the page it is acting on, so the Side Panel API is the only way to support this. chrome.sidePanel.setPanelBehavior is called in the service worker so the toolbar icon opens the panel; there is no popup.
```

---

## Privacy → scripting justification

Full replacement.

```
chrome.scripting.executeScript is used in three places, all limited to the three declared hosts.

1. On chatgpt.com, PortSmith runs requests in the page's own context (world: "MAIN") to read the user's GPT and project settings through ChatGPT's own API with the session the user is already signed in to (src/background/service-worker.ts).

2. On chatgpt.com and claude.ai, where no API is available, it dispatches a click in the page's own context so the site's own UI components respond (CLICK_IN_MAIN_WORLD in src/background/service-worker.ts).

3. After install or update, it injects PortSmith's declared content scripts into matching tabs that were already open, so the user does not have to reload them (src/shared/messaging.ts).

A content script alone cannot do the first two, because it runs in an isolated world with no access to the page's own objects.
```

---

## Privacy → host permission justification

Covers all three hosts in the one field. If the dashboard gives you a separate field per host, `permission-justifications.md` has them split out.

```
PortSmith reads an AI assistant setup from one of these three sites and writes it to another, acting only on the account the user is already signed in to, from a tab of that site, and only after the user starts a run in the side panel.

chatgpt.com: reads custom GPTs (name, description, instructions), projects (instructions and knowledge files), saved memories and custom instructions.

claude.ai: an extractor reads projects, instructions, knowledge documents and, if the user asks, project memory, memory outside projects and the "Instructions for Claude" preferences. When Claude is the target, an importer creates projects, sets instructions, uploads documents and adds project memory, then reads them back to confirm. The org ID comes from Claude's own lastActiveOrg cookie.

gemini.google.com: an extractor lists Gems; an importer creates Gems, attaches knowledge files and saves memories.

All three navigate client-side, so a narrower match pattern would break a run partway through.
```

---

## Leave these alone

**Data usage checkboxes.** Currently checked: Authentication information, Website content. Everything else unchecked. That is the right set and it already passed review for 0.3.0.

- Website content is correct: instructions, knowledge files, project memory and saved memories are all site content.
- Authentication information is correct and worth keeping. PortSmith reads ChatGPT's session token and Gemini's page token to make requests, and the privacy policy says so under "What PortSmith reads". Unchecking it right after a permissions rejection would be the wrong direction.
- Personally identifiable information is the only arguable one. Saved memories are free text and often contain names and places. It is unchecked today and 0.3.0 passed that way, and PortSmith never asks for or targets personal information, so leaving it unchecked is defensible. Checking it costs nothing on the listing except a line on the public detail page, and closes a gap a reviewer could open. Your call; no change is the lower-risk move.

**Privacy policy URL.** Unchanged: https://hekleiman.github.io/portsmith/privacy-policy.html

**Screenshots.** Five are uploaded and the store does not require new ones for an update. They are from the 0.3.0 listing and show the old UI, so 0.4.0 screens (the review page with the project memory badge, the results page) are not represented. That is a quality call, not a blocker. If you do reshoot, `screenshot-checklist.md` has the seven shots and the five to upload.

---

## Before you press Submit

- [ ] `main` pushed, then reload the privacy policy URL and confirm it says "version 0.4.0" and mentions Gemini.
- [ ] `portsmith-v0.4.0.zip` uploaded and the version reads 0.4.0.
- [ ] Description, single purpose and all four justifications replaced.
- [ ] Test items deleted: Claude project "PortSmith test (delete me)", Gemini Gem "PortSmith test Gem (delete me)".
