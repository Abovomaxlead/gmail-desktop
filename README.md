# Gmail Desktop

A cross-platform desktop wrapper for Gmail. It loads the real Gmail web
interface in isolated per-account sessions and adds a native shell:
account sidebar, desktop notifications, an unread badge, and a system tray
that keeps the app running in the background.

## Requirements

- Node.js >= 22.12 — Electron 44's own npm scripts require it, and
  electron-builder loads ESM through `require()`
- npm >= 10

## Development

```bash
npm install
cd renderer && npm install && cd ..
npm run build      # builds the Next.js sidebar and the Electron bundles
npm start          # launches the app
```

For day-to-day work use `npm run dev` (cross-platform, no bash needed). It
starts the Next.js dev server, keeps esbuild watching the Electron bundles,
and launches Electron against the dev renderer. What happens on a change:

| You edit | What happens | Restart needed |
| --- | --- | --- |
| `renderer/` (sidebar, modal) | Next hot-reloads the page | no |
| `electron/preload.ts` | esbuild rebuilds; main reloads the Gmail views | no |
| `electron/main.ts` | esbuild rebuilds; Electron restarts itself | no (automatic) |

Close a running instance first — the app takes a single-instance lock, so a
second one exits immediately.

`./run-dev.sh` is an older Linux/macOS launcher: it builds the Electron bundles
once (no watching) and additionally starts a notification daemon under WSL.

## Tests

```bash
npm test
```

## Packaging

```bash
npm run dist       # builds installers for the current platform via electron-builder
```

Outputs are written to `dist/`.

## Architecture

- **Electron main** (`electron/`, one folder per domain) owns the windows,
  tray, stores, and one `WebContentsView` per mailbox and Google app. Every
  Google view shares one session partition (`persist:google`), the way one
  browser holds several signed-in accounts.
- **Next.js (static export)** (`renderer/`) renders the app's own pages:
  tab bar, settings, the mail-drop picker, notifications and dialogs.
- A **preload** injected into each Gmail view reports the unread count,
  routes notifications and runs the drag-to-save strip.

`docs/handoff/02-architecture.md` maps every feature to its code.

## Scope

This is a wrapper around Gmail's web UI, not a standalone mail client. It
includes auto-updates (with a beta channel), `mailto:` handling and the
default-mail-app registration, delegated mailboxes, dragging mail out as
`.eml` and copying it into other mailboxes, its own notification window, and
feedback and crash reports. Keyboard shortcuts work inside the app window
only. Not included: system-wide shortcuts, offline storage.
