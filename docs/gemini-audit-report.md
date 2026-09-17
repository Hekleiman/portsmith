# Gemini Integration Audit Report

**Date:** 2026-03-24
**Scope:** All Gemini-related files in the PortSmith Chrome extension
**Auditor:** Automated code review

---

## Summary

No CRITICAL issues found. The Gemini integration is well-structured and correctly implements the batchexecute protocol. All payloads align with the reference documentation, message handlers are properly registered, and error handling covers the expected failure modes.

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| WARNING  | 2     |
| INFO     | 5     |

---

## Findings

### WARNING-1: Session race on concurrent initSession() calls

**File:** `src/content-scripts/gemini/session.ts:24-50`, `src/content-scripts/gemini/extractor.ts:39-65`

**Issue:** Both `session.ts` and the extractor's inline session code use a simple `cachedSession` variable without any mutex or deduplication. If two messages arrive simultaneously while `cachedSession` is null, both will call `initSession()` concurrently, issuing duplicate fetches to `https://gemini.google.com/app`.

**Impact:** No correctness bug — both calls read the same server-side tokens and will produce identical sessions. The second write simply overwrites the first with an equivalent value. However, it wastes a network request.

**Recommendation:** Add a pending-promise guard:
```typescript
let sessionPromise: Promise<GeminiSession> | null = null;
async function getSession(): Promise<GeminiSession> {
  if (cachedSession) return cachedSession;
  if (!sessionPromise) sessionPromise = initSession().finally(() => { sessionPromise = null; });
  return sessionPromise;
}
```

**Action:** No fix needed for V1 — the race is benign.

---

### WARNING-2: Duplicate initMessageRouter() calls on same page

**File:** `manifest.json:26-42`, `src/content-scripts/gemini/extractor.ts:272`, `src/content-scripts/gemini/importer.ts:277`

**Issue:** Both the extractor and importer content scripts are registered for `gemini.google.com/*` in the manifest. Each calls `initMessageRouter()`, which calls `chrome.runtime.onMessage.addListener()`. This results in **two message listeners** on the same page.

**Impact:** No correctness bug — each listener only handles its own registered message types (extractor: `GEMINI_EXTRACT_GEMS`, `PING`; importer: `GEMINI_CREATE_GEM`, `GEMINI_UPDATE_GEM`, `GEMINI_DELETE_GEM`). The listener that doesn't recognize a message returns `false`, and Chrome dispatches to the one that returns `true`. This is standard Chrome extension behavior.

**Recommendation:** For cleanliness, consider merging extractor and importer into a single content script bundle with a shared `initMessageRouter()` call. This would eliminate the duplicate listener and reduce bundle size.

**Action:** No fix needed — works correctly as-is.

---

### INFO-1: batchexecute payload alignment verified

**Files:** `src/content-scripts/gemini/importer.ts:36-95`, `docs/gemini-api-analysis.md`

**Verification:** Manually counted null positions in all payload builders:

| Operation | Code Array Length | Docs Array Length | Match |
|-----------|-------------------|-------------------|-------|
| Create    | 15 elements       | 15 elements       | ✅    |
| Update    | 16 elements (extra trailing 0) | 16 elements | ✅    |
| Delete    | 1 element         | 1 element         | ✅    |
| List      | `[2,["lang"],0]`  | `[2,["en"],0]`    | ✅    |

All null positions (indices 3-7, 9, 11-13) match the documentation exactly.

---

### INFO-2: decodeResponse() handles edge cases correctly

**File:** `src/content-scripts/gemini/batchexecute.ts:70-145`

Verified handling of:
- **Empty response:** Returns `[]` — the while loop never executes ✅
- **Missing `)]}'` prefix:** Falls through to parse without stripping ✅
- **Malformed JSON frames:** Caught in try/catch, silently skipped ✅
- **Truncated frames:** `if (units < lengthInUtf16) break;` correctly exits ✅
- **Zero-length frames:** `if (!chunk) continue;` skips empty content ✅
- **Surrogate pairs:** `cp > 0xffff ? 2 : 1` correctly counts UTF-16 code units ✅

