// E2E: one full Claude autofill migration against a stubbed claude.ai.
//
// Loads the built extension in Chromium, fakes Claude's API with Playwright
// routes (no real account is touched), seeds a manifest into the
// extension's IndexedDB and runs MIGRATION_START like the side panel does.
// Checks every request the extension sends: one project, the instructions,
// the knowledge doc, the project memory doc, the binary upload, and the
// manual step for files Claude can't take.
//
// Usage (Playwright is intentionally not a project dependency):
//   npm run build
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/e2e-claude-autofill.mjs dist
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";

const EXT = path.resolve(process.argv[2] ?? "dist");
const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-e2e-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const seen = { created: 0, lists: 0, puts: [], docs: [], uploads: [], other: [] };
const projects = [];
const PAGE = "<!doctype html><html><head><title>Claude</title></head><body><main>stub</main></body></html>";
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

await ctx.route("https://claude.ai/**", async (route) => {
  const req = route.request();
  const { pathname } = new URL(req.url());
  const method = req.method();
  const base = `/api/organizations/${ORG}/projects`;
  if (pathname === base && method === "POST") {
    seen.created++;
    const name = req.postDataJSON().name;
    projects.push({ uuid: PROJECT, name, created_at: new Date().toISOString() });
    return json(route, { uuid: PROJECT, name }, 201);
  }
  if (pathname === base && method === "GET") {
    seen.lists++;
    const offset = Number(new URL(req.url()).searchParams.get("offset") ?? 0);
    return json(route, offset === 0 ? projects : []);
  }
  if (pathname === `${base}/${PROJECT}` && method === "PUT") {
    seen.puts.push(req.postDataJSON());
    return json(route, { uuid: PROJECT });
  }
  if (pathname === `${base}/${PROJECT}/docs` && method === "POST") {
    seen.docs.push(req.postDataJSON());
    return json(route, { uuid: `doc-${seen.docs.length}` }, 201);
  }
  if (pathname === `${base}/${PROJECT}/upload` && method === "POST") {
    const body = req.postDataBuffer() ?? Buffer.alloc(0);
    seen.uploads.push({ contentType: req.headers()["content-type"] ?? "", body: body.toString("latin1") });
    return json(route, { file_uuid: `file-${seen.uploads.length}` }, 201);
  }
  if (pathname === `${base}/${PROJECT}` && method === "GET") {
    const last = seen.puts[seen.puts.length - 1] ?? {};
    return json(route, {
      uuid: PROJECT,
      name: "E2E project",
      prompt_template: last.prompt_template ?? "",
      docs_count: seen.docs.length,
      files_count: seen.uploads.length,
    });
  }
  if (pathname.startsWith("/api/")) {
    seen.other.push(`${method} ${pathname}`);
    return json(route, { error: "not stubbed" }, 404);
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
});

await ctx.addCookies([{ name: "lastActiveOrg", value: ORG, domain: "claude.ai", path: "/", secure: true, sameSite: "Lax" }]);

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;

const claude = await ctx.newPage();
const logs = [];
claude.on("console", (m) => logs.push(`[claude] ${m.text()}`));
await claude.goto("https://claude.ai/projects");

const panel = await ctx.newPage();
panel.on("console", (m) => logs.push(`[panel] ${m.text()}`));
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await new Promise((r) => setTimeout(r, 1500));

const now = new Date().toISOString();
const manifest = {
  version: "1.0.0",
  exportedAt: now,
  source: { platform: "chatgpt", exportMethod: "dom_extraction", exportedAt: now },
  user: { expertise: [], communicationStyle: { formality: "casual", verbosity: "concise", preferences: [] }, interests: [] },
  workspaces: [
    {
      id: "ws-e2e",
      sourceId: "g-p-0123456789abcdef0123456789abcdef",
      name: "E2E project",
      description: "Created by the E2E test",
      instructions: { raw: "Be BRIEF.", translated: { claude: "Be brief. Always cite sources." } },
      knowledgeFiles: [
        { id: "kf-a", originalName: "notes.md", mimeType: "text/markdown", sizeBytes: 20, source: "exported", contentRef: "file-a", compatible: true },
        { id: "kf-b", originalName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 12, source: "exported", contentRef: "file-b", compatible: true },
        { id: "kf-c", originalName: "photo.png", mimeType: "image/png", sizeBytes: 4, source: "exported", contentRef: "file-c", compatible: false, conversionNeeded: "Images can't be project files" },
        { id: "kf-d", originalName: "missing.docx", mimeType: "application/octet-stream", sizeBytes: 0, source: "referenced", compatible: false },
      ],
      category: "other",
      tags: [],
      behavior: {},
      capabilities: [],
      conversationCount: 0,
      lastActiveAt: now,
      sampleTopics: [],
      migration: { confidence: 0.9, warnings: [], manualStepsRequired: [] },
      projectMemory: {
        source: "manual",
        capturedAt: now,
        entries: [{ id: "pm-1", title: "Decisions", content: "We chose Postgres." }],
      },
    },
  ],
  memory: [
    { id: "m-1", fact: "Lives in Lisbon", category: "identity", confidence: 1, source: "explicit", workspaceIds: [], migration: { fitsConstraints: true, priority: 9 } },
  ],
  globalInstructions: "",
  metadata: { generatedBy: "e2e" },
};

const send = (type, payload) =>
  panel.evaluate(
    ([type, payload]) =>
      new Promise((resolve) =>
        chrome.runtime.sendMessage({ __portsmith: true, type, payload }, (r) =>
          resolve(r?.ok ? r.data : { error: r?.error ?? chrome.runtime.lastError?.message }),
        ),
      ),
    [type, payload],
  );

// Seed IndexedDB once the app has created the database
await panel.evaluate(async (manifest) => {
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  for (let i = 0; i < 50; i++) {
    const dbs = await indexedDB.databases();
    if (dbs.some((d) => d.name === "portsmith-db")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("portsmith-db");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(["manifests", "files"], "readwrite");
  tx.objectStore("manifests").put({ id: "m-e2e", data: manifest, createdAt: manifest.exportedAt, updatedAt: manifest.exportedAt });
  tx.objectStore("files").put({ id: "file-a", blob: b64(new TextEncoder().encode("# Notes\nCafé")), mimeType: "text/markdown", originalName: "notes.md" });
  tx.objectStore("files").put({ id: "file-b", blob: b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x0a]), mimeType: "application/pdf", originalName: "spec.pdf" });
  tx.objectStore("files").put({ id: "file-c", blob: b64([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png", originalName: "photo.png" });
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}, manifest);

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const start = await send("MIGRATION_START", { manifestId: "m-e2e", mode: "autofill", workspaceIds: ["ws-e2e"], targetPlatform: "claude" });
check(start?.success === true, `MIGRATION_START failed: ${JSON.stringify(start)}`);

let status;
const asked = [];
for (let i = 0; i < 120; i++) {
  status = await send("MIGRATION_STATUS", undefined);
  if (status?.pendingConfirmStepId) {
    asked.push(
      status.currentSteps.find((s) => s.id === status.pendingConfirmStepId)?.title ??
        status.pendingConfirmStepId,
    );
    await send("MIGRATION_CONFIRM", { confirmed: false, token: status.pendingConfirmToken });
  }
  if (status?.phase === "memory" || status?.phase === "complete") break;
  await new Promise((r) => setTimeout(r, 250));
}
// Automatic mode never stops mid-run: leftovers wait for the results page.
check(asked.length === 0, `Automatic mode stopped to ask: ${JSON.stringify(asked)}`);
const filesStep = (status?.leftoverSteps?.["ws-e2e"] ?? []).find((c) => c.id === "ws-e2e-files");

check(status?.phase === "memory", `Expected the memory step, got ${status?.phase}`);
check((status?.memorySteps ?? []).length > 0, "No memory steps");
const done = await send("MIGRATION_MEMORY_DONE", { allDone: true });
check(done?.success === true, "MIGRATION_MEMORY_DONE failed");
const final = await send("MIGRATION_STATUS", undefined);

check(seen.created === 1, `Expected 1 project, got ${seen.created}`);
check(seen.lists >= 1, "The existing projects were not checked before creating");
check(seen.puts.length === 1 && seen.puts[0].prompt_template === "Be brief. Always cite sources.", `Instructions: ${JSON.stringify(seen.puts)}`);
const docNames = seen.docs.map((d) => d.file_name).sort();
check(JSON.stringify(docNames) === JSON.stringify(["notes.md", "project-memory-from-chatgpt.md"]), `Docs: ${docNames}`);
check(seen.docs.find((d) => d.file_name === "notes.md")?.content === "# Notes\nCafé", "notes.md content changed");
check(seen.docs.find((d) => d.file_name.startsWith("project-memory"))?.content.includes("We chose Postgres."), "Project memory doc is missing its content");
check(seen.uploads.length === 1, `Expected 1 upload, got ${seen.uploads.length}`);
check(/^multipart\/form-data; boundary=/.test(seen.uploads[0]?.contentType ?? ""), `Upload content type: ${seen.uploads[0]?.contentType}`);
check(seen.uploads[0]?.body.includes('filename="spec.pdf"'), "Upload is missing the file name");
check(seen.other.length === 0, `Unexpected API calls: ${seen.other}`);
check(!!filesStep, "No leftover card for the files Claude can't take");
check(filesStep?.downloads?.some((d) => d.fileName === "photo.png"), "photo.png should be offered as a download");
check(filesStep?.fileNames?.includes("missing.docx"), "missing.docx should be listed");
check(!JSON.stringify(filesStep ?? {}).includes("notes.md"), "Uploaded files must not be listed as manual");
check(final?.phase === "complete", `Final phase: ${final?.phase}`);
check(final?.completedWorkspaceIds?.includes("ws-e2e"), "Workspace not completed");
check(final?.verifiedWorkspaceIds?.includes("ws-e2e"), "Workspace not verified");
check(final?.instructionsDelivery?.["ws-e2e"] === "autofilled", `Delivery: ${final?.instructionsDelivery?.["ws-e2e"]}`);
check(final?.filesDelivered?.["ws-e2e"] === 2, `Files delivered: ${JSON.stringify(final?.filesDelivered)}`);
check(final?.projectMemoryWorkspaceIds?.includes("ws-e2e"), "Project memory not recorded");
check(final?.memoryImported === true, "Memory import not recorded");
check(
  JSON.stringify(final?.followUps?.["ws-e2e"] ?? []) ===
    JSON.stringify(["Remaining files left for later"]),
  `Follow-ups: ${JSON.stringify(final?.followUps)}`,
);
check(claude.url().endsWith(`/project/${PROJECT}`), `Claude tab is on ${claude.url()}`);

// Run the same migration again: PortSmith must ask before creating a
// second project with the same name, and skipping must create nothing.
const again = await send("MIGRATION_START", { manifestId: "m-e2e", mode: "autofill", workspaceIds: ["ws-e2e"], targetPlatform: "claude" });
check(again?.success === true, `Second MIGRATION_START failed: ${JSON.stringify(again)}`);
let question = null;
let second;
for (let i = 0; i < 120; i++) {
  second = await send("MIGRATION_STATUS", undefined);
  if (second?.pendingConfirmStepId && !question) {
    question = second.currentSteps.find((st) => st.id === second.pendingConfirmStepId)?.title ?? "";
    await send("MIGRATION_CONFIRM", { confirmed: false, token: second.pendingConfirmToken });
  }
  if (second?.phase === "memory" || second?.phase === "complete") break;
  await new Promise((r) => setTimeout(r, 250));
}
check(question === null, `The second automatic run stopped to ask: ${question}`);
check(seen.created === 1, `The second run created a project (${seen.created} total)`);
check(second?.manualWorkspaces?.[0]?.reason?.includes("already in Claude"), `Second run result: ${JSON.stringify(second?.manualWorkspaces)}`);
await send("MIGRATION_CANCEL", undefined);

console.log(JSON.stringify({ created: seen.created, puts: seen.puts, docs: docNames, uploads: seen.uploads.length, final: { phase: final?.phase, completed: final?.completedWorkspaceIds, verified: final?.verifiedWorkspaceIds }, secondRun: { question, manual: second?.manualWorkspaces } }, null, 2));
if (failures.length > 0) {
  console.log(logs.filter((l) => l.includes("PortSmith")).join("\n"));
}
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("FAIL:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("PASS: full Claude autofill run sent exactly the expected requests");
