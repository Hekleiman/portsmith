// E2E: one full Gemini autofill migration against a stubbed gemini.google.com.
//
// Loads the built extension in Chromium and fakes Gemini with Playwright
// routes (no Google account is touched): the app page's tokens, the Gem
// list/create/update RPCs, the file upload service, ProcessFile, and the
// saved-info list/create RPCs. Checks that automatic mode creates the Gem,
// uploads the knowledge files and the project memory document, saves the
// memories, skips a repeated fact, and never stops to ask.
//
// Usage (Playwright is intentionally not a project dependency):
//   npm run build
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/e2e-gemini-autofill.mjs dist
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";

const EXT = path.resolve(process.argv[2] ?? "dist");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-gem-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const seen = { gemCreates: [], gemUpdates: [], uploads: [], processFiles: [], saves: [], lists: 0, other: [] };
const saved = [];
// Gemini's real create limit, well under the 10,000 its editor allows.
const SAVED_INFO_API_MAX_LENGTH = 1500;
const ALWAYS_REFUSE = /always refuse/i;
const FLAKY = /flaky/i;
const attempts = new Map();
const APP = `<!doctype html><html><head><title>Gemini</title></head><body><main>stub</main>
<script>window.WIZ_global_data={"SNlM0e":"tok-1","cfb2h":"boq_stub","FdrFJe":"sid-1","TuX5cc":"en","qKIAYe":"feeds/stub"};</script>
</body></html>`;

const frame = (json) => `${json.length + 1}\n${json}`;
const reply = (route, envelopes) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: `)]}'\n\n` + envelopes.map((e) => frame(JSON.stringify([e]))).join("\n") + "\n",
  });
const wrb = (rpcid, body, identifier = "generic") => ["wrb.fr", rpcid, JSON.stringify(body), null, null, null, identifier];

await ctx.route("https://content-push.googleapis.com/**", async (route) => {
  const req = route.request();
  seen.uploads.push({
    url: req.url(),
    headers: { "push-id": req.headers()["push-id"], "x-tenant-id": req.headers()["x-tenant-id"] },
    body: (req.postDataBuffer() ?? Buffer.alloc(0)).toString("latin1").slice(0, 400),
  });
  return route.fulfill({ status: 200, contentType: "text/plain", body: `/contrib_service/ttl_1d/ref-${seen.uploads.length}` });
});

await ctx.route("https://gemini.google.com/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname.endsWith("/ProcessFile")) {
    const form = new URLSearchParams(req.postData() ?? "");
    seen.processFiles.push(form.get("f.req"));
    const record = [null, 16, "f", null, null, `$AX-${seen.processFiles.length}`, null, [], 1, [1, 2], null, "text/markdown", null, [true]];
    return reply(route, [wrb(null, [record, null, 1])]);
  }
  if (url.pathname.includes("/batchexecute")) {
    const rpcids = (url.searchParams.get("rpcids") ?? "").split(",");
    const form = new URLSearchParams(req.postData() ?? "");
    const calls = JSON.parse(form.get("f.req") ?? "[[]]")[0];
    const out = [];
    for (const [rpcid, payload, , identifier] of calls) {
      const arg = JSON.parse(payload);
      if (rpcid === "CNgdBe") out.push(wrb(rpcid, [[]], identifier));
      else if (rpcid === "oMH3Zd") { seen.gemCreates.push(arg); out.push(wrb(rpcid, ["gem-1"], identifier)); }
      else if (rpcid === "kHv0Vd") { seen.gemUpdates.push(arg); out.push(wrb(rpcid, ["ok"], identifier)); }
      else if (rpcid === "ZKcapf") { seen.lists++; out.push(wrb(rpcid, [saved.map((s, i) => [`id-${i}`, s, [1, 2], null, [1, 2], null, null, null, null, 2, 1]), null], identifier)); }
      else if (rpcid === "xVRQX") {
        const text = arg[0][1];
        seen.saves.push(text);
        const tries = (attempts.get(text) ?? 0) + 1;
        attempts.set(text, tries);
        // Error code 13 with no body: what a live account returns for text
        // over the limit, and for the transient refusals it recovers from.
        const refuse =
          text.length > SAVED_INFO_API_MAX_LENGTH ||
          ALWAYS_REFUSE.test(text) ||
          (FLAKY.test(text) && tries < 3);
        if (refuse) out.push(["wrb.fr", rpcid, null, null, null, [13], identifier]);
        else { saved.push(text); out.push(wrb(rpcid, [null, null, null, [[[`id-${saved.length}`, text, [1, 2], null, [1, 2], null, null, null, null, 2, 1]]]], identifier)); }
      } else { seen.other.push(rpcid); out.push(wrb(rpcid, [], identifier)); }
    }
    return reply(route, out);
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: APP });
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;

const logs = [];
const gem = await ctx.newPage();
gem.on("console", (m) => logs.push(`[gemini] ${m.text()}`));
await gem.goto("https://gemini.google.com/app");

