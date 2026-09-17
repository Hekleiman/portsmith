# Gemini saved-info probe

Run against a live, signed-in Google account on 2026-09-17, one save per case,
sequentially, through the same `xVRQX` / `ZKcapf` / `Ok9j9b` calls the
extension makes.

## Finding

**`xVRQX` refuses any entry longer than 1500 characters.** The limit is exact:
1500 characters saves, 1501 does not. A refusal comes back as HTTP 200 with a
`wrb.fr` frame that has no body and error code 13:

```json
["wrb.fr","xVRQX",null,null,null,[13],"generic"]
```

The timing separates this from every other failure. A real save takes about
2 to 5 seconds. An over-length refusal comes back in 120 to 240 ms, so the
server is rejecting the request before it does any work.

This contradicts two assumptions PortSmith was built on:

- The saved-info editor's `maxlength` is 10,000, and `SAVED_INFO_MAX_LENGTH`
  used that number to decide what to attempt. Everything between 1501 and
  10,000 characters was sent and refused, every time.
- "Length is not the cause" was inferred from the saved entries topping out at
  877 characters. That is the wrong direction of evidence: the long ones are
  missing from the account *because* they were refused, so the saved set could
  never show the limit.

**A second, smaller cause: some refusals are transient.** One matrix case was
refused after 10.1 seconds, and the byte-for-byte identical text saved on a
later attempt. Slow refusals are worth retrying; the fast ones never are.

## Evidence

### The limit, by binary search

Each row is one `xVRQX` call. `code` is the error code on the reply frame.

| Characters | Result | Time | Code |
| ---: | --- | ---: | --- |
| 1426 | saved | 3832 ms | |
| 1701 | refused | 142 ms | `[13]` |
| 1564 | refused | 236 ms | `[13]` |
| 1495 | saved | 2191 ms | |
| 1529 | refused | 174 ms | `[13]` |
| 1511 | refused | 158 ms | `[13]` |
| 1503 | refused | 147 ms | `[13]` |
| 1499 | saved | 2089 ms | |
| **1501** | **refused** | 180 ms | `[13]` |
| **1500** | **saved** | 3319 ms | |

### The matrix

Content type makes no difference. Only length does.

| Case | Chars | Result | Time |
| --- | ---: | --- | ---: |
| control (plain sentence) | 46 | saved | 3570 ms |
| ~2,000 characters | 1978 | **refused** `[13]` | 196 ms |
| ~6,000 characters | 5983 | **refused** `[13]` | 161 ms |
| newlines | 95 | saved | 3257 ms |
| markdown bullets | 88 | saved | 4152 ms |
| phone number | 59 | saved | 3759 ms |
| email address | 71 | saved | 4983 ms |
| names another person | 62 | saved | 4699 ms |
| instruction about a third person | 79 | saved | 3830 ms |
| cannabis products | 92 | saved | 3950 ms |
| emoji | 70 | saved | 1994 ms |
| double quotes and backslashes | 75 | **refused** `[13]` | 10122 ms |
| exact duplicate of the control | 46 | saved | 1951 ms |

Nothing was refused for its content. Phone numbers, email addresses, a named
third party, an instruction about that third party, cannabis products, emoji,
markdown and newlines all saved on the first try. An exact duplicate of an
entry saved a minute earlier was accepted as a second entry, so there is no
de-duplication on Gemini's side.

### The quotes and backslashes case was transient, not content

The one short refusal was re-sent as four separate cases afterwards. All four
saved, including the original string character for character:

| Case | Chars | Result | Time |
| --- | ---: | --- | ---: |
| double quotes only | 52 | saved | 3839 ms |
| backslashes only | 51 | saved | 8517 ms |
| single backslash | 39 | saved | 6172 ms |
| quotes + backslashes, the refused string verbatim | 75 | **saved** | 8777 ms |

So the refusal was not about the text. Note the timings: this group ran slower
than the rest (6 to 9 seconds), and the refusal it came from took 10.1 seconds.
Slow replies and transient refusals appear together.

## Gemini rewrites what it saves, and accepts duplicates

Two behaviours that together break any attempt to work out what is already
saved by comparing text.

