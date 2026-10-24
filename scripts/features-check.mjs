#!/usr/bin/env node
// Proves the capture features end to end in Playwright's Chromium against a
// live T3 Code, reading back the messages T3 Code actually received:
//   - secrets in captured context are masked, the user's note is not
//   - minified stack frames are mapped to original sources via source maps
//   - the element picker selects without triggering the page, and Esc cancels
//   - recording captures failed requests with method, status and response
//
// Starts real threads in the project you name, so use a throwaway project.
// Usage: node scripts/features-check.mjs --project "<exact title>" [--origin http://127.0.0.1:3773]
// Evidence goes to e2e-output/features-<timestamp>/.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const projectTitle = arg("--project");
const origin = arg("--origin") ?? "http://127.0.0.1:3773";
if (!projectTitle) {
  console.error('Pass --project "<title>" naming a throwaway project. The check starts real agent threads there.');
  process.exit(1);
}

const t3 = join(homedir(), ".t3", "bin", "t3");
const runDir = join(process.cwd(), "e2e-output", `features-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(runDir, { recursive: true });
const results = [];
function check(requirement, passed, detail) {
  results.push({ requirement, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${requirement}${detail ? ` - ${detail}` : ""}`);
}

// Planted secrets: none of these may reach T3 Code.
const SECRETS = {
  urlToken: "SECRETURLTOKEN123",
  bearer: "SECRETBEARER1234567890",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlLWZvci10ZXN0aW5n",
};
const NOTE_KEY = "ghp_NOTEKEYabcdefghijklmnopqrstuvwxyz01";

// A minified bundle with an external source map, built from a virtual TypeScript file.
const bundle = await build({
  stdin: {
    contents: `
      export function applyDiscount(total: number, code?: { percent: number }) {
        return total - total * code!.percent;
      }
      function boot() {
        console.error(new Error("Checkout boot failed"));
        console.error("Auth header was Bearer ${SECRETS.bearer}");
        console.warn("session ${SECRETS.jwt}");
        setTimeout(() => applyDiscount(1199), 0);
      }
      boot();
    `,
    sourcefile: "src/checkout/total.ts",
    loader: "ts",
  },
  bundle: false,
  format: "iife",
  minify: true,
  // "linked" adds the sourceMappingURL comment that real builds publish.
  sourcemap: "linked",
  outfile: "app.min.js",
  write: false,
});
const bundleJs = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const bundleMap = bundle.outputFiles.find((file) => file.path.endsWith(".map")).text;

const page = `<!doctype html><html><head><title>Checkout - Acme Store</title></head>
<body style="font-family:system-ui;padding:40px">
<h1>Order summary</h1><p id="total">Total: R 1 199.00</p>
<button id="pay" onclick="window.__payClicked = true">Pay now</button>
<button id="apply" onclick="fetch('/api/apply-discount', { method: 'POST', body: '{}' }).then((r) => { if (!r.ok) console.error('apply failed', r.status); })">Apply discount</button>
<script src="/assets/app.min.js"></script>
</body></html>`;

const server = createServer((request, response) => {
  if (request.url === "/assets/app.min.js") return response.writeHead(200, { "content-type": "text/javascript" }).end(bundleJs);
  if (request.url === "/assets/app.min.js.map") return response.writeHead(200, { "content-type": "application/json" }).end(bundleMap);
  if (request.url === "/api/apply-discount") {
    return response.writeHead(422, { "content-type": "application/json" }).end('{"error":"discount expired"}');
  }
  response.writeHead(200, { "content-type": "text/html" }).end(page);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const pageUrl = `${base}/checkout?access_token=${SECRETS.urlToken}`;

const extensionDir = mkdtempSync(join(tmpdir(), "t3-features-"));
const profileDir = mkdtempSync(join(tmpdir(), "t3-features-profile-"));
cpSync("dist", extensionDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
// Automation cannot click the toolbar button that grants activeTab.
manifest.host_permissions.push("<all_urls>");
writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// Reads a thread through T3 Code's MCP endpoint with the extension's own token.
async function readThreadMessages(token, threadId) {
  let sessionId;
  let id = 0;
  const rpc = async (method, params, notification = false) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params }),
    });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).at(-1).slice(5) : text);
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "features-check", version: "0" } });
  await rpc("notifications/initialized", {}, true);
  const result = await rpc("tools/call", { name: "t3_thread_read", arguments: { threadId, limit: 50, maxCharsPerItem: 50000 } });
  const value = result.result.structuredContent ?? JSON.parse(result.result.content[0].text);
  return value.items.filter((item) => item.type === "user_message").map((item) => item.text);
}

