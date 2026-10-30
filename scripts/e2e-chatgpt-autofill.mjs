// E2E: one full ChatGPT autofill migration against a stubbed chatgpt.com.
//
// Loads the built extension in Chromium and fakes ChatGPT with Playwright
// routes (no OpenAI account is touched): the session endpoint, the project
// sidebar listing, project create, and the four file steps (reserve, the
// upload host, process_upload_stream, attach). Checks that automatic mode
// creates the project with a name and instructions fitted to ChatGPT's
// limits, sends the full instructions, the project memory document and the
// copied files through all four steps, never sends the bearer token to the
// upload host, and never stops to ask; then that a second run with the
// same name skips it.
//
// Usage (Playwright is intentionally not a project dependency):
//   npm run build
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/e2e-chatgpt-autofill.mjs dist
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";

const EXT = path.resolve(process.argv[2] ?? "dist");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-cgpt-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const UPLOAD_HOST = "https://files.oaiusercontent.com";
const seen = { creates: [], reserves: [], puts: [], processes: [], attaches: [], sidebars: 0, other: [] };
/** Projects in the stub account: { id, name, instructions, files } */
const projects = [];
let fileSeq = 0;
const APP = `<!doctype html><html><head><title>ChatGPT</title></head><body><main>stub</main></body></html>`;

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const cors = {
  "access-control-allow-origin": "https://chatgpt.com",
  "access-control-allow-methods": "PUT, OPTIONS",
  "access-control-allow-headers": "content-type, x-ms-blob-type, x-ms-version, x-ms-blob-content-type",
};

await ctx.route(`${UPLOAD_HOST}/**`, async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const headers = req.headers();
  seen.puts.push({
    url: req.url(),
    authorization: headers.authorization ?? null,
    blobType: headers["x-ms-blob-type"],
    bytes: (req.postDataBuffer() ?? Buffer.alloc(0)).length,
  });
  return route.fulfill({ status: 201, headers: cors, body: "" });
});

await ctx.route("https://chatgpt.com/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const p = url.pathname;

  if (p === "/api/auth/session") return json(route, { accessToken: "stub" });
  if (p.startsWith("/backend-api/")) {
    if (req.headers().authorization !== "Bearer stub") return json(route, { detail: "no token" }, 401);
  }
  if (p.startsWith("/backend-api/gizmos/snorlax/sidebar")) {
    seen.sidebars++;
    return json(route, {
      items: projects.map((pr) => ({ gizmo: { id: pr.id, display: { name: pr.name } } })),
      cursor: null,
    });
  }
  if (p === "/backend-api/projects" && method === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    seen.creates.push(body);
    const id = `g-p-${String(projects.length + 1).padStart(32, "0")}`;
    projects.push({ id, name: body.name, instructions: body.instructions, files: [] });
    return json(route, { resource: { gizmo: { id, instructions: body.instructions }, files: [] } });
  }
  if (p === "/backend-api/files" && method === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    seen.reserves.push(body);
    const fileId = `file_${++fileSeq}`;
    return json(route, {
      status: "success",
      file_id: fileId,
      upload_url: `${UPLOAD_HOST}/${fileId}?se=stub&sig=stub`,
    });
  }
  if (p === "/backend-api/files/process_upload_stream" && method === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    seen.processes.push(body);
    const events = [
      { event: "file.processing.started", message: "Started" },
      { event: "file.processing.file_ready", message: `Ready ${body.file_name}` },
      { event: "file.processing.completed", message: `Succeeded ${body.file_name}` },
    ];
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
  }
  const attach = /^\/backend-api\/projects\/(g-p-[0-9a-f]{32})\/files$/.exec(p);
  if (attach && method === "POST") {
    const body = JSON.parse(req.postData() ?? "{}");
    seen.attaches.push({ gizmoId: attach[1], files: body.files });
    const project = projects.find((pr) => pr.id === attach[1]);
    if (!project) return json(route, { detail: "not found" }, 404);
    project.files.push(...body.files);
    return json(route, { resource: { gizmo: { id: project.id }, files: project.files } });
  }
  if (p.startsWith("/backend-api/") || p.startsWith("/api/")) {
    seen.other.push(`${method} ${p}`);
    return json(route, {}, 404);
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: APP });
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;