---

### INFO-3: All message handlers registered and type-aligned

**Extractor handlers** (`extractor.ts:274-280`):
| Handler | MessageMap Key | Request Type | Response Type | Match |
|---------|---------------|--------------|---------------|-------|
| GEMINI_EXTRACT_GEMS | ✅ | void | GemExtractionResult | ✅ |
| PING | ✅ | void | { pong: true } | ✅ |

**Importer handlers** (`importer.ts:279-293`):
| Handler | MessageMap Key | Request Type | Response Type | Match |
|---------|---------------|--------------|---------------|-------|
| GEMINI_CREATE_GEM | ✅ | GemConfig | GemImportResult | ✅ |
| GEMINI_UPDATE_GEM | ✅ | GemConfig & { gemId } | GemImportResult | ✅ |
| GEMINI_DELETE_GEM | ✅ | { gemId } | GemImportResult | ✅ |

---

### INFO-4: manifest.json correctly configured

**File:** `manifest.json`

- `host_permissions` includes `"https://gemini.google.com/*"` ✅
- Two content script entries for `gemini.google.com/*`:
  - `src/content-scripts/gemini/extractor.ts` ✅
  - `src/content-scripts/gemini/importer.ts` ✅
- File paths follow the same CRXJS convention as existing ChatGPT/Claude scripts ✅
- No additional permissions needed (fetch runs in page context with `credentials: "include"`) ✅

---

### INFO-5: GeminiExtract.tsx state handling

**File:** `src/sidepanel/pages/GeminiExtract.tsx:135-138`

The component checks `!result.success && result.gems.length === 0` to determine error state. This means:

| Scenario | success | gems.length | Behavior |
|----------|---------|-------------|----------|
| Normal extraction | true | >0 | Shows gem count ✅ |
| No custom gems | true | 0 | Shows "Found 0 Gems" ✅ |
| Partial success | false | >0 | Shows gems, drops warnings silently |
| Total failure | false | 0 | Shows error ✅ |

The partial-success case (row 3) silently drops extraction warnings. This is acceptable for V1 — the user still gets their gems — but worth noting for future improvement.

---

### INFO-6: Orchestrator handles partial failures correctly

**File:** `src/background/migration-orchestrator.ts:517-613`

`processGeminiAutofillWorkspace()` handles three outcomes per workspace:

1. **API success** → `completedWorkspaceIds.push()`, delivery = "autofilled" ✅
2. **API failure (success=false)** → Shows fallback steps, still counted as completed with delivery = "manual" ✅
3. **Exception (network/tab error)** → `failedWorkspaces.push()` ✅

For a batch of 5 workspaces where 3 succeed and 2 throw:
- `completedWorkspaceIds` = 3 entries
- `failedWorkspaces` = 2 entries
- Status correctly reflects partial completion ✅

---

### INFO-7: Extractor inline session duplication

**Files:** `src/content-scripts/gemini/session.ts`, `src/content-scripts/gemini/extractor.ts:27-81`

The extractor contains a full inline copy of the session management logic (initSession, getSession, refreshSession) rather than importing from `session.ts`. The comment at the top of `session.ts` acknowledges this:

> "NOTE: The extractor has its own inline copy of this logic."

The importer correctly imports from `session.ts`. This duplication is intentional — since the extractor and importer are separate content script bundles, sharing a module import would still result in two independent caches at runtime.

**Recommendation:** Low priority — consider consolidating if the scripts are ever merged into a single bundle.

---

## Conclusion

The Gemini integration is production-ready for V1. The batchexecute protocol implementation correctly mirrors the reference documentation, error handling is comprehensive, and the message passing architecture properly isolates extractor and importer concerns. The two WARNING items are both benign (no correctness impact) and can be addressed in a future cleanup pass.