let context;
let token;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    viewport: { width: 1280, height: 800 },
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  // Pair.
  const pairing = JSON.parse(execFileSync(t3, ["auth", "pairing", "create", "--json", "--ttl", "5m", "--label", "features check"], { encoding: "utf8" }));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Server address").fill(origin);
  await options.getByText(/^Found /).waitFor({ timeout: 10_000 });
  await options.getByLabel("Pairing code or link").fill(pairing.credential);
  await options.getByRole("button", { name: "Connect", exact: true }).click();
  await options.getByText("Connected", { exact: true }).waitFor({ timeout: 15_000 });
  token = await worker.evaluate(async () => Object.values((await chrome.storage.local.get("connections")).connections)[0].accessToken);
  await options.close();

  // Chrome's real toolbar popup is not visible to Playwright. Make openPopup
  // fail so the extension falls back to opening the composer in a window,
  // which the check can drive. (The openPopup path itself reopens the real
  // popup; this only changes where the check can observe it.)
  await worker.evaluate(() => {
    chrome.action.openPopup = () => Promise.reject(new Error("check: use the window fallback"));
  });

  const tab = await context.newPage();
  await tab.goto(pageUrl);
  await tab.waitForTimeout(800);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${base}/*`);

  const openComposer = async () => {
    await tab.bringToFront();
    const opened = context.waitForEvent("page", { predicate: (candidate) => candidate.url().includes("popup.html") });
    await worker.evaluate(async (id) => chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${id}`), type: "popup", width: 480, height: 820 }), tabId);
    const popup = await opened;
    await popup.setViewportSize({ width: 460, height: 820 });
    await popup.getByRole("radio", { name: "New thread" }).waitFor();
    return popup;
  };
  const waitForComposer = async () => {
    const popup = await context.waitForEvent("page", { predicate: (candidate) => candidate.url().includes("popup.html"), timeout: 15_000 });
    await popup.setViewportSize({ width: 460, height: 820 }).catch(() => undefined);
    await popup.getByRole("radio", { name: "New thread" }).waitFor();
    return popup;
  };

  // Element picker, cancel path: Esc reopens the composer without an element.
  let popup = await openComposer();
  await popup.getByText(/^Console \(/).waitFor({ timeout: 15_000 });
  let reopened = waitForComposer();
  await popup.getByRole("button", { name: "Pick an element" }).click();
  await tab.bringToFront();
  await tab.waitForTimeout(400);
  const overlayShown = await tab.evaluate(() => [...document.documentElement.children].some((node) => node.shadowRoot !== null || node.tagName.includes("-")) || document.querySelectorAll("body > div").length > 0);
  await tab.keyboard.press("Escape");
  popup = await reopened;
  await popup.waitForTimeout(800);
  check("Picker: Esc cancels and reopens the composer without an element", (await popup.getByRole("button", { name: /^<|#pay/ }).count()) === 0, `overlay detected: ${overlayShown}`);
  await popup.screenshot({ path: join(runDir, "1-after-cancel.png"), fullPage: true });

  // Element picker, pick path: the page's own click handler must not fire.
  reopened = waitForComposer();
  await popup.getByRole("button", { name: "Pick an element" }).click();
  await tab.bringToFront();
  await tab.waitForTimeout(400);
  await tab.hover("#pay");
  await tab.waitForTimeout(200);
  await tab.screenshot({ path: join(runDir, "2-picker-overlay.png") });
  await tab.click("#pay");
  popup = await reopened;
  const payClicked = await tab.evaluate(() => window.__payClicked === true);
  check("Picker: the page's click handler does not fire", !payClicked, `__payClicked=${payClicked}`);
  await popup.getByRole("button", { name: "#pay" }).waitFor({ timeout: 10_000 });
  check("Picker: the composer reopens with the element chip", true, "chip #pay shown");
  await popup.getByText("1 area marked").waitFor({ timeout: 5_000 });
  check("Picker: the element is outlined on the screenshot", true, "1 area marked");

  // Redaction preview in the composer.
  await popup.getByText(/^Masked before sending:/).waitFor({ timeout: 10_000 });
  const maskedText = await popup.getByText(/^Masked before sending:/).innerText();
  check("Redaction: the composer says what will be masked", /JWT/.test(maskedText) && /authorization header/.test(maskedText) && /URL parameter/.test(maskedText), maskedText);

  // Send the first message as a new thread in the throwaway project.
  await popup.getByRole("combobox", { name: "Project" }).click();
  await popup.getByPlaceholder(/Search projects/).fill(projectTitle);
  await popup.getByRole("option", { name: new RegExp(projectTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await popup.getByPlaceholder(/Ask anything/).fill(`Features check. Do not change any files. Reply with OK and stop. My own note keeps ${NOTE_KEY}.`);
  await popup.screenshot({ path: join(runDir, "3-composer.png"), fullPage: true });
  await popup.getByRole("button", { name: "Start thread" }).click();
  await popup.getByText("Thread started").waitFor({ timeout: 60_000 });
  const created = (await worker.evaluate(async () => (await chrome.storage.local.get("history")).history))[0];
  await popup.close();

  const [first] = await readThreadMessages(token, created.threadId);
  writeFileSync(join(runDir, "message-1.md"), first);
  const leaked = Object.entries(SECRETS).filter(([, value]) => first.includes(value)).map(([name]) => name);
  check("Redaction: planted secrets did not reach T3 Code", leaked.length === 0, leaked.length ? `leaked: ${leaked.join(", ")}` : "none of 3 found");
  check(
    "Redaction: masked values are marked",
    first.includes(`access_token=[redacted]`) && first.includes("Bearer [redacted]") && first.includes("[redacted] JWT") && first.includes("Masked before sending:"),
  );
  check("Redaction: the user's own note is not altered", first.includes(NOTE_KEY));
  check("Source maps: stack frames name the original file", /src\/checkout\/total\.ts:\d+:\d+/.test(first), (first.match(/at [^\n]*total\.ts[^\n]*/) ?? ["no mapped frame"])[0]);
  check("Source maps: minified bundle frames were replaced", !/app\.min\.js:\d+:\d+/.test(first));
  check("Picker: the message describes the picked element", first.includes("Selector: `#pay`") && first.includes("Text: Pay now"));

  // Recording: start, reproduce a failing request, stop and attach.
  popup = await openComposer();
  await popup.getByRole("button", { name: "Record while you reproduce" }).click();
  await popup.getByText(/^Recording \d+:\d\d/).waitFor({ timeout: 10_000 });
  const badgeDuring = await worker.evaluate(async (id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check("Recording: the toolbar badge shows REC while recording", badgeDuring === "REC", `badge="${badgeDuring}"`);
  await popup.close();
  await tab.bringToFront();
  await tab.click("#apply");
  await tab.waitForTimeout(1_000);
  popup = await openComposer();
  await popup.getByText(/1 failed/).waitFor({ timeout: 10_000 });
  await popup.screenshot({ path: join(runDir, "4-recording.png") });
  const headers = await popup.locator("header").count();
  check("UI: the composer renders once while recording", headers === 1, `${headers} header(s)`);
  await popup.getByRole("button", { name: "Stop and attach" }).click();
  await popup.getByText(/^Recording attached:/).waitFor({ timeout: 10_000 });
  const badgeAfter = await worker.evaluate(async (id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  // Playwright keeps its own debugger connection to every page, so Chrome's
  // "attached" flag is always true here. Attaching again only succeeds if the
  // extension's recording session has detached.
  const stillAttached = await worker.evaluate(async (id) => {
    try {
      await chrome.debugger.attach({ tabId: id }, "1.3");
      await chrome.debugger.detach({ tabId: id });
      return false;
    } catch {
      return true;
    }
  }, tabId);
  check("Recording: stopping clears the badge and detaches the debugger", badgeAfter === "" && !stillAttached, `badge="${badgeAfter}" attached=${stillAttached}`);

  // Send the recording as a follow-up to the same thread.
  await popup.getByRole("radio", { name: "Existing thread" }).click();
  await worker.evaluate(async () => chrome.storage.session.remove("threads"));
  await popup.getByRole("combobox", { name: "Thread" }).click();
  await popup.getByPlaceholder(/Search threads/).fill(created.title.slice(0, 20));
  await popup.getByRole("option", { name: new RegExp(created.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await popup.getByRole("button", { name: "Leave out the screenshot" }).click();
  await popup.getByPlaceholder(/Add to the conversation/).fill("Recording follow-up. Reply with OK and stop.");
  await popup.getByRole("button", { name: /Send to thread|Steer thread/ }).click();
  await popup.getByText("Sent to the thread").waitFor({ timeout: 60_000 });
  await popup.close();

  let second;
  for (let attempt = 0; attempt < 10 && !second; attempt++) {
    second = (await readThreadMessages(token, created.threadId))[1];
    if (!second) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  writeFileSync(join(runDir, "message-2.md"), second ?? "");
  check("Recording: the follow-up says a recording was attached", Boolean(second?.includes("The user recorded")));
  check(
    "Recording: the failed request has method, status and response",
    Boolean(second?.includes(`POST ${base}/api/apply-discount -> 422`) && second.includes("discount expired")),
    (second?.match(/POST [^\n]*apply-discount[^\n]*\n[^\n]*/) ?? ["not found"])[0],
  );
} catch (error) {
  check("Run completed without errors", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  for (const [index, open] of (context?.pages() ?? []).entries()) {
    await open.screenshot({ path: join(runDir, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
  }
} finally {
  await context?.close();
  server.close();
  if (token) execFileSync(t3, ["auth", "session", "revoke", JSON.parse(Buffer.from(token.split(".")[0], "base64url")).sid]);
  rmSync(extensionDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
  const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  writeFileSync(
    join(runDir, "receipt.json"),
    JSON.stringify({ at: new Date().toISOString(), revision, dirtyWorkingTree: dirty, origin, browser: "Playwright Chromium (headless)", results }, null, 2),
  );
  const failed = results.filter((result) => !result.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Evidence: ${runDir}`);
  process.exitCode = failed > 0 ? 1 : 0;
}
