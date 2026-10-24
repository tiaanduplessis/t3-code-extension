# Send to T3 Code (unofficial)

Send what you're looking at in Chrome to a [T3 Code](https://t3.codes) agent, with a screenshot, page context and console errors.

> **Unofficial and early.** This project is not affiliated with T3 Tools Inc. It relies on T3 Code APIs that may change, and was tested with T3 Code 0.1.2.

<p>
  <img src="docs/images/composer.png" width="380" alt="The composer: a checkout page screenshot with the wrong total outlined in red, context chips for the page, selection, console and failed requests, and a note for the agent.">
  <img src="docs/images/existing-thread.png" width="380" alt="Sending to an existing thread: a searchable list of recent threads with project badges.">
</p>

## Features

- **New or existing threads** in any T3 Code environment you connect.
- **Marked-up screenshots.** Drag to outline what you mean.
- **Browser context:** the page, your selection, browser and OS, viewport and failed requests.
- **Console errors,** including ones logged before you opened the composer.
- **Slack messages.** Right-click a message to send it with its thread replies.
- **T3 Code controls:** model, reasoning effort, access level, plan mode and worktree.

## Quick start

You need Chrome 127 or later and T3 Code running.

1. **Get the extension.** Download the zip from [Releases](https://github.com/tiaanduplessis/t3-code-extension/releases) and unzip it, or build from source with Node 24 and pnpm:
   ```sh
   pnpm install && pnpm build   # output in dist/
   ```
2. **Load it.** Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder or `dist/`.
3. **Get a pairing code.** In T3 Code, create one under **Settings > Connections**, or run `t3 auth pairing create`.
4. **Connect.** In the extension's settings, paste the code, choose an access level and click **Connect**.
5. **Send.** On any page, click the toolbar icon or press <kbd>Alt+Shift+T</kbd>.

## Usage

- **Open the composer** from the toolbar icon, with <kbd>Alt+Shift+T</kbd>, or by right-clicking a page, selection, link or Slack message.
- **Choose the context.** Click a context chip to leave it out. The eye button leaves out the screenshot.
- **Send.** <kbd>Enter</kbd> sends. <kbd>Shift+Enter</kbd> adds a new line.
- **Threads that are working:** choose **Queue** to send after the current turn, or **Steer** to join it. Messages with a screenshot always steer, because T3 Code can't queue attachments.

**Access levels.** You approve a highest level when connecting. New threads can use that level or a lower one, and start at **Supervised**. You can only send to existing threads that run at or below the approved level. If your threads run with **Full access**, connect with **Full access**.

**Console errors.** These are on by default and read through Chrome's debugger. Chrome briefly shows a "started debugging" bar while it reads them. You can turn this off in settings.

## Privacy

Data goes only to the T3 Code servers you connect, and only when you send. There is no telemetry. See [permissions and privacy](docs/permissions.md) for what is sent, every permission and why, and how the extension talks to T3 Code.

## Development

```sh
pnpm dev         # rebuild on change
pnpm typecheck
pnpm test
pnpm build
```

See [development](docs/development.md) for the code layout, the live test scripts, releasing and notes on the T3 Code API.

## License

[MIT](LICENSE). The UI adapts T3 Code's MIT-licensed design; see [third-party notices](THIRD_PARTY_NOTICES.md).
