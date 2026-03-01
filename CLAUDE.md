# CLAUDE.md — Portsmith

## Project Overview

Portsmith is a Chrome browser extension that migrates AI assistant configurations (projects, custom GPTs, memory, instructions, knowledge files) between platforms (ChatGPT, Claude, Gemini). Privacy-first: all processing runs client-side by default.

**V1 MVP**: ChatGPT → Claude migration only. One direction, proven, then expand.

---

## Tech Stack (Locked Versions)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Extension | CRXJS + Vite | Manifest V3, Chrome Side Panel API |
| UI | React 19 + TypeScript (strict) | Side panel wizard + popup |
| Styling | Tailwind CSS | Utility classes only, no custom CSS unless necessary |
| State | Zustand | Global extension state, migration state machine |
| Validation | Zod | Runtime validation + TypeScript inference for all schemas |
| Local Storage | Dexie.js (IndexedDB) | Large blobs, manifest data, migration checkpoints |
| Preferences | chrome.storage.local | User settings, selector cache |
| LLM (optional) | WebLLM (local) / Anthropic SDK (cloud) | Not required for V1 rule-based translation |
| Testing | Vitest (unit) + Playwright (E2E) | Extension-aware E2E tests |
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
├── manifest.json
├── src/
│   ├── background/              # Service worker (Manifest V3)
│   │   ├── service-worker.ts
│   │   ├── message-router.ts    # Type-safe extension messaging hub
│   │   └── migration-orchestrator.ts
│   ├── content-scripts/
│   │   ├── common/              # Shared DOM helpers, selector engine
│   │   ├── chatgpt/             # ChatGPT extractor + importer + selectors
│   │   ├── claude/              # Claude extractor + importer + selectors
│   │   └── gemini/              # Gemini (stub for V1, V2 implementation)
│   ├── sidepanel/               # Migration wizard UI (React)
│   │   ├── App.tsx
│   │   ├── pages/               # Wizard step pages
│   │   ├── components/          # Shared UI components
│   │   └── hooks/               # Migration state, autofill, extraction hooks
│   ├── popup/                   # Quick-access popup (React)
│   ├── core/                    # Platform-agnostic business logic
│   │   ├── schema/              # UIS types + Zod validation
│   │   ├── adapters/            # Platform adapter registry + implementations
│   │   ├── transform/           # Prompt translation, memory mapping, file conversion
│   │   ├── llm/                 # LLM client (local + cloud + BYOK)
│   │   └── storage/             # IndexedDB wrapper, migration state persistence
│   └── shared/                  # Constants, messaging types, utils
├── assets/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                # Sample ChatGPT/Claude export files
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Coding Standards

### TypeScript
- `strict: true` in tsconfig — no exceptions
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
- **Service worker is ephemeral** — it can be terminated at any time. Never store state in service worker memory that isn't persisted to IndexedDB or chrome.storage
- **Message passing is the only communication** between background, content scripts, and side panel. Use the typed message router in `src/shared/messaging.ts`
- **Content scripts run in page context** — they can access DOM but NOT extension APIs directly. Communicate via `chrome.runtime.sendMessage`
- **Side panel persists across navigations** — this is why we chose it over a popup for the wizard

### DOM Interaction (Content Scripts)
- NEVER use a single CSS selector. Always use `SelectorStrategy[]` with priority cascade:
  1. `data-testid` attributes (most stable)
  2. `aria-label` attributes
  3. CSS class selectors
  4. Text content matching (least stable, always works)
- If all selectors fail → trigger Guided Mode fallback, never throw
- All selectors defined in per-platform `selectors.ts` files

### State Management
- Zustand store for migration state machine (defined in `src/core/storage/migration-state.ts`)
- IndexedDB (via Dexie) for: manifest data, extracted content, file blobs, migration checkpoints
- chrome.storage.local for: user preferences, LLM config, cached selector updates
- **API keys are NEVER persisted** — kept in service worker memory only, prompted each session

### Styling
- Tailwind utility classes only
- No inline styles except for dynamic values (e.g., progress bar width)
- Side panel is 400px wide — design for this constraint
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

## V1 Scope — What to Build

**IN scope:**
- ChatGPT → Claude migration (one direction)
- Parse ChatGPT official data export (ZIP → conversations.json)
- DOM extraction of Custom GPTs, memory, custom instructions from chatgpt.com
- Universal Interchange Schema (PortsmithManifest) generation
- Rule-based prompt translation (no LLM for V1)
- Claude Project creation via Autofill and Guided modes
- Memory import via Guided mode
- Side panel migration wizard (6 steps: source → target → extract → review → migrate → complete)
- Migration state persistence and resume (IndexedDB checkpoints)
- Export manifest as JSON backup

**OUT of scope (V2+):**
- Claude → ChatGPT reverse migration
- Gemini support (either direction)
- LLM-powered smart distillation
- Conversation history migration
- Ongoing sync between platforms
- Team/Enterprise features
- Firefox/Safari ports

---

## Key Architectural Decisions (Reference)

1. **Side Panel** for wizard UI — sits alongside target platform page
2. **Client-side processing by default** — zero privacy concerns
3. **Multi-strategy selector cascade** with Guided Mode fallback when DOM breaks
4. **IndexedDB checkpoints** after every workspace migration for crash recovery
5. **Single extension package** for V1 — extract into `@portsmith/schema` npm package in V2
6. **Tiered LLM**: no LLM (default) → local WebLLM → cloud API → BYOK. V1 uses rule-based only.
