# Dashboard replacements for v0.4.0

Full replacements, in the order to do them. Nothing here is a diff; each block replaces everything in its field.

**Item:** PortSmith, ID `jgicdjjebakiobiehdfdbgkfknkidhcd`, status Published - public. This is an update to a live listing.

**Direct links** (left nav is Build → Status, Package, Store listing, Privacy, Distribution):

| Tab | Link |
|---|---|
| Package | https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/package |
| Store listing | https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/listing |
| Privacy | https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/privacy |

Two gates before any of this:

- **`main` has to be pushed first.** The privacy policy URL on this listing is served from `main:/docs`. Until the push, a reviewer clicking it gets the March policy with no Gemini in it.
- **Do step 1 before step 2.** "Title from package" and "Summary from package" on the Store listing tab are read out of the manifest, and both still show 0.3.0 text until the new zip is uploaded.

---

## 1. Upload the package

**Where:** Build → Package, https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/package

Upload `~/portsmith/portsmith-v0.4.0.zip` (219,406 bytes, sha256 `9fad374a...`). After it processes, the Package tab should read version 0.4.0, and the Store listing tab's summary should change from "Migrate AI assistant configurations between platforms" to "Move your AI setup between ChatGPT, Claude and Gemini: projects, GPTs, Gems, files and memory. Private and in-browser."

Nothing to paste in this step.

---

## 2. Description

**Where:** Build → Store listing, https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/listing. First section, **Product details**, the large box labelled `Description*`, directly under "Summary from package". Select all in the box and paste over it.

The live text has an em dash in it, is written for 0.3.0, and does not mention Gemini memories, project memory or the guided ChatGPT path.

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

## 3. Single purpose description

**Where:** Build → Privacy, https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/privacy. First section, **Single purpose**, the box labelled `Single purpose description*`. It currently reads "Migrates AI assistant configurations between platforms" and shows 54/1,000.

Longer is better here. The reviewer uses this line to judge whether every permission serves one job, and the three-permission case rests on it.

```
PortSmith moves a user's own AI assistant setup from one assistant to another. It reads the projects, custom GPTs, Gems, instructions, knowledge files, project memory and saved memories in the account the user is already signed in to, shows them for review, then recreates them on the assistant the user picked. Every feature serves that one job: read the setup, review it, write it to the target. Nothing is sent to PortSmith, which has no servers of its own.
```

---

## 4. storage justification

**Where:** Same page, https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/privacy. Second section, **Permission justification**, first box, labelled `storage justification*`. It sits just under the yellow banner about host permissions triggering an in-depth review.

This is the one that matters. The live text says the migration orchestrator uses chrome.storage.local to checkpoint progress. It does not. Checkpoints go to IndexedDB through Dexie (`db.checkpoints.put` in `indexed-db.ts`), and only two files in the tree touch chrome.storage. You were rejected on 2026-03-03 for requesting storage without using it, so leaving a claim a reviewer can disprove in this exact box is the worst available option.

```
chrome.storage.local is used in exactly two places, both on the device.

1. Remembering the last platforms picked. setPreference runs when the user picks a source or a target (src/sidepanel/store/migration-store.ts, setSourcePlatform and setTargetPlatform); getPreference reads both back when the side panel opens, so a returning user's platforms are pre-selected.

2. Recording which Gemini memories were already saved. saveSavedMemoryIds stores the IDs Gemini returned for memories PortSmith created (src/core/storage/gemini-saved-memory.ts, called from src/background/migration-orchestrator.ts). Gemini rewrites the text it saves and accepts duplicates, so without this record a resumed migration would save every memory twice.

The side panel and the service worker are separate contexts and both need this data. In the package the calls are in assets/index.html-*.js and assets/service-worker.ts-*.js. Bulk data (extracted setups, file copies, checkpoints) goes to IndexedDB, not here.
```

---

## 5. sidePanel justification

**Where:** Same page, same **Permission justification** section, the box labelled `sidePanel justification`, below the storage box.

Full replacement.

```
PortSmith's entire interface is a step-by-step migration wizard in Chrome's side panel. It has to stay open beside the ChatGPT, Claude or Gemini tab while the user reviews what was found, confirms each step and copies text, and while a migration runs for several minutes. A popup closes the moment the user clicks the page, and a separate tab cannot sit beside the page it is acting on, so the Side Panel API is the only way to support this. chrome.sidePanel.setPanelBehavior is called in the service worker so the toolbar icon opens the panel; there is no popup.
```

---

