// Local diagnostic: why does Gemini refuse some saved-info entries?
//
// Opens a headed Chromium on a dedicated profile under .playwright-profile/
// (gitignored), waits for you to sign in to Google yourself, then sends the
// same batchexecute RPCs the extension sends, one case at a time:
//
//   xVRQX  create   [[null, "<text>"]]
//   ZKcapf list     [100] / [100, "<pageToken>"]
//   Ok9j9b delete   [<id>]
//
// Everything the probe creates is deleted again by id at the end, and the
// deletion is verified with a fresh ZKcapf read. Nothing else is touched.
//
// The session token (`at`), cookies and headers are never printed or written
// to a file: they stay inside the page context.
//
// Usage (Playwright is intentionally not a project dependency):
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/probe-gemini-saved-info.mjs
//
// Google refuses to sign in inside a CDP-driven browser ("This browser or app
// may not be secure"), so the profile has to be signed in beforehand, by hand,
// in a normal Chrome. Do that once:
//
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --user-data-dir="<repo>/.playwright-profile/gemini-saved-info" \
//     --use-mock-keychain --no-first-run --no-default-browser-check
//
// Sign in, then quit that window and run this script with --channel=chrome.
// --use-mock-keychain has to be used for the sign-in too: Playwright always
// passes it, and macOS cookie encryption has to match or the profile comes
// back signed out.
//
// Your everyday Chrome profile under ~/Library/Application Support/Google
// cannot be used: macOS protects that directory, so Chrome launched from here
// cannot even take its SingletonLock ("Operation not permitted").
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import readline from "readline";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs", "gemini-saved-info-probe.md");

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PROFILE = path.resolve(flag("profile", path.join(ROOT, ".playwright-profile", "gemini-saved-info")));
const CHANNEL = flag("channel", "chromium");

fs.mkdirSync(PROFILE, { recursive: true });

// ─── Probe matrix ───────────────────────────────────────────

const CONTROL = "I prefer short concise answers with no filler.";

const filler = (n, seed) => {
  const words = `${seed} is a recurring topic in my notes and I keep returning to it when I plan my week`.split(" ");
  let out = "";
  for (let i = 0; out.length < n; i++) out += `${words[i % words.length]} `;
  return out.slice(0, n).trim();
};

const CASES = [
  { name: "control (plain sentence)", text: CONTROL },
  { name: "~2,000 characters", text: `I keep long running notes. ${filler(1950, "Vitepress")}.` },
  { name: "~6,000 characters", text: `I keep very long running notes. ${filler(5950, "Dexie")}.` },
  { name: "newlines", text: "I work on three things:\nPortSmith in the morning\nClient work after lunch\nReading in the evening" },
  { name: "markdown bullets", text: "My weekly rhythm:\n- Monday: planning\n- Wednesday: deep work\n- Friday: review and cleanup" },
  { name: "phone number", text: "My office line is 555-0142 and I answer it between 9 and 5." },
  { name: "email address", text: "My work address is erik.example@example.com and I check it twice a day." },
  { name: "names another person", text: "My colleague Marta reviews every release note before it ships." },
  { name: "instruction about a third person", text: "When you draft notes for my colleague Marta, don't quote dollar figures to him." },
  { name: "cannabis products", text: "I write product copy for a cannabis dispensary and I track terpene profiles for each strain." },
  { name: "emoji", text: "I mark finished tasks with a ✅ and blocked ones with a 🚧 in my notes." },
  { name: "double quotes and backslashes", text: String.raw`I call the pattern "escape hatch" and write paths like C:\Users\erik\notes.` },
  { name: "exact duplicate of the control", text: CONTROL },
];

const RATE_CASES = Array.from({ length: 12 }, (_, i) =>
  `Rate probe ${i + 1}: I track the ${["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett", "kilo", "lima"][i]} project in my weekly review.`);

// ─── Page-side plumbing (mirrors the extension) ─────────────

/**
 * Installed once in the page. Holds the session (token included) inside the
 * page context so it never crosses back into Node.
 */
