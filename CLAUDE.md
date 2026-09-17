# CLAUDE.md: PortSmith

## Project Overview

PortSmith is a Chrome (MV3) extension that moves AI assistant setups (projects, custom GPTs, Gems, instructions, knowledge files, memory and project memory) between ChatGPT, Claude and Gemini. Everything runs client-side; there is no PortSmith server.

**Current version: 0.4.0.** Six directions:
- Into Claude and Gemini: automatic (internal web APIs from content scripts), with manual fallback cards.
- Into ChatGPT: guided only (no automated importer yet).
- Same-platform migrations are blocked.

---

## Tech Stack (Locked Versions)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Extension | CRXJS + Vite | Manifest V3, Chrome Side Panel API |
| UI | React 19 + TypeScript (strict) | Side panel wizard (no popup: the toolbar icon opens the panel) |
| Styling | Tailwind CSS | Utility classes only, no custom CSS unless necessary |
| State | Zustand | Global extension state, migration state machine |
| Validation | Zod | Runtime validation + TypeScript inference for all schemas |
| Local Storage | Dexie.js (IndexedDB) | Large blobs, manifest data, migration checkpoints |
| Preferences | chrome.storage.local | User settings, selector cache |
| LLM | None | Instruction adaptation is rule-based (`src/core/transform/prompt-translator.ts`) |
| Testing | Vitest (unit) + Playwright scripts (E2E) | Playwright is not a dependency; see Testing |
| Linting | ESLint + Prettier | Enforced on commit |

**DO NOT** introduce new dependencies without explicit justification. Especially:
- No styled-components, emotion, or CSS-in-JS
- No Redux, MobX, or Jotai (Zustand only)
- No jQuery or DOM utility libraries
- No Axios (use native fetch)

---

## Project Structure

```
portsmith/
├── manifest.json                 # MV3 manifest (storage, sidePanel, scripting + 3 hosts)
├── public/icons/                 # Extension icons
├── scripts/                      # Playwright E2E scripts (run against dist/)
├── src/
│   ├── background/
│   │   ├── service-worker.ts     # Router init, privileged handlers (sender-checked)
│   │   └── migration-orchestrator.ts  # Runs migrations; owns checkpoints while migrating
│   ├── content-scripts/
│   │   ├── common/               # Selector engine
│   │   ├── chatgpt/              # Extractor (API first, DOM fallback)
│   │   ├── claude/               # api.ts helpers, extractor, importer
│   │   └── gemini/               # batchexecute session, extractor, importer
│   ├── core/
│   │   ├── adapters/             # Per-target steps: claude-autofill, *-guided, manual-fallback
│   │   ├── schema/               # Zod schemas (PortsmithManifest)
│   │   ├── storage/              # Dexie (manifests, files, checkpoints), preferences
│   │   ├── transform/            # Manifests, prompt translator, memory, project memory
│   │   └── platforms.ts          # Labels, supported modes, per-target instructions
│   ├── shared/                   # messaging.ts (typed router), encoding, chatgpt-ids, constants
│   └── sidepanel/                # Wizard UI (pages, components, Zustand store)
└── tests/                        # unit/ and integration/ (Vitest, node environment)
```

---

## Coding Standards

### TypeScript
- `strict: true` in tsconfig, no exceptions
- Explicit return types on all exported functions
- No `any` without a `// eslint-disable-next-line` + justification comment
- All interfaces/types for the Universal Interchange Schema live in `src/core/schema/types.ts`
- Use Zod schemas as single source of truth, infer TS types with `z.infer<>`

### React Components
- Functional components only, no class components
- Props interfaces defined and exported above the component
- Hooks extracted to `hooks/` when reused across 2+ components
- Use `React.memo` only with measured performance justification

### Extension-Specific Patterns
- **Service worker is ephemeral**: it can be terminated at any time. Never keep state only in service worker memory; persist it to IndexedDB or chrome.storage. Anything created on a target must be checkpointed right away (`createdWorkspaceIds`) so a resumed run never creates it twice
- **Message passing is the only communication** between background, content scripts, and side panel. Use the typed message router in `src/shared/messaging.ts`
- **Content scripts run in an isolated world**: they can use the DOM and same-origin `fetch`, but talk to the rest of the extension only through `src/shared/messaging.ts`. All content scripts on a site share one module instance, and `initMessageRouter()` must stay idempotent
- **Side panel persists across navigations**, which is why the wizard lives there

