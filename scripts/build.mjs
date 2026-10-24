#!/usr/bin/env node
// Builds the extension into dist/. Vite bundles the popup, options page and
// background worker; esbuild bundles content scripts as classic IIFE scripts,
// which Chrome requires for content scripts.
import { build as viteBuild } from "vite";
import { rmSync } from "node:fs";
import { context, build as esbuild } from "esbuild";

const watch = process.argv.includes("--watch");

const contentScripts = {
  entryPoints: { "content/slack": "src/content/slack.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome127",
  alias: { "@": "./src" },
  logLevel: "info",
};

// Clear dist once here: Vite's emptyOutDir would also delete the content
// scripts on every rebuild in watch mode.
rmSync("dist", { recursive: true, force: true });
await viteBuild({ build: { emptyOutDir: false, watch: watch ? {} : null } });

if (watch) {
  const ctx = await context(contentScripts);
  await ctx.watch();
} else {
  await esbuild(contentScripts);
  await import("./verify-bundle.mjs");
}