const logs = [];
const chat = await ctx.newPage();
chat.on("console", (m) => logs.push(`[chatgpt] ${m.text()}`));
await chat.goto("https://chatgpt.com/");

const panel = await ctx.newPage();
panel.on("console", (m) => logs.push(`[panel] ${m.text()}`));
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await new Promise((r) => setTimeout(r, 1500));

const now = new Date().toISOString();
const LONG_NAME = "Quarterly planning workspace for the platform migration team";
const FITTED_NAME = "Quarterly planning workspace for the platform…";
const PARAGRAPH = "Keep answers short and cite the planning doc. ".repeat(30).trim();
const LONG_INSTRUCTIONS = Array.from({ length: 8 }, (_, i) => `Section ${i + 1}. ${PARAGRAPH}`).join("\n\n");
const OVERFLOW_FILE = "full-instructions-from-claude.md";
const manifest = {
  version: "1.0.0",
  exportedAt: now,
  source: { platform: "claude", exportMethod: "api", exportedAt: now },
  user: { expertise: [], communicationStyle: { formality: "casual", verbosity: "concise", preferences: [] }, interests: [] },
  workspaces: [{
    id: "ws-cgpt",
    sourceId: "src-1",
    name: LONG_NAME,
    description: "",
    instructions: { raw: "Be brief.", translated: { chatgpt: LONG_INSTRUCTIONS } },
    knowledgeFiles: [
      { id: "kf-a", originalName: "notes.md", mimeType: "text/markdown", sizeBytes: 7, source: "exported", contentRef: "file-a", compatible: true },
      { id: "kf-b", originalName: "data.csv", mimeType: "text/csv", sizeBytes: 7, source: "exported", contentRef: "file-b", compatible: true },
    ],
    category: "other", tags: [], behavior: {}, capabilities: [], conversationCount: 0, lastActiveAt: now, sampleTopics: [],
    migration: { confidence: 1, warnings: [], manualStepsRequired: [] },
    projectMemory: { source: "claude_memory", capturedAt: now, entries: [{ id: "pm-1", title: "Decisions", content: "We chose Vite." }] },
  }],
  memory: [],
  globalInstructions: "",
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
  tx.objectStore("manifests").put({ id: "m-cgpt", data: manifest, createdAt: manifest.exportedAt, updatedAt: manifest.exportedAt });
  tx.objectStore("files").put({ id: "file-a", blob: b64(new TextEncoder().encode("# Notes")), mimeType: "text/markdown", originalName: "notes.md" });
  tx.objectStore("files").put({ id: "file-b", blob: b64(new TextEncoder().encode("a,b\n1,2")), mimeType: "text/csv", originalName: "data.csv" });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}, manifest);

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/** Runs one automatic migration and returns its final status and any questions it asked. */
async function runOnce() {
  const start = await send("MIGRATION_START", { manifestId: "m-cgpt", mode: "autofill", workspaceIds: ["ws-cgpt"], targetPlatform: "chatgpt" });
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
  return { status, pendings };
}

// ── Run 1: creates the project and fills its Sources ──
const first = await runOnce();
const final = first.status;
check(first.pendings.length === 0, `Automatic mode stopped to ask: ${JSON.stringify(first.pendings)}`);
check(final?.mode === "autofill", `Expected autofill mode, got ${final?.mode}`);
check(final?.phase === "complete", `Expected the run to complete, got ${final?.phase}`);
check(final?.completedWorkspaceIds?.includes("ws-cgpt"), "Workspace not completed");
check(seen.creates.length === 1, `Expected 1 project, got ${seen.creates.length}`);
const create = seen.creates[0];
check(create?.name === FITTED_NAME, `Project name: ${JSON.stringify(create?.name)}`);
check([...(create?.name ?? "")].length <= 50, "Project name is over 50 characters");
check([...(create?.instructions ?? "")].length <= 8000, `Instructions are ${[...(create?.instructions ?? "")].length} characters`);
check(create?.instructions?.startsWith("Section 1."), "Instructions don't start with the source text");
check(create?.instructions?.includes(OVERFLOW_FILE), "Instructions don't point at the full-instructions file");

