# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org); while the version is below 1.0, minor versions may include breaking changes.

## 0.2.0 - 2026-10-24

First tracked version.

### Added

- Composer to start a new thread or send to an existing thread, in any connected T3 Code environment.
- Screenshot of the visible tab with red outlines you can draw, plus page, selection, link and Slack message context.
- Browser details: browser and OS version, viewport, screen, locale, time zone, load timing and failed requests.
- Console history read through Chrome's debugger, including messages logged before the composer opened. On by default; can be turned off in settings.
- Pairing with T3 Code through pairing codes or links, with a per-connection access ceiling.
- Settings page for environments, context options, shortcuts and recent activity.
- Right-click menu, keyboard shortcut (Alt+Shift+T) and notifications when sending finishes after the popup closes.
- Element picker: click an element to send its selector, text, HTML and, on React, Vue and Svelte development builds, its component and source file.
- Source-mapped stack traces when the page publishes source maps.
- Record while you reproduce: console and failed requests with method, status, timing and response excerpts.
- Masking of likely secrets (tokens, API keys, passwords) in captured context before sending.
