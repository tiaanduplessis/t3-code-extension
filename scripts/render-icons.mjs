#!/usr/bin/env node
// Renders public/icons/icon-*.png from assets/icon.svg with Playwright Chromium.
// Usage: node scripts/render-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const svg = readFileSync("assets/icon.svg", "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
