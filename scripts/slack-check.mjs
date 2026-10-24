#!/usr/bin/env node
// Checks the Slack path through the built extension: the static content
// script on app.slack.com remembers the right-clicked message, and the
// composer's injected capture function reads it. Serves synthetic Slack
// markup (no real content) and does not contact T3 Code or start a thread.
//
// Usage: node scripts/slack-check.mjs
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const outputDir = join(process.cwd(), "e2e-output");
mkdirSync(outputDir, { recursive: true });
const extensionDir = mkdtempSync(join(tmpdir(), "t3-ext-slack-"));
const profileDir = mkdtempSync(join(tmpdir(), "t3-ext-slack-profile-"));
cpSync("dist", extensionDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
// Automation cannot click the toolbar button that grants activeTab.
manifest.host_permissions.push("<all_urls>");
writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

function message(ts, body, sender) {
  const senderMarkup = sender
    ? `<span data-qa="message_sender" data-stringify-text="${sender}"><button data-qa="message_sender_name">${sender}</button></span>`
    : "";
  return `<div role="listitem" data-qa="virtual-list-item"><div class="c-message_kit__message" data-qa="message_container" data-msg-ts="${ts}">
    <div data-qa="message_content">${senderMarkup}
      <a class="c-link c-timestamp" data-ts="${ts}" aria-label="Today at 10:00 AM" href="/archives/C100/p${ts.replace(".", "")}">
        <span data-qa="timestamp_label">10:00 AM</span></a>
      <div data-qa="message-text">${body}</div>
    </div></div></div>`;
}

const slackPage = `<!doctype html><html><head><title>eng (Channel) - Example Team - Slack</title></head><body>
  <div class="p-ia4_home_header_menu__team_name">Example Team</div>
  <div data-qa="channel_name">eng</div>
  <div data-qa="message_pane"><div data-qa="slack_kit_list">
    ${message("1700000000.000100", "Unrelated earlier message", "Alex Example")}
    ${message("1700000060.000200", "Checkout total is wrong when a discount code is applied", "Sam Example")}
  </div></div></body></html>`;

let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  // A connection to an unreachable port: the composer renders, and loading
  // projects fails with a network error rather than marking it invalid.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      connections: {
        env: {
          environmentId: "env",
          origin: "http://127.0.0.1:9",
          label: "Slack check",
          serverVersion: "0",
          accessToken: "unused",
          expiresAt: Date.now() + 86_400_000,
          access: "approval-required",
          connectedAt: Date.now(),
        },
      },
    });
  });

  await context.route("https://app.slack.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: slackPage }),
  );
  const page = await context.newPage();
  await page.goto("https://app.slack.com/client/T100/C100");
  await page.getByText("Checkout total is wrong").click({ button: "right" });
  await page.keyboard.press("Escape");

  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: "https://app.slack.com/*" }))[0].id);
  const popupPromise = context.waitForEvent("page");
  await worker.evaluate(async (id) => {
    await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${id}`), type: "popup", width: 480, height: 760 });
  }, tabId);
  const popup = await popupPromise;
  await popup.setViewportSize({ width: 460, height: 760 });
  await popup.getByText("Slack message from Sam Example").waitFor({ timeout: 15_000 });
  await popup.screenshot({ path: join(outputDir, "slack.png"), fullPage: true });
  console.log("slack-check: the composer shows the right-clicked Slack message");
} finally {
  await context?.close();
  rmSync(extensionDir, { recursive: true, force: true });
  rmSync(profileDir, { recursive: true, force: true });
}