const INSTALL = () => {
  const ORIGIN = "https://gemini.google.com";
  const prefix = /^\/u\/\d+(?=\/|$)/.exec(location.pathname)?.[0] ?? "";

  const parseFrames = (content) => {
    const frames = [];
    let pos = 0;
    while (pos < content.length) {
      while (pos < content.length && /\s/.test(content.charAt(pos))) pos++;
      if (pos >= content.length) break;
      const match = /^(\d+)\n/.exec(content.slice(pos));
      if (!match) break;
      const want = parseInt(match[1], 10);
      const start = pos + match[1].length;
      let chars = 0;
      let units = 0;
      while (units < want && start + chars < content.length) {
        const cp = content.codePointAt(start + chars);
        const size = cp > 0xffff ? 2 : 1;
        if (units + size > want) break;
        units += size;
        chars++;
      }
      if (units < want) break;
      const chunk = content.slice(start, start + chars).trim();
      pos = start + chars;
      if (!chunk) continue;
      try {
        const parsed = JSON.parse(chunk);
        if (Array.isArray(parsed)) frames.push(...parsed);
        else frames.push(parsed);
      } catch {
        /* skip malformed frames */
      }
    }
    return frames;
  };

  let reqId = Math.floor(Math.random() * 90000) + 10000;

  window.__psProbe = {
    prefix,
    session: null,

    async init() {
      const res = await fetch(`${ORIGIN}${prefix}/app`, { credentials: "include" });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} loading the app page` };
      const html = await res.text();
      const accessToken = html.match(/"SNlM0e":\s*"(.*?)"/)?.[1];
      if (!accessToken) return { ok: false, error: "no SNlM0e on the app page (signed out?)" };
      this.session = {
        accessToken,
        buildLabel: html.match(/"cfb2h":\s*"(.*?)"/)?.[1],
        sessionId: html.match(/"FdrFJe":\s*"(.*?)"/)?.[1],
        language: html.match(/"TuX5cc":\s*"(.*?)"/)?.[1] ?? "en",
      };
      // Deliberately does not return the token.
      return {
        ok: true,
        prefix,
        buildLabel: this.session.buildLabel ?? null,
        hasSessionId: Boolean(this.session.sessionId),
      };
    },

    async rpc(rpcid, payload, identifier = "generic") {
      const s = this.session;
      if (!s) return { ok: false, error: "session not initialised" };
      const params = new URLSearchParams({
        rpcids: rpcid,
        hl: s.language,
        _reqid: String((reqId += 100000)),
        rt: "c",
        "source-path": `${prefix}/app`,
      });
      if (s.buildLabel) params.set("bl", s.buildLabel);
      if (s.sessionId) params.set("f.sid", s.sessionId);

      const body = new URLSearchParams({
        at: s.accessToken,
        "f.req": JSON.stringify([[[rpcid, payload, null, identifier]]]),
      });

      const started = Date.now();
      let res;
      try {
        res = await fetch(`${ORIGIN}${prefix}/_/BardChatUi/data/batchexecute?${params}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            "X-Same-Domain": "1",
            "x-goog-ext-525001261-jspb": "[1,null,null,null,null,null,null,null,[4]]",
            "x-goog-ext-73010989-jspb": "[0]",
          },
          body: body.toString(),
          credentials: "include",
        });
      } catch (err) {
        return { ok: false, error: String(err), ms: Date.now() - started };
      }
      const text = await res.text();
      const stripped = text.startsWith(")]}'") ? text.slice(4).trimStart() : text;
      return {
        ok: res.ok,
        status: res.status,
        ms: Date.now() - started,
        frames: parseFrames(stripped),
      };
    },
  };
  return true;
};

// ─── Node-side helpers ──────────────────────────────────────

const wrb = (frames, rpcid) =>
  (frames ?? []).find((f) => Array.isArray(f) && f[0] === "wrb.fr" && (rpcid ? f[1] === rpcid : true)) ?? null;

