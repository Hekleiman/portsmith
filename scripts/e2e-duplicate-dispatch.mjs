// E2E smoke test: one message must trigger exactly one create request.
//
// Loads the built extension in Chromium, stubs claude.ai and
// gemini.google.com with Playwright routes (no real accounts are touched),
// sends CLAUDE_CREATE_PROJECT / GEMINI_CREATE_GEM from the service worker,
// and counts the create requests. v0.3.0 sent two of each.
//
// Usage (Playwright is intentionally not a project dependency):
//   npm run build
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/e2e-duplicate-dispatch.mjs dist
// Exits non-zero if any create request was duplicated.
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";

const EXT = path.resolve(process.argv[2] ?? "dist");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-prof-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const counts = { claudeCreate: 0, geminiCreate: 0 };
const PAGE = "<!doctype html><html><head><title>stub</title></head><body><main>stub</main></body></html>";

await ctx.route("https://claude.ai/**", async (route) => {
  const req = route.request();
  const url = req.url();
  if (/\/api\/organizations\/[^/]+\/projects$/.test(url) && req.method() === "POST") {
    counts.claudeCreate++;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ uuid: `uuid-${counts.claudeCreate}` }) });
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
});

await ctx.route("https://gemini.google.com/**", async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.includes("/_/BardChatUi/data/batchexecute")) {
    const rpcids = new URL(url).searchParams.get("rpcids");
    if (rpcids === "oMH3Zd") counts.geminiCreate++;
    const inner = JSON.stringify([`gem-${counts.geminiCreate}`]);
    const env = JSON.stringify([["wrb.fr", rpcids, inner, null, null, null, "generic"]]);
    const body = `)]}'\n\n${env.length + 1}\n${env}\n`;
    return route.fulfill({ status: 200, contentType: "application/json", body });
  }
  // app page containing the tokens the session regex looks for
  return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body><script>window.WIZ_global_data={"SNlM0e":"tok","cfb2h":"bl","FdrFJe":"sid","TuX5cc":"en"};</script>stub</body></html>` });
});

await ctx.addCookies([{ name: "lastActiveOrg", value: "org-test", domain: "claude.ai", path: "/", secure: true, sameSite: "Lax" }]);

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");

const claude = await ctx.newPage();
const logs = [];
claude.on("console", (m) => logs.push(`[claude] ${m.text()}`));
await claude.goto("https://claude.ai/projects");
const gemini = await ctx.newPage();
gemini.on("console", (m) => logs.push(`[gemini] ${m.text()}`));
await gemini.goto("https://gemini.google.com/app");
await new Promise((r) => setTimeout(r, 2500));

const result = await sw.evaluate(async () => {
  const send = (tabId, type, payload) => new Promise((res) => chrome.tabs.sendMessage(tabId, { __portsmith: true, type, payload }, (r) => res(r ?? String(chrome.runtime.lastError?.message))));
  const [c] = await chrome.tabs.query({ url: "https://claude.ai/*" });
  const [g] = await chrome.tabs.query({ url: "https://gemini.google.com/*" });
  const claudeResp = await send(c.id, "CLAUDE_CREATE_PROJECT", { name: "Dup test", description: "d" });
  const geminiResp = await send(g.id, "GEMINI_CREATE_GEM", { name: "Dup gem", description: "d", instructions: "i" });
  return { claudeResp, geminiResp };
});
await new Promise((r) => setTimeout(r, 1500));

console.log(JSON.stringify({ result, counts }, null, 2));
console.log(logs.filter((l) => l.includes("PortSmith")).join("\n"));
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

if (counts.claudeCreate !== 1 || counts.geminiCreate !== 1) {
  console.error("FAIL: expected exactly one create request per message", counts);
  process.exit(1);
}
console.log("PASS: one create request per message");
