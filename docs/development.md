# Development

Requires Node 24 and pnpm 11.

```sh
pnpm install
pnpm dev             # rebuild dist/ on change; reload the extension in chrome://extensions
pnpm typecheck
pnpm test            # unit tests, no T3 Code needed
pnpm build           # production build plus bundle checks
```

CI runs `typecheck`, `test` and `build` on every push and pull request.

## How it works

The extension connects to each T3 Code environment's MCP server as an approved OAuth client. When you send:

1. It captures the tab, reads the page context and, if on, the console history.
2. It uploads the screenshot with `t3_attachment_prepare_upload`.
3. It sends with one of these:
   - `t3_thread_launch` for a new thread.
   - `t3_thread_send` for an existing thread.
   - `t3_thread_send_attachments` for an existing thread when a screenshot is attached.

## Layout

| Path | Contents |
| --- | --- |
| `src/background/` | Service worker: dispatch, console reader, right-click menu, Origin rule |
| `src/popup/` | Composer UI |
| `src/options/` | Settings page |
| `src/lib/` | MCP client, pairing flow, T3 Code tool wrappers, prompt builder |
| `src/capture/` | Function injected with `executeScript`; it must stay self-contained |
| `src/content/` | Slack content script |
| `src/ui/` | Components styled after T3 Code |

## Scripts with a live T3 Code

These need the `t3` CLI at `~/.t3/bin/t3`. Each script mints its own pairing code and revokes its session when it finishes. The browser scripts also need Playwright's Chromium: `pnpm exec playwright install chromium`.

| Script | What it does |
| --- | --- |
| `pnpm check:contract` | Checks discovery, pairing, the token exchange and the tool list. `--launch` also starts a scratch thread. |
| `node scripts/mcp-call.mjs <tool> '<json>'` | Calls MCP tools as the extension would. `T3_ORIGIN` and `T3_BASE_DIR` select a server; `T3_ACCESS=full-access` allows project changes. |
| `node scripts/e2e.mjs --project "<title>"` | Full flow in Chromium: pair, read the console, start a thread, send a follow-up, check that web pages still get 403. Starts real threads, so use a throwaway project. |
| `node scripts/slack-check.mjs` | Checks the Slack path against made-up Slack markup. No T3 Code needed. |
| `node scripts/readme-screenshots.mjs` | Regenerates `docs/images/` from a demo server. Setup is at the top of the script. |
| `node scripts/render-icons.mjs` | Renders `public/icons/` from `assets/icon.svg`. |

To test across environments, start a second server and pass it to the end-to-end test:

```sh
t3 serve --base-dir /tmp/t3-env2 --port 3774 --no-browser
T3_ORIGIN=http://127.0.0.1:3774 T3_BASE_DIR=/tmp/t3-env2 T3_ACCESS=full-access \
  node scripts/mcp-call.mjs t3_project_create '{"title":"env2 test","workspaceRoot":"/tmp/env2-repo"}'
node scripts/e2e.mjs --project "<throwaway>" \
  --second-origin http://127.0.0.1:3774 --second-base-dir /tmp/t3-env2 --second-project "env2 test"
```

## Releasing

1. Set the same version in `package.json` and `public/manifest.json`. The build fails if they differ.
2. Add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Commit, then run `git tag vX.Y.Z && git push origin vX.Y.Z`.

The release workflow runs the checks and attaches `send-to-t3-code-vX.Y.Z.zip` to a GitHub Release. The release notes come from the changelog.

## Notes on the T3 Code API

T3 Code does not document its MCP tools and OAuth endpoints as a stable API. Run `pnpm check:contract` after T3 Code updates.

- **Recent threads.** Outside clients can only list threads per project, so the extension asks each project for its latest threads, six projects at a time.
- **Branches.** `t3_worktree_list` needs a thread, so the extension uses the project's most recent one. For a project with no threads, it asks you to type the base branch.
- **Opening threads.** The desktop app has no link that opens a specific thread. The web app shows a pairing screen in an unpaired browser.
