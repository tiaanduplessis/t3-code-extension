#!/usr/bin/env node
// End-to-end run against live T3 Code servers. Loads the built extension into
// Playwright's Chromium, pairs it with pairing codes from the `t3` CLI, reads
// the console of a local test page, starts a new thread and then sends a
// follow-up to that same thread.
//
// The thread runs in the project you name, so use a throwaway project.
//
// Usage:
//   node scripts/e2e.mjs --project "<exact project title>"
//     [--origin http://127.0.0.1:3773]
//     [--second-origin http://127.0.0.1:3774 --second-base-dir <dir> --second-project "<title>"] [--headed]
//
// With a second environment, the test also pairs it and checks that the
// project picker lists projects from both, grouped by environment.
//
// Test-only change to the copied manifest: <all_urls>, because automation
// cannot click the toolbar button that grants activeTab.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const projectTitle = arg("--project");
const origin = arg("--origin") ?? "http://127.0.0.1:3773";
const second = arg("--second-origin")
  ? { origin: arg("--second-origin"), baseDir: arg("--second-base-dir"), project: arg("--second-project") }
  : null;
if (!projectTitle) {
  console.error('Pass --project "<title>" naming a throwaway project. The test starts a real agent thread there.');
  process.exit(1);
}

const t3 = join(homedir(), ".t3", "bin", "t3");
const outputDir = join(process.cwd(), "e2e-output");
mkdirSync(outputDir, { recursive: true });
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const baseDirArgs = (baseDir) => (baseDir ? ["--base-dir", baseDir] : []);

const extensionDir = mkdtempSync(join(tmpdir(), "t3-ext-"));
const profileDir = mkdtempSync(join(tmpdir(), "t3-ext-profile-"));
cpSync("dist", extensionDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
manifest.host_permissions.push("<all_urls>");
writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const testPage = `<!doctype html><html><head><title>Checkout - Test Store</title>
<meta name="description" content="End-to-end test page"></head>
<body style="font-family:system-ui;padding:40px">
<h1>Order summary</h1><p id="total">Total: R 1 299.00 (should be R 1 199.00)</p>
<button id="pay">Pay now</button>
<script>
console.error(new Error("Cannot read properties of undefined (reading 'discount')"));
console.warn("Deprecated API used");
fetch("/api/cart", { method: "POST" });
setTimeout(() => { throw new Error("Payment widget failed to mount"); }, 10);
</script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === "/api/cart") {
    response.writeHead(500, { "content-type": "application/json" }).end('{"error":"boom"}');
    return;
  }
  response.writeHead(200, { "content-type": "text/html" }).end(testPage);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const step = (label) => console.log(`\n== ${label}`);
const sessions = [];
let context;

async function connect(options, serverOrigin, baseDir) {
  const pairing = JSON.parse(
    execFileSync(
      t3,
      ["auth", "pairing", "create", ...baseDirArgs(baseDir), "--json", "--ttl", "5m", "--label", "Chrome extension e2e", "--scope", "orchestration:read", "--scope", "orchestration:operate"],
      { encoding: "utf8" },
    ),
  );
  await options.getByLabel("Server address").fill(serverOrigin);
  await options.getByText(/^Found /).waitFor({ timeout: 10_000 });
  await options.getByLabel("Pairing code or link").fill(pairing.credential);
  await options.getByRole("button", { name: "Connect", exact: true }).click();
  await options.getByText(serverOrigin, { exact: false }).first().waitFor({ timeout: 15_000 });
}

async function openComposer(worker, tabId) {
  const popupPromise = context.waitForEvent("page");
  await worker.evaluate(async (id) => {
    await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${id}`), type: "popup", width: 480, height: 820 });
  }, tabId);
  const popup = await popupPromise;
  await popup.setViewportSize({ width: 460, height: 820 });
  return popup;
}

