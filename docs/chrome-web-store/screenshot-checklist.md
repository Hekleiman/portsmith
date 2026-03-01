# Chrome Web Store — Screenshot Checklist

> CWS allows up to 5 screenshots. Recommended dimensions: 1280x800 px (16:10).
> All screenshots should show the PortSmith side panel alongside the relevant web page.
> Use a clean Chrome profile with no other extensions visible in the toolbar.

---

## Screenshot 1: Source Selection (Welcome)

**What to show:** The PortSmith side panel open on the left, displaying the "Where are you migrating from?" screen with the ChatGPT platform card selected (green highlight). The main browser tab should show the ChatGPT homepage (logged in, sidebar visible with a few projects/GPTs).

**Dimensions:** 1280x800

**Caption:** Choose your source platform — PortSmith reads your ChatGPT setup directly from the browser.

**Wizard step:** Step 1 — Source selection

**Notes:** This screenshot establishes what the extension is and where it lives in the browser. The side panel + ChatGPT tab layout should be immediately clear.

---

## Screenshot 2: Extraction in Progress

**What to show:** The side panel displaying the "Extracting Data" screen with the ProgressTracker visible — some steps completed (green checkmarks), one step active (blue spinner), and remaining steps pending. The detail text should show real counts like "Found 3 projects, 2 GPTs". The ChatGPT tab should be visible in the background.

**Dimensions:** 1280x800

**Caption:** PortSmith scans your ChatGPT sidebar, projects, Custom GPTs, memory, and instructions automatically.

**Wizard step:** Step 4 — Extraction

**Notes:** This shows the extension actively working. Ideally capture with 3+ projects and 2+ GPTs in the detail text to demonstrate real-world usage.

---

## Screenshot 3: Review & Edit

**What to show:** The side panel displaying the "Review Extracted Data" screen with several WorkspaceCards visible — each showing a project/GPT name, instruction preview, knowledge file count, and a toggle checkbox. The summary stats bar at the top should show counts like "Found 5 workspaces, 3 memory items, 2 files". At least one card should be expanded enough to show the instruction text preview.

**Dimensions:** 1280x800

**Caption:** Review everything before migrating — edit names, toggle items, and see compatibility notes.

**Wizard step:** Step 5 — Review

**Notes:** This is the "trust" screenshot. Users need to see that they have full control over what gets migrated. Show a mix of projects and GPTs with realistic names.

---

## Screenshot 4: Migration Mode Selection

**What to show:** The side panel displaying "How should we import?" with the three mode cards visible — Autofill (Fastest), Guided (Most Reliable), and Hybrid (Recommended). The Hybrid card should be selected (highlighted border). The browser tab behind should show `claude.ai/projects`.

**Dimensions:** 1280x800

**Caption:** Choose your migration style — fully automatic, step-by-step guided, or hybrid with confirmation at each step.

**Wizard step:** Step 6 — Mode selection

**Notes:** This screenshot demonstrates that the user stays in control. The three clear options with pros/cons badges make the extension feel trustworthy and well-designed.

---

## Screenshot 5: Migration Complete

**What to show:** The side panel displaying the completion summary — the MigrationSummary component showing a list of migrated workspaces with green success checkmarks, a "Migration Complete" heading, and the summary stats. The browser tab should show the Claude projects page with the newly created projects visible in Claude's project list, confirming they were actually created.

**Dimensions:** 1280x800

**Caption:** Done — your ChatGPT projects are now Claude projects. PortSmith verifies each one was created successfully.

**Wizard step:** Step 8 — Complete

**Notes:** End on a success state. The side-by-side of PortSmith's success screen + Claude's project list showing the same project names is the strongest proof the extension works. Use realistic project names that a non-technical user would relate to (e.g., "Trip Planner", "Resume Helper", not "test-gpt-1").
