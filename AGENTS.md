# AGENTS.md

Chrome MV3 extension that sends the current page (screenshot, page and browser context, console history, Slack messages) to new or existing threads in T3 Code through T3 Code's MCP server. See README.md for user-facing behavior.

## Commands

- `pnpm install` - Node 24+, pnpm 11 (see `packageManager`).
- `pnpm typecheck` - TypeScript, no emit.
- `pnpm test` - Vitest unit tests; no T3 Code or browser needed.
- `pnpm build` - builds `dist/`, fails if `package.json` and `public/manifest.json` versions differ, then runs `scripts/verify-bundle.mjs`.
- `pnpm dev` - rebuilds `dist/` on change; reload the extension in `chrome://extensions`.

CI runs `typecheck`, `test` and `build`. Run all three before handing work back.

## Live checks (side effects)

These need a running T3 Code and the `t3` CLI at `~/.t3/bin/t3`. They mint pairing codes and revoke their sessions when they finish.

- `pnpm check:contract` - read-only contract check. `--launch` starts a real scratch thread.
- `node scripts/e2e.mjs --project "<title>"` - starts real agent threads in that project. Only use a throwaway project, never a user's real project.
- `node scripts/slack-check.mjs` - no T3 Code needed.
- `node scripts/mcp-call.mjs <tool> '<json>'` - calls any MCP tool, including destructive ones.
- `node scripts/readme-screenshots.mjs` - regenerates `docs/images/` from a demo server with made-up projects (setup in the script). Never capture screenshots from a real environment.
- `node scripts/render-icons.mjs` - renders `public/icons/` from `assets/icon.svg`.

Never send test messages to existing user threads.

## Layout

- `src/background/` - service worker: dispatch pipeline, debugger console reader, context menu, Origin header rule.
- `src/popup/`, `src/options/` - React UI.
- `src/lib/` - MCP client, pairing (OAuth) flow, T3 Code tool wrappers, prompt builder.
- `src/capture/page-context.ts` - injected with `chrome.scripting.executeScript`. It must stay self-contained: no imports or module-scope references at runtime. `verify-bundle` checks the built output.
- `src/content/slack.ts` - static content script on `app.slack.com`.
- `src/ui/` - components styled after T3 Code's coss-ui components and default theme.

## Constraints

- T3 Code's `/mcp` endpoint rejects requests with an `Origin` header. `src/background/origin-rules.ts` removes it only for the extension's own requests. Do not widen that rule.
- `t3_thread_launch` and `t3_thread_send_attachments` have no retry key. Never retry them blindly. `t3_thread_send` takes `clientRequestId`.
- `debugger` must be a required permission; Chrome rejects it as optional. Console reading is a user setting instead.
- Prompts include third-party page and Slack text. Keep the untrusted-context notice in `src/lib/prompt.ts`.
- Match T3 Code's UI patterns and wording (runtime mode labels, "Current checkout", "New worktree").