const panel = await ctx.newPage();
panel.on("console", (m) => logs.push(`[panel] ${m.text()}`));
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await new Promise((r) => setTimeout(r, 1500));

const now = new Date().toISOString();
// ~2000 characters of whole sentences, so it splits on a sentence boundary.
const LONG_MEMORY = "I keep detailed notes about the migration project. ".repeat(40).trim();
const mem = (id, fact) => ({ id, fact, category: "preference", confidence: 1, source: "explicit", workspaceIds: [], migration: { fitsConstraints: true, priority: 5 } });
const manifest = {
  version: "1.0.0",
  exportedAt: now,
  source: { platform: "claude", exportMethod: "api", exportedAt: now },
  user: { expertise: [], communicationStyle: { formality: "casual", verbosity: "concise", preferences: [] }, interests: [] },
  workspaces: [{
    id: "ws-gem",
    sourceId: "src-1",
    name: "E2E Gem",
    description: "Created by the E2E test",
    instructions: { raw: "Be brief.", translated: { gemini: "Be brief in Gemini." } },
    knowledgeFiles: [
      { id: "kf-a", originalName: "notes.md", mimeType: "text/markdown", sizeBytes: 12, source: "exported", contentRef: "file-a", compatible: true },
      { id: "kf-b", originalName: "data.csv", mimeType: "text/csv", sizeBytes: 8, source: "exported", contentRef: "file-b", compatible: true },
      { id: "kf-c", originalName: "gone.pdf", mimeType: "application/pdf", sizeBytes: 5, source: "referenced", compatible: true },
    ],
    category: "other", tags: [], behavior: {}, capabilities: [], conversationCount: 0, lastActiveAt: now, sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
    projectMemory: { source: "claude_memory", capturedAt: now, entries: [{ id: "pm-1", title: "Decisions", content: "We chose Vite." }] },
  }],
  memory: [
    mem("m-1", "I like short answers"),
    mem("m-2", "Always refuse this one please"),
    mem("m-3", "I like short answers."),
    mem("m-4", "I live in Vista"),
    // Over the 1500-character create limit: has to be split to be saved.
    mem("m-5", LONG_MEMORY),
    mem("m-6", "Flaky memory that settles on a retry"),
  ],
  globalInstructions: "Always answer in English.",
  metadata: { generatedBy: "e2e" },
};

const send = (type, payload) =>
  panel.evaluate(([type, payload]) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage({ __portsmith: true, type, payload }, (r) =>
        resolve(r?.ok ? r.data : { error: r?.error ?? chrome.runtime.lastError?.message }))), [type, payload]);