const expectedFiles = [OVERFLOW_FILE, "project-memory-from-claude.md", "notes.md", "data.csv"];
const gizmoId = projects[0]?.id;
check(JSON.stringify(seen.reserves.map((r) => r.file_name)) === JSON.stringify(expectedFiles), `Reserved: ${JSON.stringify(seen.reserves.map((r) => r.file_name))}`);
check(seen.reserves.every((r) => r.use_case === "gizmo" && r.gizmo_id === gizmoId), "Reserve calls lack use_case gizmo or the project ID");
check(seen.puts.length === 4, `Expected 4 uploads to the upload host, got ${seen.puts.length}`);
check(seen.puts.every((p) => p.authorization === null), "The bearer token was sent to the upload host");
check(seen.puts.every((p) => p.blobType === "BlockBlob" && p.bytes > 0), `Upload requests: ${JSON.stringify(seen.puts)}`);
check(JSON.stringify(seen.processes.map((p) => p.file_name)) === JSON.stringify(expectedFiles), `Processed: ${JSON.stringify(seen.processes.map((p) => p.file_name))}`);
check(seen.attaches.length === 4 && seen.attaches.every((a) => a.gizmoId === gizmoId), `Attach calls: ${JSON.stringify(seen.attaches)}`);
check(JSON.stringify(projects[0]?.files.map((f) => f.name)) === JSON.stringify(expectedFiles), `Project Sources: ${JSON.stringify(projects[0]?.files.map((f) => f.name))}`);
check(final?.filesDelivered?.["ws-cgpt"] === 2, `Files delivered: ${JSON.stringify(final?.filesDelivered)}`);
check(final?.projectMemoryWorkspaceIds?.includes("ws-cgpt"), "Project memory not recorded");
check(Object.keys(final?.knowledgeLeftovers ?? {}).length === 0, `Leftovers: ${JSON.stringify(final?.knowledgeLeftovers)}`);
check(final?.instructionsDelivery?.["ws-cgpt"] === "autofilled", `Instructions delivery: ${final?.instructionsDelivery?.["ws-cgpt"]}`);
const notes = final?.followUps?.["ws-cgpt"] ?? [];
check(notes.some((n) => n.includes(`was created as "${FITTED_NAME}"`)), `No trimmed-name note: ${JSON.stringify(notes)}`);
check(notes.some((n) => n.includes(`The full text is in the project file ${OVERFLOW_FILE}`)), `No overflow note: ${JSON.stringify(notes)}`);
check(seen.other.length === 0, `Unexpected requests: ${seen.other}`);

// ── Run 2: the same name is now taken, so it is skipped ──
const createsBefore = seen.creates.length;
const reservesBefore = seen.reserves.length;
const second = await runOnce();
check(second.pendings.length === 0, `Second run stopped to ask: ${JSON.stringify(second.pendings)}`);
check(seen.creates.length === createsBefore, `Second run created another project (${seen.creates.length})`);
check(seen.reserves.length === reservesBefore, "Second run uploaded files");
check(
  second.status?.manualWorkspaces?.some((m) => m.id === "ws-cgpt" && m.reason.includes("already in ChatGPT")),
  `Second run manual list: ${JSON.stringify(second.status?.manualWorkspaces)}`,
);

console.log(JSON.stringify({
  phase: final?.phase,
  completed: final?.completedWorkspaceIds,
  filesDelivered: final?.filesDelivered,
  projectMemory: final?.projectMemoryWorkspaceIds,
  followUps: final?.followUps,
  knowledgeLeftovers: final?.knowledgeLeftovers,
  secondRun: { phase: second.status?.phase, manual: second.status?.manualWorkspaces },
  requests: {
    creates: seen.creates.map((c) => ({ name: c.name, instructionsLength: [...c.instructions].length })),
    reserves: seen.reserves.map((r) => r.file_name),
    puts: seen.puts.map((p) => ({ url: p.url.split("?")[0], authorization: p.authorization, bytes: p.bytes })),
    processes: seen.processes.map((p) => p.file_name),
    attaches: seen.attaches.map((a) => a.files.map((f) => f.name)),
    sidebars: seen.sidebars,
    other: seen.other,
  },
}, null, 2));
console.log(logs.filter((l) => l.includes("PortSmith")).slice(-25).join("\n"));
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
if (failures.length) { console.error("FAIL:\n- " + failures.join("\n- ")); process.exit(1); }
console.log("PASS (see the dump above for what was sent)");
