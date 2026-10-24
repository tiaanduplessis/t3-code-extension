#!/usr/bin/env node
// Chrome's executeScript sends only a function's source to the page, so the
// injected capture function must stay self-contained after minification.
// This finds it in the built bundle, rebuilds it from its source alone and
// runs it against a minimal DOM stub.
import { readFileSync, readdirSync } from "node:fs";

const src = ["dist/background.js", ...readdirSync("dist/assets").filter((f) => f.endsWith(".js")).map((f) => `dist/assets/${f}`)]
  .map((path) => readFileSync(path, "utf8"))
  .find((code) => code.includes("__t3SlackCollect"));
if (!src) {
  console.error("verify-bundle: capture functions not found in dist.");
  process.exit(1);
}
// Find every top-level `function name(){...}` by brace matching and test the ones that read our globals.
function topLevelFunctions(code) {
  const out = []; let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "`" || ch === '"' || ch === "'") { const q = ch; i++; while (i < code.length && code[i] !== q) { if (code[i] === "\\") i++; i++; } continue; }
    if (depth === 0 && code.startsWith("function ", i)) {
      let j = code.indexOf("{", i), d = 0, k = j;
      for (; k < code.length; k++) { const c = code[k];
        if (c === "`" || c === '"' || c === "'") { const q = c; k++; while (k < code.length && code[k] !== q) { if (code[k] === "\\") k++; k++; } continue; }
        if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
      out.push(code.slice(i, k + 1)); i = k; continue;
    }
    if (ch === "{") depth++; else if (ch === "}") depth--;
  }
  return out;
}
const env = () => {
  globalThis.document = { querySelector: () => null, title: "Title", activeElement: null, documentElement: { lang: "en" } };
  globalThis.location = { href: "https://example.com/" };
  globalThis.getSelection = () => ({ toString: () => "", rangeCount: 0 });
  globalThis.matchMedia = () => ({ matches: false });
  Object.defineProperty(globalThis, "performance", { value: { getEntriesByType: () => [], now: () => 1 }, configurable: true });
  globalThis.screen = { width: 1, height: 1 };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "ua", language: "en" }, configurable: true });
  globalThis.window = globalThis; globalThis.HTMLTextAreaElement = class {}; globalThis.HTMLInputElement = class {}; globalThis.innerWidth = 800; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 2;
};
let checked = 0;
let failed = 0;
for (const fn of topLevelFunctions(src)) {
  const name = fn.includes("__t3SlackCollect") ? "collectPageContext" : null;
  if (!name) continue;
  env();
  checked++;
  try {
    new Function(`return (${fn})`)()();
    console.log(`verify-bundle: ${name} is self-contained`);
  } catch (error) {
    failed++;
    console.error(`verify-bundle: ${name} failed when rebuilt from source: ${error.message}`);
  }
}
if (checked < 1 || failed > 0) {
  console.error(`verify-bundle: expected the self-contained capture function, ${checked - failed} passed.`);
  process.exit(1);
}
