# TASK

Add a Gemini "skill" route: generate a SKILL.md for each workspace, and from Nov 17, 2026 point every manual Gemini create step at Gemini skills instead of the Gem manager.

# CONTEXT

Google is replacing Gems with skills (Google help article https://support.google.com/gemini/answer/18560919, read 11/8/26):
- Personal Google accounts (18+): on **2026-11-17** Gems become read-only and are migrated to skills. On **2026-12-17** Gems are removed.
- Workspace business/enterprise accounts move in March 2027, education in June 2027, so the Gem path still works for them.

PortSmith's automatic Gemini path creates Gems with RPC `oMH3Zd`. After Nov 17 that will very likely fail on personal accounts. When it fails, the manual fallback card and the guided Gemini flow currently send users to "New Gem" in the Gem manager, which won't exist for them. This change gives them a working route.

Verified live in Gemini on 11/9/26 (Plus personal account, read-only look, nothing created):
- The Gem manager (`https://gemini.google.com/gems/view`) shows a banner: "Gems will become skills starting Nov 17, 2026".
- The Skills page is `https://gemini.google.com/customize/skills`. Its "Create" button opens a menu with "Create with Gemini", "Create manually" and "Upload".
- "Create manually" opens an editor with the fields "Name" (placeholder example: "meeting-notes-summarizer"), "Description" and "Instructions", plus the buttons "Add files" and "Create".

SKILL.md format (Agent Skills spec, agentskills.io/specification): YAML frontmatter, then a Markdown body.
- `name`: required, 1 to 64 characters, lowercase a-z, 0-9 and hyphens only, no leading, trailing or consecutive hyphens.
- `description`: required, 1 to 1024 characters, says what the skill does and when to use it.

# SCOPE (about 30 minutes)

Create:
- `src/core/transform/skill-package.ts`
- `tests/unit/skill-package.test.ts`

Modify:
- `src/core/adapters/manual-fallback.ts` (`CREATE_STEPS.gemini`, `buildManualCreateFallback`)
- `src/core/adapters/gemini-guided.ts` (`generateGeminiInstructions`, and `buildGemKnowledgeStep` only if its wording names Gems on the skill route)
- `src/content-scripts/gemini/importer.ts` (`buildCreateFallback` steps only)
- `src/sidepanel/pages/TargetSelect.tsx` (one short notice on the Gemini option)
- `tests/unit/gemini-guided.test.ts` and any existing manual-fallback test that asserts Gem wording

# IMPLEMENTATION REQUIREMENTS

1. `skill-package.ts` (pure, no chrome APIs, no new dependencies):
   - `export const GEMS_TO_SKILLS_DATE = "2026-11-17"`.
   - `export function geminiUsesSkills(now: Date = new Date()): boolean`: true on or after 2026-11-17 in America/Los_Angeles (treat 2026-11-17T00:00:00-08:00 as the cutoff).
   - `export function toSkillName(name: string): string`: lowercase, transliterate or drop non a-z0-9, collapse runs of other characters to one hyphen, trim hyphens, cut to 64 without a trailing hyphen. If nothing is left, return `"imported-assistant"`.
   - `export function renderSkillMd(input: { name: string; description: string; instructions: string; fileNames: string[]; sourceLabel: string }): string`:
     - frontmatter `name: <toSkillName(name)>` and `description:` built from the description, or if empty `"<name>, imported from <sourceLabel>. Use for the same tasks as the original assistant."`. Cut to 1024 characters on a word boundary. Quote the YAML value safely (escape backslashes and double quotes, single line, no newlines).
     - body: `# <original name>`, a blank line, the instructions verbatim, and, when `fileNames` is non-empty, a `## Reference files` section listing each file name as a bullet.
2. `manual-fallback.ts`: for `target === "gemini"`:
   - When `geminiUsesSkills()` is true, `CREATE_STEPS` content for Gemini becomes the skill route. Link: `https://gemini.google.com/customize/skills`. Steps:
     1. `Open Skills in Gemini, click "Create" and choose "Create manually".`
     2. `Paste the name, description and instructions.`
     3. `Click "Add files" and add the files and the project memory document.`
     4. `Click "Create".`
     Card title: `Create "<name>" as a Gemini skill by hand`. Copy block label "Name" holds `toSkillName(name)`.
   - Before the cutoff, keep the current Gem steps unchanged.
   - In both cases add a download to the card: label `SKILL.md for "<name>"`, fileName `<toSkillName(name)>-SKILL.md`, mimeType `text/markdown`, content from `renderSkillMd`. Put it first in `downloads`.
   - Make the date check injectable for tests (an optional `now` parameter threaded through, or a module-level clock you can stub). Don't call `new Date()` at module load.
3. `gemini-guided.ts`: when `geminiUsesSkills()` is true, `generateGeminiInstructions` produces the skill route with the same labels as above ("Open Skills", "Create manually", "Name", "Description", "Instructions", "Add files", "Create"). No step may mention "Gem", "New Gem", "Gem manager" or `/gems/` on the skill route. Before the cutoff, output is unchanged.
4. `importer.ts` `buildCreateFallback`: same date switch, plain text steps matching item 2.
5. `TargetSelect.tsx`: under the Gemini option, one line of small gray text: `Gemini is turning Gems into skills on Nov 17. On personal Google accounts, PortSmith will hand you a skill to add instead.` Match the existing Tailwind classes used for secondary text on that page. Show it until 2026-12-17 (the removal date), then hide it.
6. Copy rules from CLAUDE.md: no em dashes anywhere, say what happened and what to do next.

# ACCEPTANCE CRITERIA

- [ ] `renderSkillMd` output starts with `---\nname: ` and passes these tests: name "My Résumé Helper!!" becomes `my-resume-helper` (or `my-r-sum-helper` if you drop rather than transliterate; pick one and test it), a 100-character name is cut to at most 64 with no trailing hyphen, an empty description gets the fallback text, a description with a double quote and a newline still yields valid single-line YAML, and a 2000-character description is cut to at most 1024.
- [ ] With `now` = 2026-11-17T09:00:00-08:00, the Gemini manual card links to `/customize/skills`, has no "Gem" wording, and its first download is the SKILL.md. With `now` = 2026-11-16T09:00:00-08:00 the card is the old Gem card plus the SKILL.md download.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass.

# EXCLUDES

- Do not change the automatic Gem create path (`createGem`, the `oMH3Zd` payload, or the orchestrator's retry and duplicate logic). How Gemini answers `oMH3Zd` after Nov 17 is unknown and will be checked live on Nov 17.
- No skill .zip packaging (fflate) and no automated skill creation RPC. SKILL.md as one text file only.
- No changes to ChatGPT or Claude targets, extractors, or Gemini saved-info code.
- No version bump, no manifest change, no store listing or privacy policy edits. Release is a separate prompt.
- Do not edit or commit the untracked `AGENTS.md` at the repo root.

# TESTING

Run `npm run typecheck && npm run lint && npm test && npm run build`. Report the test count before and after.

# GIT

- Create branch `feat/gemini-skills-fallback` from `main`.
- Commit with a conventional message (`feat(gemini): ...`), push, and open a PR against `main` titled `Gemini: skill route for Gems retiring Nov 17`. In the PR body, list what changed, the live-verified labels above, and the open question (how `oMH3Zd` behaves after Nov 17).
- Do not merge.

# REPORT

End with: branch, commit SHA, PR URL, test counts, and anything you could not do or had to decide yourself.