**It rewrites the wording.** An entry sent as "Goes by Er, also Henry or Erik"
comes back stored as "I go by both Henry and Erik." This is more than the
capitalisation and final-period tidying noted earlier: the sentence is
reworded. `savedInfoKey` normalises case and punctuation, so it cannot match
these. On a live account of ~194 entries the text comparison matched about 18.
A rerun therefore treated ~190 already-saved memories as missing and sent them
again, reporting 43 of 234.

**It does not reject duplicates.** The probe sent an exact duplicate of an
entry saved a minute earlier. It saved, as a second entry, in 1951 ms with a
normal reply. The probe's 18 successful saves produced exactly 18 new entries,
the control and its duplicate among them.

So there is **no distinct "already saved" error code to map**: a repeat send
is not refused, it is stored again. Anything that re-sends a memory already in
the account adds a duplicate rather than being harmlessly ignored.

The consequence is that the only reliable record of what has been saved is the
one PortSmith keeps itself: `src/core/storage/gemini-saved-memory.ts` stores
the memory IDs per manifest and Google account in `chrome.storage.local`.

### The gap that record does not close

That store only helps from the run that wrote it onwards. For an account whose
memories were saved by an earlier build, the store is empty, so the next run
still counts ~190 already-saved memories as missing and re-sends them. Given
the two behaviours above, that either adds ~190 duplicates or gets refused
under the load of sending them.

Backfilling the store is not possible by matching text, for exactly the reason
this section describes. Closing it needs one of: a one-time "treat everything
in this manifest as already saved" action the user confirms, matching on
something other than the stored wording, or accepting the duplicates. **None of
these is implemented, and no live rerun should be started until one is.**

## Recognising what an earlier build already saved

Gemini rewrites the wording of what it saves, so its list cannot be compared
with PortSmith's own text. A similarity measure was tried and abandoned:
measured over 23,871 pairs of 219 real entries, true rewrites and unrelated
memories overlap. The documented rewrite ("Goes by Er, also Henry or Erik" to
"I go by both Henry and Erik.") scores 0.67, while two different references
score 0.78 and two different projects 0.83. No threshold separates them, so
any threshold either loses memories silently or re-sends them as duplicates.

Length settles it without comparing wording at all:

- The only deterministic refusal is text over 1500 characters (1500 saves,
  1501 never does).
- Builds before the ID store sent every memory, so everything that fits was
  accepted and everything longer was refused.
- The account holds 219 entries, the longest 877 characters, which is what
  "everything that fits was accepted" looks like from the outside.

So when the ID store is empty for a manifest and account **and Gemini's list
comes back non-empty**, every memory at or under `SAVED_INFO_API_MAX_LENGTH` is
marked as already saved, and only the longer ones are split and sent. The
result is persisted before anything is sent, so an interrupted run does not
start over.

The non-empty list matters: an empty list means nothing was ever saved to this
account, and marking memories as saved would lose all of them.

**This is a migration, not ordinary behaviour.** It exists for accounts written
to by builds that kept no record. A new user starts with an empty store *and*
an empty list, so the backfill never fires for them, and from the first run
onwards the store is the record.

## What this changes in PortSmith

1. `SAVED_INFO_API_MAX_LENGTH = 1500` is the real create limit, separate from
   `SAVED_INFO_MAX_LENGTH = 10_000`, which stays as what the editor accepts for
   the copy-and-paste step.
2. `splitSavedInfoText` cuts longer memories into pieces Gemini will take,
   preferring line breaks, then sentence ends, then word boundaries, and only
   cutting mid-word when a single word exceeds the limit on its own. A split
   memory counts as saved only when every piece is saved.
3. `saveMemories` retries a refusal twice, after 1 s and 3 s. It only retries
   when Gemini actually answered and refused, because that proves nothing was
   saved. A request that threw is still never retried: it may have been saved
   on the way back, and a second attempt would duplicate it.
4. Text over 1500 characters is not retried. It is refused deterministically,
   so retrying it only wastes requests. The orchestrator splits before sending,
   so this should not normally be reached.
5. Saves run **2 at a time** rather than 6. Six produced transient refusals and
   replies slowing from about 4 s to about 10 s. The call takes around four
   seconds whatever the concurrency, so little is lost.
6. When the ID store is empty for a manifest and account, and Gemini's list is
   non-empty, `saveGeminiMemories` marks everything within the create limit as
   already saved, once, and persists that before sending. Longer memories are
   split and sent, and a split memory counts as saved only when every piece is
   confirmed.

