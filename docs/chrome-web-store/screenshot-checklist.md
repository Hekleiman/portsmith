# Chrome Web Store: Screenshot Checklist (v0.4.0)

The Chrome Web Store takes up to 5 screenshots at 1280x800 (16:10). This checklist covers all 7 wizard screens, so there's a spare shot for each slot. The five marked **Upload** are the recommended set.

Setup for every shot:
- Use a clean Chrome profile with only PortSmith in the toolbar.
- Open the PortSmith side panel (click the toolbar icon) next to the site it's working with.
- Use sample content with everyday names (for example "Trip Planner" or "Resume Helper"). Never use real personal content.
- The example run is ChatGPT to Claude, unless a shot says otherwise.

---

## 1. Source (Upload)

- **Screen:** "Where are you migrating from?" with the ChatGPT card selected.
- **Behind it:** chatgpt.com, signed in, with a few projects in the sidebar.
- **Caption:** Pick the assistant you use today. PortSmith reads your setup right in the browser.

## 2. Target

- **Screen:** "Where are you migrating to?" with Claude selected. ChatGPT is not listed, because PortSmith hides the source to block same-platform moves.
- **Behind it:** chatgpt.com.
- **Caption:** Choose where your setup should go: Claude, Gemini or ChatGPT.

## 3. Reading

- **Screen:** "Reading your ChatGPT data" with the progress list: some steps done, one running, the rest waiting. The detail line shows real counts (for example 3 projects and 2 GPTs).
- **Behind it:** chatgpt.com.
- **Caption:** PortSmith finds your projects, GPTs, files, memories and custom instructions.
- **Also possible:** "Reading your Claude Projects" when Claude is the source.

## 4. Review (Upload)

- **Screen:** "Review Extracted Data" with several workspace cards. At least one card shows both badges:
  - "Instructions adjusted for Claude"
  - "Project memory: N notes"
- **Also show:** the summary counts at the top and one card's instruction preview.
- **Caption:** Check everything first. Choose what moves, edit instructions and review project memory.
- **Tip:** open one workspace for a spare shot of the instruction comparison and the "Project memory" editor.

## 5. Mode (Upload)

- **Screen:** "How should we import?" with three cards:
  - Autofill ("Fastest")
  - Guided ("Most Reliable")
  - Hybrid ("Recommended"), shown selected
- **Behind it:** claude.ai/projects.
- **Caption:** Automatic, step by step, or automatic with a check before each item.

## 6. Migrate (Upload)

- **Screen:** "Hybrid to Claude" in progress:
  - one workspace done;
  - one running, with its steps listed (create project, instructions, files, project memory, check);
  - the Pause control visible.
- **Behind it:** claude.ai showing the new project.
- **Caption:** PortSmith creates each project, adds instructions, files and project memory, then checks the result.
- **Spare shot:** the "Bring over your memory" step, which walks through Claude's memory import.

## 7. Results (Upload)

- **Screen:** "Migration finished" with the summary: projects created and checked, files and project memory delivered, and any follow-up items listed plainly.
- **Behind it:** claude.ai/projects with the same project names.
- **Caption:** An honest summary: what was created, what was checked, and what still needs you.
- **Note:** keep the follow-up list short but visible. It shows that PortSmith doesn't claim work it didn't do.

---

## Before uploading

- [ ] Every shot is 1280x800 and shows the current 0.4.0 UI (no popup, the side panel only).
- [ ] No real names, email addresses, avatars, chat titles or memory content are visible (check both the side panel and the site behind it).
- [ ] Captions contain no em dashes.
- [ ] The order in the dashboard is 1, 4, 5, 6, 7.

## Privacy policy hosting

- **Listing URL:** https://hekleiman.github.io/portsmith/privacy-policy.html
- **Source:** GitHub Pages, from `main:/docs`.
- **Current status (checked 2026-09-17):** the live page still shows "Effective date: March 1, 2026". The 0.4.0 version ("Effective date: September 16, 2026 (version 0.4.0)") is on `release/v0.4.0` and goes live only after PR #1 is merged into `main`.
- [ ] After the merge, reload the URL and confirm it shows "version 0.4.0" before submitting.

## Fields to paste into the dashboard

| Dashboard field | Source |
|-----------------|--------|
| Short description | `store-listing.md`, "Short Description" (must match `description` in `manifest.json`) |
| Detailed description | `store-listing.md`, "Full Description" |
| What's new / release notes | `store-listing.md`, "What's New in v0.4.0" |
| Single purpose | Not written yet. Suggested: "Move a user's AI assistant setup (projects, GPTs, Gems, instructions, files and memory) between ChatGPT, Claude and Gemini." |
| Permission justifications (`storage`, `sidePanel`, `scripting`) | `permission-justifications.md` |
| Host permission justification (chatgpt.com, claude.ai, gemini.google.com) | `permission-justifications.md` |
| Data usage disclosures | `privacy-policy.html` (no data collected or sent to PortSmith; everything stays in the browser) |
| Privacy policy URL | https://hekleiman.github.io/portsmith/privacy-policy.html |
| Package | `portsmith-v0.4.0.zip` (built from `dist/`, not committed) |
