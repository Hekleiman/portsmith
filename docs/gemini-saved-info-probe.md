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

## Cleanup

Every entry the probe created was deleted again with `Ok9j9b`, and the result
checked with a fresh `ZKcapf` read.

- Baseline before the probe: **194** entries, longest 877 characters.
- Created by the probe: **18**.
- Deleted: **18**, none failed.
- After cleanup: **194** entries, **0** left over from the probe, and **0** of
  the original 194 missing.
