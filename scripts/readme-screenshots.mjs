#!/usr/bin/env node
// Regenerates the README screenshots in docs/images/ from a demo T3 Code
// server, so no real projects, threads or machine names appear.
//
// Setup (made-up demo data):
//   t3 serve --base-dir /tmp/t3-demo --port 3775 --no-browser
//   create repos and projects "acme-storefront", "acme-api" and "design-system"
//   with scripts/mcp-call.mjs (T3_ORIGIN, T3_BASE_DIR, T3_ACCESS=full-access),
//   plus one idle thread in each (t3_thread_launch without a message).
// Then: pnpm build && node scripts/readme-screenshots.mjs
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os"; import { join } from "node:path";
import { chromium } from "playwright";
const t3 = join(homedir(), ".t3", "bin", "t3");
const origin = "http://127.0.0.1:3775", baseDir = "/tmp/t3-demo";
const ext = mkdtempSync(join(tmpdir(), "t3-shots-")); cpSync("dist", ext, { recursive: true });
const m = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8")); m.host_permissions.push("<all_urls>"); writeFileSync(join(ext, "manifest.json"), JSON.stringify(m));
const html = `<!doctype html><title>Checkout - Acme Store</title><meta name="description" content="Review your order">
<body style="margin:0;font-family:system-ui;background:#f6f6f7;color:#1f2328">
<header style="background:#111;color:#fff;padding:14px 32px;font-weight:600">Acme Store</header>
<main style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px #0001">
<h1 style="margin:0 0 16px;font-size:22px">Order summary</h1>
<div style="display:flex;justify-content:space-between;padding:8px 0">Wireless headphones<span>R 1 199.00</span></div>
<div style="display:flex;justify-content:space-between;padding:8px 0;color:#16794c">Discount (SPRING10)<span>- R 119.90</span></div>
<hr style="border:0;border-top:1px solid #eee">
<div id="total" style="display:flex;justify-content:space-between;padding:8px 0;font-weight:600">Total<span>R 1 199.00</span></div>
<button style="margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#111;color:#fff;font-size:15px">Pay now</button>
</main><script>
console.error(new TypeError("Cannot read properties of undefined (reading 'discount')"));
fetch("/api/cart/apply-discount", { method: "POST" });
</script>`;
const server = createServer((q, r) => q.url.startsWith("/api") ? r.writeHead(500).end() : r.writeHead(200, { "content-type": "text/html" }).end(html));
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const profile = mkdtempSync(join(tmpdir(), "t3-shots-p-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`], viewport: { width: 1280, height: 800 } });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
let token;
const page = await ctx.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForTimeout(500);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1/*" }))[0].id);
async function popup(scheme = "light") {
  await page.bringToFront();
  const p = ctx.waitForEvent("page");
  await sw.evaluate(async (tid) => chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${tid}`), type: "popup", width: 480, height: 760 }), tabId);
  const pg = await p; await pg.setViewportSize({ width: 460, height: 700 }); await pg.emulateMedia({ colorScheme: scheme }); return pg;
}
const shot = async (pg, name, full = false) => { await pg.waitForTimeout(500); await pg.screenshot({ path: `docs/images/${name}.png`, fullPage: full }); };
try {
  const opts = await ctx.newPage(); await opts.setViewportSize({ width: 1000, height: 820 });
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.getByLabel("Server address").fill(origin);
  await opts.getByText(/^Found /).waitFor({ timeout: 10000 });
  const code = JSON.parse(execFileSync(t3, ["auth", "pairing", "create", "--base-dir", baseDir, "--json", "--ttl", "5m"], { encoding: "utf8" })).credential;
  await opts.getByLabel("Pairing code or link").fill(code);
  await opts.getByRole("button", { name: "Connect", exact: true }).click();
  await opts.getByText("Connected", { exact: true }).waitFor({ timeout: 15000 });
  // Demo-only: a neutral environment name instead of the machine's name.
  token = await sw.evaluate(async () => {
    const { connections } = await chrome.storage.local.get("connections");
    for (const connection of Object.values(connections)) connection.label = "Work laptop";
    await chrome.storage.local.set({ connections });
    return Object.values(connections)[0].accessToken;
  });
  await opts.waitForTimeout(500);
  await opts.screenshot({ path: "docs/images/settings.png", fullPage: true });

  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("total")); getSelection().addRange(r); });
  let pg = await popup();
  await pg.getByText(/^Console/).waitFor({ timeout: 15000 });
  await pg.getByRole("combobox", { name: "Project" }).click();
  await pg.getByRole("option", { name: /acme-storefront/ }).click();
  const box = await pg.getByRole("img", { name: /Screenshot of the visible tab/ }).boundingBox();
  // Outline the total row in the screenshot.
  await pg.mouse.move(box.x + box.width * 0.33, box.y + box.height * 0.31); await pg.mouse.down();
  await pg.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.38, { steps: 6 }); await pg.mouse.up();
  await pg.getByPlaceholder(/Ask anything/).fill("The discount isn't applied to the total. Find out why and fix it.");
  await shot(pg, "composer");
  await pg.getByRole("radio", { name: "Existing thread" }).click(); await pg.waitForTimeout(2500);
  await pg.getByRole("combobox", { name: "Thread" }).click(); await shot(pg, "existing-thread");
  await pg.close();
} finally {
  await ctx.close(); server.close();
  if (token) execFileSync(t3, ["auth", "session", "revoke", "--base-dir", baseDir, JSON.parse(Buffer.from(token.split(".")[0], "base64url")).sid]);
  rmSync(ext, { recursive: true, force: true }); rmSync(profile, { recursive: true, force: true });
}
