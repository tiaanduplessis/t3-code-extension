# Permissions and privacy

## What the extension sends

Each item can be switched off in the composer before sending.

| Context | When it is available |
| --- | --- |
| Screenshot of the visible tab, with your outlines | Any normal web page |
| Page title, address and description | Any normal web page |
| Browser and OS version, viewport, screen, color scheme, locale, time zone, load timing, referrer | Any normal web page |
| Failed requests (HTTP 400 and above) | Any normal web page. With console reading on, it also includes network errors and cross-origin failures. |
| Console errors and warnings, uncaught exceptions, unhandled rejections, with stack locations | When console reading is on, including messages logged before the composer opened |
| Selected text | When you selected text |
| Slack message with sender, time, permalink and thread replies | On `app.slack.com` |
| The link you right-clicked | When you used the right-click menu on a link |

## Privacy

- **Where data goes.** Captured data goes only to the T3 Code servers you connect, and only when you send. There is no analytics or telemetry, and no other service is contacted.
- **What is stored.** Connection tokens, preferences, drafts and recent activity stay in `chrome.storage` in your browser profile.
- **When pages are read.** Page content, the console and Slack messages are read only when you open the composer or use the right-click menu. The Slack content script only remembers which message you last right-clicked or hovered.
- **Who sees it.** Anything you send reaches the agent and model provider configured in T3 Code.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | Capture the tab you invoke the extension on and read its context |
| `contextMenus` | The Send to T3 Code menu item |
| `storage` | Connections, preferences, drafts and recent activity |
| `notifications` | Report when sending finished after the popup closed |
| `declarativeNetRequestWithHostAccess` | Remove the `Origin` header from the extension's own requests to `/mcp` (see below) |
| `debugger` | Read the tab's console history while **Include console errors** is on |
| Host access to `127.0.0.1` and `localhost` | Reach a local T3 Code server |
| Content script on `app.slack.com` | Remember which Slack message you right-clicked |
| Optional host access, per server | T3 Code servers on other hosts |

## Console reading

The extension reads console history through Chrome's debugger API. When the debugger attaches, Chrome replays the errors, warnings and failed requests the tab has already logged, so nothing needs to be set up beforehand.

- Chrome shows a "started debugging this browser" bar for under a second while it reads. The screenshot is taken before the bar appears.
- Chrome only allows `debugger` as a required permission, so console reading is a setting instead. It is on by default and can be turned off in settings.
- Chrome blocks it on `chrome://` pages and the Chrome Web Store. Some pages refuse a second debugger. In those cases the message is sent without console information.

## Why the extension removes the Origin header

T3 Code's `/mcp` endpoint rejects any request with an `Origin` header, even with a valid token. That keeps web pages from controlling it. Chrome adds `Origin` to every POST an extension makes, so a `declarativeNetRequest` rule removes the header. The rule only applies to requests that meet both of these conditions:

- the extension made them (`initiatorDomains` is the extension's ID).
- they go to `<connected origin>/mcp`.

Requests from web pages keep the header, and T3 Code still rejects them. The end-to-end test checks this with a valid token.