## 6. scripting justification

**Where:** Same page, same section, the box labelled `scripting justification`, below the sidePanel box.

Full replacement.

```
chrome.scripting.executeScript is used in three places, all limited to the three declared hosts.

1. On chatgpt.com, PortSmith runs requests in the page's own context (world: "MAIN") to read the user's GPT and project settings through ChatGPT's own API with the session the user is already signed in to (src/background/service-worker.ts).

2. On chatgpt.com and claude.ai, where no API is available, it dispatches a click in the page's own context so the site's own UI components respond (CLICK_IN_MAIN_WORLD in src/background/service-worker.ts).

3. After install or update, it injects PortSmith's declared content scripts into matching tabs that were already open, so the user does not have to reload them (src/shared/messaging.ts).

A content script alone cannot do the first two, because it runs in an isolated world with no access to the page's own objects.
```

---

## 7. Host permission justification

**Where:** Same page, same section, the last box, labelled for the host permissions (chatgpt.com, claude.ai, gemini.google.com). If the dashboard splits this into one box per host, `permission-justifications.md` has them written separately.

One field covering all three hosts.

```
PortSmith reads an AI assistant setup from one of these three sites and writes it to another, acting only on the account the user is already signed in to, from a tab of that site, and only after the user starts a run in the side panel.

chatgpt.com: reads custom GPTs (name, description, instructions), projects (instructions and knowledge files), saved memories and custom instructions.

claude.ai: an extractor reads projects, instructions, knowledge documents and, if the user asks, project memory, memory outside projects and the "Instructions for Claude" preferences. When Claude is the target, an importer creates projects, sets instructions, uploads documents and adds project memory, then reads them back to confirm. The org ID comes from Claude's own lastActiveOrg cookie.

gemini.google.com: an extractor lists Gems; an importer creates Gems, attaches knowledge files and saves memories.

All three navigate client-side, so a narrower match pattern would break a run partway through.
```

---

## 8. Check, then submit

**Where:** Build → Privacy, https://chrome.google.com/webstore/devconsole/68ef56eb-937d-4392-8285-2a5113a73a04/jgicdjjebakiobiehdfdbgkfknkidhcd/edit/privacy, scrolled to **Data usage**, then the blue **Submit for review** button at the top right of any tab.

Confirm the data usage boxes still read: Authentication information checked, Website content checked, everything else unchecked. Confirm the three "I certify" boxes are checked. Then Submit.

Expect a slower review than usual. The banner on the Privacy tab says the host permissions may trigger an in-depth review.

---

## Leave these alone

**Data usage checkboxes.** Authentication information and Website content, both already checked, everything else clear. That set already passed review for 0.3.0.

- Website content is right: instructions, knowledge files, project memory and saved memories are all site content.
- Authentication information is right and worth keeping. PortSmith reads ChatGPT's session token and Gemini's page token to make its requests, and the privacy policy says so under "What PortSmith reads". Unchecking it right after a permissions rejection points the wrong way.
- Personally identifiable information is the only arguable one, and it is unchecked. Saved memories are free text and often carry names and places. PortSmith never asks for or targets personal information and 0.3.0 passed this way, so unchecked is defensible. Checking it costs one line on the public detail page and closes a gap a reviewer could open. Your call. No change is the lower-risk move.

**Privacy policy URL.** Unchanged: https://hekleiman.github.io/portsmith/privacy-policy.html. I did not see this field on the Privacy tab; on this dashboard it may sit under Account → Profile at the publisher level. Worth a look while you are in there, since it is what a reviewer clicks.

**Screenshots.** Build → Store listing, **Graphic assets** → Screenshots. Five are uploaded and the store does not require new ones for an update, so these are not blocking. They are the 0.3.0 shots and do not show the 0.4.0 screens (the review page with the project memory badge, the results page). If you do reshoot, `screenshot-checklist.md` has the seven shots and which five to upload.

**Release notes.** I could not confirm a "Changes in this version" field on your dashboard. If one appears during submission, the text is in `store-listing.md` under "What's New in v0.4.0".

---

## Before you press Submit

- [ ] `main` pushed, then reload https://hekleiman.github.io/portsmith/privacy-policy.html and confirm it says "version 0.4.0" and mentions Gemini.
- [ ] Package tab reads 0.4.0 and the summary changed.
- [ ] Description, single purpose and all four justifications replaced.
- [ ] Test items deleted: Claude project "PortSmith test (delete me)", Gemini Gem "PortSmith test Gem (delete me)".
