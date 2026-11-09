# Chrome Web Store Listing: PortSmith (v0.5.1)

## Extension Name

**PortSmith**

> Must match `"name"` in manifest.json.

---

## Short Description

> Max 132 characters. Keep it in sync with `"description"` in manifest.json.

```
Move your AI setup between ChatGPT, Claude and Gemini: projects, GPTs, Gems, files and memory. Private and in-browser.
```

---

## Full Description

> Paste into the CWS "Detailed description" field.

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
- Into Gemini: PortSmith creates each Gem automatically, with the files and project memory in its knowledge, where Gemini still offers Gems. On personal Google accounts, from Nov 17, Gemini turns Gems into skills, so PortSmith hands you a ready-made Gemini skill (with a SKILL.md file) to add by hand
- Into ChatGPT, automatically: PortSmith creates each project, sets the instructions and adds the files and project memory to its Sources

Your saved memories and custom instructions go into Gemini automatically (as "Your instructions for Gemini"), or through Claude's own memory import in one paste. Into ChatGPT, memories and custom instructions are added step by step.

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

## Draft for v0.5.2 (not yet published)

> Draft text only. The v0.5.2 release run publishes it and moves it into the sections above.

Summary area (add as the first line of the Full Description):

```
Rescue your custom GPTs before OpenAI retires them on Dec 11
```

What's New:

```
- New: download a backup of your custom GPTs, with a skill file for each, before OpenAI retires them on Dec 11
```

---

## What's New in v0.5.1

> Paste into the CWS "Changes in this version" field.

```
- New: Gemini is turning Gems into skills on Nov 17. On personal Google accounts, PortSmith now gives you a ready-made skill to add, with a SKILL.md file
- Fixed: files in ChatGPT projects weren't copied, so each one had to be uploaded by hand
```

---

## What's New in v0.5.0 (previous release)

> Kept for reference. Not for this submission.

```
- New: automatic migration into ChatGPT: projects, instructions, files and project memory
- New: names and instructions longer than ChatGPT allows are shortened, and the full instructions are kept as a project file
- Fixed: ChatGPT projects and custom GPTs were not found, so extraction stopped with nothing to migrate
- Fixed: PortSmith reported "Not logged in to ChatGPT" on a signed-in account
- Improved: reading from ChatGPT works from any ChatGPT page
- Improved: files too large to pass through the extension are listed for manual upload instead of failing
```

---

## Category

**Productivity**

---

## Language

**English**

---

## Suggested Tags / Keywords

1. `ai migration`
2. `chatgpt to claude`
3. `gemini gems`
4. `custom gpt`
5. `project memory`