await panel.evaluate(async (manifest) => {
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  for (let i = 0; i < 50; i++) {
    const dbs = await indexedDB.databases();
    if (dbs.some((d) => d.name === "portsmith-db")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const db = await new Promise((res, rej) => { const r = indexedDB.open("portsmith-db"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(["manifests", "files"], "readwrite");
  tx.objectStore("manifests").put({ id: "m-gem", data: manifest, createdAt: manifest.exportedAt, updatedAt: manifest.exportedAt });
  tx.objectStore("files").put({ id: "file-a", blob: b64(new TextEncoder().encode("# Notes")), mimeType: "text/markdown", originalName: "notes.md" });
  tx.objectStore("files").put({ id: "file-b", blob: b64(new TextEncoder().encode("a,b\n1,2")), mimeType: "text/csv", originalName: "data.csv" });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}, manifest);

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const start = await send("MIGRATION_START", { manifestId: "m-gem", mode: "autofill", workspaceIds: ["ws-gem"], targetPlatform: "gemini" });
check(start?.success === true, `MIGRATION_START failed: ${JSON.stringify(start)}`);

let status;
const pendings = [];
for (let i = 0; i < 400; i++) {
  status = await send("MIGRATION_STATUS", undefined);
  if (status?.pendingConfirmStepId) {
    pendings.push(status.currentSteps.find((s) => s.id === status.pendingConfirmStepId)?.title ?? status.pendingConfirmStepId);
    await send("MIGRATION_CONFIRM", { confirmed: false, token: status.pendingConfirmToken });
  }
  if (status?.phase === "memory" || status?.phase === "complete") break;
  await new Promise((r) => setTimeout(r, 250));
}
check(pendings.length === 0, `Automatic mode stopped to ask: ${JSON.stringify(pendings)}`);
const final = status;

check(final?.phase === "memory", `Expected the memory step, got ${final?.phase}`);
check(final?.completedWorkspaceIds?.includes("ws-gem"), "Workspace not completed");
check(seen.gemCreates.length === 1, `Expected 1 Gem, got ${seen.gemCreates.length}`);
check(seen.uploads.length === 3, `Expected 3 uploads, got ${seen.uploads.length}`);
check(
  seen.uploads.every((u) => u.headers["push-id"] === "feeds/stub" && u.headers["x-tenant-id"] === "bard-storage"),
  "Upload headers are wrong",
);
check(seen.processFiles.length === 3, `Expected 3 ProcessFile calls, got ${seen.processFiles.length}`);
check(
  seen.processFiles[0]?.includes("project-memory-from-claude.md") && seen.processFiles[0]?.includes("/contrib_service/ttl_1d/ref-1"),
  `ProcessFile payload: ${seen.processFiles[0]}`,
);
const update = seen.gemUpdates[0];
check(seen.gemUpdates.length === 1, `Expected 1 Gem update, got ${seen.gemUpdates.length}`);
check(update?.[0] === "gem-1" && update?.[1]?.[2] === "Be brief in Gemini.", `Gem update: ${JSON.stringify(update)}`);
check(
  JSON.stringify(update?.[1]?.[14]) === JSON.stringify([[[null, null, null, null, null, "$AX-1"], [null, null, null, null, null, "$AX-2"], [null, null, null, null, null, "$AX-3"]]]),
  `Knowledge field: ${JSON.stringify(update?.[1]?.[14])}`,
);
check(final?.filesDelivered?.["ws-gem"] === 2, `Files delivered: ${JSON.stringify(final?.filesDelivered)}`);
check(final?.projectMemoryWorkspaceIds?.includes("ws-gem"), "Project memory not recorded");
check(seen.lists === 1, `Expected the saved-info list to be read once, got ${seen.lists}`);
const tries = (re) => seen.saves.filter((t) => re.test(t)).length;
const longParts = seen.saves.filter((t) => t.includes("detailed notes about the migration"));
const uniqueLongParts = [...new Set(longParts)];

// The long memory is split, and every piece is inside Gemini's real limit.
check(uniqueLongParts.length === 2, `Expected the long memory to be split in 2, got ${uniqueLongParts.length}`);
check(
  uniqueLongParts.every((p) => p.length <= SAVED_INFO_API_MAX_LENGTH),
  `A split piece is still over the limit: ${uniqueLongParts.map((p) => p.length).join(", ")}`,
);
check(
  uniqueLongParts.join(" ") === LONG_MEMORY,
  "The split pieces do not reconstruct the original memory",
);
check(
  uniqueLongParts.every((p) => saved.includes(p)),
  "Not every piece of the long memory was saved",
);

// A refusal Gemini recovers from is retried; one it never accepts is not retried forever.
check(tries(/flaky/i) === 3, `Expected the flaky memory to be tried 3 times, got ${tries(/flaky/i)}`);
check(saved.some((t) => /flaky/i.test(t)), "The flaky memory never saved");
check(tries(/always refuse/i) === 3, `Expected the refused memory to be tried 3 times, got ${tries(/always refuse/i)}`);
check(!saved.some((t) => /always refuse/i.test(t)), "The always-refused memory should not be saved");

// Text that threw is never retried, and plain memories are sent once.
check(tries(/^I live in Vista$/) === 1, `"I live in Vista" sent ${tries(/^I live in Vista$/)} times`);
check(seen.saves.includes("Always answer in English."), "Custom instructions were not saved");

check(final?.memoryAutoSaved?.saved === 6 && final?.memoryAutoSaved?.total === 7, `memoryAutoSaved: ${JSON.stringify(final?.memoryAutoSaved)}`);
check((final?.memoryAutoSaved?.reasons ?? []).length === 1, `No reason recorded for the refusal: ${JSON.stringify(final?.memoryAutoSaved)}`);
const paste = (final?.memorySteps ?? []).find((st) => st.id === "memory-paste");
check(paste?.copyBlocks?.[0]?.content?.includes("Always refuse this one"), "The refused memory is missing from the paste step");
check(!paste?.copyBlocks?.[0]?.content?.includes("I live in Vista"), "A saved memory should not be in the paste step");
check(!paste?.copyBlocks?.[0]?.content?.includes("detailed notes about the migration"), "The split memory was saved and should not be in the paste step");
check(seen.other.length === 0, `Unexpected RPCs: ${seen.other}`);

console.log(JSON.stringify({
  phase: final?.phase,
  completed: final?.completedWorkspaceIds,
  filesDelivered: final?.filesDelivered,
  projectMemory: final?.projectMemoryWorkspaceIds,
  memoryAutoSaved: final?.memoryAutoSaved,
  followUps: final?.followUps,
  knowledgeLeftovers: final?.knowledgeLeftovers,
  memorySteps: (final?.memorySteps ?? []).map((s) => s.id),
  requests: {
    gemCreates: seen.gemCreates.length,
    gemUpdates: seen.gemUpdates,
    uploads: seen.uploads.map((u) => ({ url: u.url, headers: u.headers, hasFile: /name="file"/.test(u.body) })),
    processFiles: seen.processFiles,
    saves: seen.saves,
    lists: seen.lists,
    other: seen.other,
  },
  savedInGemini: saved,
}, null, 2));
console.log(logs.filter((l) => l.includes("PortSmith")).slice(-25).join("\n"));
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
if (failures.length) { console.error("FAIL:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("PASS (see the dump above for what was sent)");