try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    viewport: { width: 1280, height: 800 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  step(`extension loaded: ${extensionId}`);

  step("connect with pairing codes");
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await connect(options, origin);
  if (second) {
    await options.getByRole("button", { name: "Add environment" }).click();
    await connect(options, second.origin, second.baseDir);
  }
  await options.screenshot({ path: join(outputDir, "options.png"), fullPage: true });
  const connections = await worker.evaluate(async () => Object.values((await chrome.storage.local.get("connections")).connections));
  for (const connection of connections) {
    sessions.push({
      origin: connection.origin,
      token: connection.accessToken,
      baseDir: connection.origin === second?.origin ? second.baseDir : undefined,
    });
  }
  console.log(`connected ${connections.length} environment(s)`);

  step("load a page that logs errors before the composer opens");
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("total"));
    getSelection().addRange(range);
  });
  await page.bringToFront();
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${pageUrl}*`);

  step("open the composer: console history is read through the debugger");
  let popup = await openComposer(worker, tabId);
  await popup.getByText("Console (3)").waitFor({ timeout: 15_000 });
  await popup.getByText("Failed requests (1)").waitFor();
  await popup.getByText(/^Selection/).waitFor();

  step("new thread: choose the throwaway project");
  await popup.getByRole("combobox", { name: "Project" }).click();
  if (second) {
    await popup.getByRole("option", { name: new RegExp(escape(second.project)) }).first().waitFor({ timeout: 15_000 });
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: join(outputDir, "projects-by-environment.png"), fullPage: true });
  }
  await popup.getByPlaceholder(/Search projects/).fill(projectTitle);
  await popup.getByRole("option", { name: new RegExp(`^.?${escape(projectTitle)}`) }).first().click();

  const shot = popup.getByRole("img", { name: /Screenshot of the visible tab/ });
  const box = await shot.boundingBox();
  await popup.mouse.move(box.x + 20, box.y + 20);
  await popup.mouse.down();
  await popup.mouse.move(box.x + 180, box.y + 70, { steps: 5 });
  await popup.mouse.up();
  await popup.getByText("1 area marked").waitFor();
  await popup.getByPlaceholder(/Ask anything/).fill("End-to-end test of the Chrome extension. Do not change any files. Reply with OK and stop.");
  await popup.screenshot({ path: join(outputDir, "composer.png"), fullPage: true });
  await popup.getByRole("button", { name: "Start thread" }).click();
  await popup.getByText("Thread started").waitFor({ timeout: 60_000 });
  await popup.screenshot({ path: join(outputDir, "result.png"), fullPage: true });
  const created = (await worker.evaluate(async () => (await chrome.storage.local.get("history")).history))[0];
  console.log("thread:", created.threadId, "-", created.title);

  step("existing thread: send a follow-up with a screenshot to the thread just created");
  await popup.close();
  // The thread list is cached per session; drop it so the new thread shows.
  await worker.evaluate(async () => chrome.storage.session.remove("threads"));
  popup = await openComposer(worker, tabId);
  await popup.getByRole("radio", { name: "Existing thread" }).click();
  await popup.getByRole("combobox", { name: "Thread" }).click();
  await popup.getByPlaceholder(/Search threads/).fill(created.title.slice(0, 30));
  await popup.getByRole("option", { name: new RegExp(escape(created.title.slice(0, 30))) }).first().click();
  await popup.getByPlaceholder(/Add to the conversation/).fill("Follow-up from the Chrome extension test. Reply with OK and stop.");
  await popup.screenshot({ path: join(outputDir, "existing-thread.png"), fullPage: true });
  await popup.getByRole("button", { name: /Send to thread|Steer thread/ }).click();
  await popup.getByText("Sent to the thread").waitFor({ timeout: 60_000 });
  const sent = (await worker.evaluate(async () => (await chrome.storage.local.get("history")).history))[0];
  if (sent.kind !== "existing" || sent.threadId !== created.threadId) throw new Error("The follow-up went to the wrong thread.");
  console.log("follow-up sent to", sent.threadId);

  step("check that web pages still cannot call /mcp");
  // Uses the real token, so only the Origin check can reject it.
  const pageStatus = await page.evaluate(
    async ({ mcp, token }) => {
      try {
        const response = await fetch(mcp, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        });
        return response.status;
      } catch {
        return "blocked";
      }
    },
    { mcp: `${origin}/mcp`, token: sessions.find((session) => session.origin === origin).token },
  );
  if (pageStatus !== 403 && pageStatus !== "blocked") throw new Error(`A web page got ${pageStatus} from /mcp; expected 403.`);
  console.log(`web page request to /mcp: ${pageStatus}`);
  console.log(`screenshots in ${outputDir}`);
} catch (error) {
  for (const [index, open] of (context?.pages() ?? []).entries()) {
    await open.screenshot({ path: join(outputDir, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
  }
  console.error(`failed; page screenshots in ${outputDir}`);
  throw error;
} finally {
  await context?.close();
  server.close();
  for (const session of sessions) {
    const claims = JSON.parse(Buffer.from(session.token.split(".")[0], "base64url").toString("utf8"));
    execFileSync(t3, ["auth", "session", "revoke", ...baseDirArgs(session.baseDir), claims.sid]);
    console.log("revoked e2e session", claims.sid);
  }
  rmSync(extensionDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