## Not verified

- **That the 1500 limit is characters rather than UTF-8 bytes.** The bisect
  used ASCII, where the two are identical. `splitSavedInfoText` therefore keeps
  each piece within 1500 *both* characters and UTF-8 bytes, which is correct
  either way, at the cost of shorter pieces for non-Latin text.
- **That over-length memories account for all 41 refusals** in the earlier run.
  Confirming that needs the memory list out of the extension's IndexedDB, which
  is only reachable from the extension's own origin. See "Reading the manifest"
  below.
- **Whether concurrency causes the transient refusals.** `saveMemories` sends 6
  at a time. The transient refusal and the slow replies around it are
  consistent with server-side load, but the rate test that would have measured
  this was dropped rather than write a dozen throwaway entries into a real
  account. The retry handles the symptom either way. If transient refusals
  turn out to be common, lowering the concurrency is the next thing to try.
- **Whether Gemini has an upper bound on the number of entries.** The account
  under test held 194 and took 18 more without complaint.
- **Why ~190 re-sent memories were refused on the live rerun**, when the probe
  shows duplicates are normally accepted. The most likely explanation is the
  transient refusal above, triggered by sending ~190 entries 6 at a time, which
  would also explain why 20 of them got through. Not measured: doing so means
  writing into a real account. If it holds, lowering the concurrency is the fix.

## How this was run

`scripts/probe-gemini-saved-info.mjs` holds the probe. On this machine neither
of its browser paths could reach a signed-in account:

- Playwright with a fresh profile: Google refuses to sign in inside a
  CDP-driven browser ("This browser or app may not be secure").
- Playwright against the everyday Chrome profile: macOS protects
  `~/Library/Application Support/Google/Chrome`, so Chrome launched from a
  script cannot even take its `SingletonLock` ("Operation not permitted"),
  whether or not Chrome is running.
- `--remote-debugging-port` on the default profile: ignored since Chrome 136.
  Verified on Chrome 152: the port never opens.

The recorded run was therefore driven through the Claude in Chrome extension
against the already-signed-in browser, executing the same page-side program the
script installs: read `SNlM0e`, `cfb2h` and `FdrFJe` from the app page, then
POST to `/_/BardChatUi/data/batchexecute`. The `at` token, cookies and headers
stayed inside the page and were never printed or written to a file.

The script remains usable wherever a signed-in profile is reachable:

```
node scripts/probe-gemini-saved-info.mjs --profile=<dir> --channel=chrome
```

### Reading the manifest

Reading the user's own memories back out of the extension needs a page on the
extension's origin, because `portsmith-db` lives there. The extension does not
declare `externally_connectable`, and `chrome-extension://` URLs cannot be
opened by the automation available here, so this was not possible. The
extension is installed and its Gemini content scripts are running: a fetch of a
web-accessible resource from `gemini.google.com` returns 200.

## State of the account before the backfill runs

Read on 2026-09-17, read-only, immediately before the length backfill shipped:

- **219** entries in saved info.
- Longest entry **877** characters; **0** entries over 1500.

That zero is the backfill's premise showing through: nothing over the create
limit has ever reached the account, which is what "every memory that fits was
accepted, every longer one refused" looks like from the outside.

The live run has **not** been performed. Driving it needs the extension's side
panel, and reloading the rebuilt extension needs `chrome://extensions`; neither
origin can be opened by the automation available here (`chrome-extension://`
URLs are rewritten to `https://chrome-extension//`, and the extension declares
no `externally_connectable`, so a page cannot message it either). The expected
result when it is run by hand:

- The panel reports all 234 saved.
- Only the over-1500 memories are sent, as split pieces.
- The entry count rises from 219 by exactly the number of pieces sent, with no
  duplicates of anything already there.
- A second run sends nothing.

## Cleanup

Every entry the probe created was deleted again with `Ok9j9b`, and the result
checked with a fresh `ZKcapf` read.

- Baseline before the probe: **194** entries, longest 877 characters.
- Created by the probe: **18**.
- Deleted: **18**, none failed.
- After cleanup: **194** entries, **0** left over from the probe, and **0** of
  the original 194 missing.