### DOM Interaction (Content Scripts)
- NEVER use a single CSS selector. Always use `SelectorStrategy[]` with priority cascade:
  1. `data-testid` attributes (most stable)
  2. `aria-label` attributes
  3. CSS class selectors
  4. Text content matching (least stable, always works)
- If all selectors fail → trigger Guided Mode fallback, never throw
- All selectors defined in per-platform `selectors.ts` files

### State Management
- Zustand store for the wizard (`src/sidepanel/store/migration-store.ts`; phase types and checkpoint helpers in `src/core/storage/migration-state.ts`)
- IndexedDB (via Dexie) for: manifest data, extracted content, file blobs, migration checkpoints
- chrome.storage.local for: user preferences (last-used platforms)
- **Tokens are never persisted**: the ChatGPT access token is cached in service worker memory for 5 minutes at most

### Styling
- Tailwind utility classes only
- No inline styles except for dynamic values (e.g., progress bar width)
- Side panel is about 400px wide, so design for that
- Dark mode support not required for V1 (extension UI only)

### Testing
- Unit tests for all `core/` modules (schema validation, translation rules, adapters)
- Test fixtures: sample ChatGPT export JSON in `tests/fixtures/`
- E2E tests with Playwright for critical migration flows
- Minimum: every Zod schema has a valid and invalid parse test

### Security
- No hardcoded API keys anywhere
- User-provided API keys stay in memory only
- Content scripts request minimum necessary DOM access
- File uploads processed entirely client-side
- No data sent to any server unless user explicitly enables cloud LLM

### Git
- Branch per feature: `feat/chatgpt-extractor`, `feat/side-panel-wizard`, etc.
- Commit after each completed task with descriptive message
- Never commit `node_modules/`, `.env`, or IndexedDB dumps

---

## Writing and UI copy

- No em dashes anywhere in UI copy, warnings or docs. Use a colon, comma or a new sentence.
- Say what happened and what the user can do next. Never report success for something that wasn't done or checked.

## Testing

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- E2E (needs Playwright, which is intentionally not a dependency):
  `npm i --no-save playwright && npx playwright install chromium`, then
  `node scripts/e2e-duplicate-dispatch.mjs dist` and `node scripts/e2e-claude-autofill.mjs dist`.
  Both stub the sites with Playwright routes and never touch real accounts.

## Platform APIs (internal, unversioned)

These are the sites' own web APIs, so they can change without notice. Check them against a live account before relying on a change.
- **Claude** (`/api/organizations/{org}/...`):
  - The project list doesn't include instructions, so read `/projects/{id}` for `prompt_template`.
  - Text knowledge goes to `POST /projects/{id}/docs` as JSON `{file_name, content}`. Binary files go to `POST /projects/{id}/upload` as multipart.
  - Project memory is read with `POST /melange/list` and `/melange/read`, falling back to `/memory?project_uuid=`. There is no direct write, so memory travels as a project document.
- **Gemini:** `batchexecute`, using the page tokens `SNlM0e`, `cfb2h` and `FdrFJe`. RPCs: `CNgdBe` lists Gems, `oMH3Zd` creates one, `kHv0Vd` updates one.
- **ChatGPT:**
  - `/backend-api/gizmos/{id}` needs a bearer token from `/api/auth/session`.
  - Project IDs are `g-p-<32 hex>`, and sidebar URLs add a slug after it. Normalize with `src/shared/chatgpt-ids.ts`.

---

## Key Architectural Decisions (Reference)

1. **Side Panel** for the wizard UI, next to the platform page
2. **Client-side processing only**: no PortSmith servers, analytics or telemetry
3. **Multi-strategy selector cascade** with Guided Mode fallback when DOM breaks
4. **IndexedDB checkpoints** after every workspace migration for crash recovery
5. **Single extension package** (a shared `@portsmith/schema` package is a later option)
6. **No LLM**: rule-based translation that must preserve meaning (role prompts are kept; all-caps emphasis is written in normal case; code is never touched)