const bodyOf = (frame) => {
  const raw = Array.isArray(frame) ? frame[2] : null;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** The `[N]` error code Gemini puts at index 5 of a wrb.fr frame with no body. */
const errorCodeOf = (frame) => (Array.isArray(frame) && Array.isArray(frame[5]) ? frame[5] : null);

/** The entry in an xVRQX reply: body[3] → [[[id, text, …]]]. */
const createdEntry = (body) => {
  const row = Array.isArray(body) && Array.isArray(body[3]) && Array.isArray(body[3][0])
    ? body[3][0][0]
    : null;
  return Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string"
    ? { id: row[0], text: row[1] }
    : null;
};

/** One line describing what came back, short enough for a table cell. */
const describe = (reply) => {
  if (!reply || reply.ok === false) return `request failed: ${reply?.error ?? "unknown"}`;
  const frame = wrb(reply.frames, "xVRQX");
  if (!frame) return `no xVRQX frame (HTTP ${reply.status}); frames: ${JSON.stringify(reply.frames).slice(0, 200)}`;
  const body = bodyOf(frame);
  if (body === null) {
    const code = errorCodeOf(frame);
    return `body null, error code ${code ? JSON.stringify(code) : "none"}`;
  }
  const entry = createdEntry(body);
  if (entry) return `saved as ${JSON.stringify(entry.text)}`;
  return `body without an entry: ${JSON.stringify(body).slice(0, 200)}`;
};

const saved = (reply) => {
  const frame = wrb(reply?.frames, "xVRQX");
  return Boolean(frame && createdEntry(bodyOf(frame)));
};

const words = (s) =>
  new Set(s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((w) => w.length > 3));

/** Does this entry look like something the probe sent? */
const looksLikeProbeText = (text, sentTexts) => {
  const a = words(text);
  if (a.size === 0) return false;
  return sentTexts.some((sent) => {
    const b = words(sent);
    if (b.size === 0) return false;
    let hit = 0;
    for (const w of b) if (a.has(w)) hit++;
    return hit / b.size >= 0.5;
  });
};

const waitForEnter = (message) =>
  new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\n`, () => {
      rl.close();
      resolve(true);
    });
  });

// ─── Run ────────────────────────────────────────────────────

console.log(`Profile: ${PROFILE}\nChannel: ${CHANNEL}\n`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: CHANNEL,
  viewport: null,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://gemini.google.com/saved-info", { waitUntil: "domcontentloaded" });

const install = async () => {
  await page.evaluate(INSTALL);
  return page.evaluate(() => window.__psProbe.init());
};

let session = await install();
if (!session.ok) {
  console.log(`\nNot signed in yet (${session.error}).`);
  console.log("Sign in to Google in this window, then press Enter");
  const answered = await waitForEnter("Sign in to Google in this window, then press Enter");
  if (!answered) {
    // No TTY to read from: wait for the page to become signed in instead.
    process.stdout.write("No TTY for stdin: waiting up to 10 minutes for sign-in");
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      process.stdout.write(".");
      try {
        session = await install();
      } catch {
        continue;
      }
      if (session.ok) break;
    }
    process.stdout.write("\n");
  } else {
    session = await install();
  }
}

if (!session.ok) {
  console.error(`Still not signed in: ${session.error}. Nothing was sent.`);
  await ctx.close();
  process.exit(1);
}

console.log(`Signed in. account prefix: ${session.prefix || "(default)"} build: ${session.buildLabel ?? "unknown"}\n`);

const rpc = (rpcid, payload) =>
  page.evaluate(([id, p]) => window.__psProbe.rpc(id, p), [rpcid, payload]);

const listAll = async () => {
  const entries = [];
  let token;
  for (let page_ = 0; page_ < 100; page_++) {
    const reply = await rpc("ZKcapf", JSON.stringify(token ? [100, token] : [100]));
    const body = bodyOf(wrb(reply.frames, "ZKcapf"));
    if (!Array.isArray(body)) throw new Error(`unexpected ZKcapf reply: ${JSON.stringify(reply).slice(0, 300)}`);
    const rows = Array.isArray(body[0]) ? body[0] : [];
    for (const row of rows) {
      if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") {
        entries.push({ id: row[0], text: row[1] });
      }
    }
    if (typeof body[1] !== "string" || !body[1]) return entries;
    token = body[1];
  }
  throw new Error("too many pages");
};

const before = await listAll();
console.log(`Baseline: ${before.length} entries already saved. None of these will be touched.\n`);
const baselineIds = new Set(before.map((e) => e.id));

// ─── 1. Matrix, one save per case, sequentially ─────────────

const results = [];
for (const c of CASES) {
  const reply = await rpc("xVRQX", JSON.stringify([[null, c.text]]));
  const row = {
    name: c.name,
    chars: c.text.length,
    sent: c.text,
    saved: saved(reply),
    ms: reply.ms,
    status: reply.status ?? null,
    reply: describe(reply),
    frames: reply.frames ?? [],
  };
  results.push(row);
  console.log(`${row.saved ? "saved   " : "REFUSED "} ${String(row.chars).padStart(5)}c ${row.ms}ms  ${c.name}`);
  if (!row.saved) console.log(`          reply: ${row.reply}`);
}

// ─── 2. Rate test: 12 saves, 6 in flight ────────────────────

console.log("\nRate test: 12 unique saves, 6 in flight.");
const rate = RATE_CASES.map((text) => ({ text, saved: false, ms: 0, reply: "", frames: [] }));
let nextRate = 0;
const rateStarted = Date.now();
const rateWorker = async () => {
  while (nextRate < rate.length) {
    const i = nextRate++;
    const at = Date.now() - rateStarted;
    const reply = await rpc("xVRQX", JSON.stringify([[null, rate[i].text]]));
    rate[i] = {
      text: rate[i].text,
      saved: saved(reply),
      ms: reply.ms,
      startedAt: at,
      reply: describe(reply),
      frames: reply.frames ?? [],
    };
    console.log(`${rate[i].saved ? "saved   " : "REFUSED "} +${String(at).padStart(6)}ms took ${String(rate[i].ms).padStart(5)}ms  ${rate[i].text.slice(0, 40)}`);
    if (!rate[i].saved) console.log(`          reply: ${rate[i].reply}`);
  }
};
await Promise.all(Array.from({ length: 6 }, rateWorker));
const rateElapsed = Date.now() - rateStarted;

// ─── 3. Clean up everything the probe created ───────────────

console.log("\nCleaning up.");
const sentTexts = [...CASES.map((c) => c.text), ...RATE_CASES];
const after = await listAll();
const fresh = after.filter((e) => !baselineIds.has(e.id));
const mine = fresh.filter((e) => looksLikeProbeText(e.text, sentTexts));
const notMine = fresh.filter((e) => !looksLikeProbeText(e.text, sentTexts));

if (notMine.length > 0) {
  console.log(`Leaving ${notMine.length} new entries alone (they don't match anything the probe sent):`);
  for (const e of notMine) console.log(`  ${e.id} ${JSON.stringify(e.text.slice(0, 60))}`);
}

const deleteFailures = [];
for (const e of mine) {
  const reply = await rpc("Ok9j9b", JSON.stringify([e.id]));
  const frame = wrb(reply.frames, "Ok9j9b");
  if (!reply.ok || !frame) deleteFailures.push({ id: e.id, reply: JSON.stringify(reply).slice(0, 200) });
}
console.log(`Deleted ${mine.length - deleteFailures.length} of ${mine.length} probe entries.`);

const final = await listAll();
const leftover = final.filter((e) => mine.some((m) => m.id === e.id));
const finalNew = final.filter((e) => !baselineIds.has(e.id));
const clean = leftover.length === 0 && deleteFailures.length === 0;
console.log(
  clean
    ? `Verified with ZKcapf: no probe entry remains (${final.length} entries, baseline was ${before.length}).`
    : `NOT CLEAN: ${leftover.length} probe entries still present. Ids: ${leftover.map((e) => e.id).join(", ")}`,
);

// ─── 4. Report ──────────────────────────────────────────────

const refused = results.filter((r) => !r.saved);
const rateRefused = rate.filter((r) => !r.saved);

console.log("\n─── Matrix ───");
console.log(["case", "chars", "result", "reply"].join(" | "));
for (const r of results) {
  console.log([r.name, r.chars, r.saved ? "saved" : "refused", r.reply].join(" | "));
}

const md = [
  "# Gemini saved-info probe",
  "",
  `Run on ${new Date().toISOString()} against a signed-in Google account, one save per case, sequentially.`,
  "Every entry the probe created was deleted again by id and the deletion verified with a `ZKcapf` read.",
  "",
  "## Finding",
  "",
  refused.length === 0 && rateRefused.length === 0
    ? "Every case saved. The refusals seen in the live run are not reproduced by this matrix."
    : [
        `${refused.length} of ${results.length} matrix cases and ${rateRefused.length} of ${rate.length} rate-test saves were refused.`,
        "",
        "Refused matrix cases:",
        ...refused.map((r) => `- **${r.name}** (${r.chars} chars): ${r.reply}`),
        ...(rateRefused.length > 0
          ? ["", "Refused rate-test saves:", ...rateRefused.map((r) => `- ${JSON.stringify(r.text.slice(0, 60))}: ${r.reply}`)]
          : []),
      ].join("\n"),
  "",
  "## Matrix",
  "",
  "| Case | Chars | Result | Reply |",
  "| --- | ---: | --- | --- |",
  ...results.map((r) =>
    `| ${r.name} | ${r.chars} | ${r.saved ? "saved" : "**refused**"} | ${r.reply.replace(/\|/g, "\\|")} |`),
  "",
  "### Full replies",
  "",
  ...results.flatMap((r) => [
    `#### ${r.name}`,
    "",
    "```json",
    JSON.stringify(r.frames, null, 2),
    "```",
    "",
  ]),
  "## Rate test",
  "",
  `12 unique short saves, 6 in flight at a time, ${rateElapsed} ms wall clock.`,
  "",
  "| Started (ms) | Took (ms) | Result | Reply |",
  "| ---: | ---: | --- | --- |",
  ...rate.map((r) =>
    `| ${r.startedAt ?? 0} | ${r.ms} | ${r.saved ? "saved" : "**refused**"} | ${r.reply.replace(/\|/g, "\\|")} |`),
  "",
  "## Cleanup",
  "",
  `- Baseline before the probe: ${before.length} entries.`,
  `- New entries the probe created: ${fresh.length}, of which ${mine.length} matched what it sent.`,
  `- Deleted: ${mine.length - deleteFailures.length}.`,
  `- Entries left alone because they did not match anything the probe sent: ${notMine.length}.`,
  `- Final \`ZKcapf\` read: ${final.length} entries, ${finalNew.length} of them not in the baseline.`,
  `- ${clean ? "No probe entry remains." : `NOT CLEAN: ${leftover.map((e) => e.id).join(", ")}`}`,
  "",
].join("\n");

fs.writeFileSync(OUT, md);
console.log(`\nWrote ${path.relative(ROOT, OUT)}`);

await ctx.close();
if (!clean) process.exit(1);
