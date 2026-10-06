# Architecture

How the parts fit together, where the code for each feature lives, and what the app leaves
on a user's machine. Line numbers are for `dev` at `3231a06` and drift; the file names do not.


## 1. The parts

| Part | Where | Technology |
|---|---|---|
| Desktop app, main process | `electron/` (≈ 190 modules in 15 domain folders) | Electron 44, TypeScript, bundled by esbuild into `dist-electron/` |
| Preload in every Google view | `electron/preload.ts` | runs inside mail.google.com with `contextIsolation: false` |
| Preload for the app's own pages | `electron/sidebar-preload.ts` | exposes `window.desktop` (≈ 100 methods) |
| Shell UI | `renderer/` | Next 16, React 19, Tailwind 3, static export served over `app://bundle/` |
| Shared pure code (main and renderer) | `renderer/lib/` | imported by both; Next cannot import from outside its root |
| Tests | `tests/` (153 files, ≈ 2,300 cases) | vitest in plain Node, no Electron, no network |
| Relay server | separate repo `gmail-push-relay` (Bitbucket) | Node + TypeScript in Docker behind Traefik |
| Build and release | `.github/workflows/`, `electron-builder.yml`, `scripts/` | GitHub Actions on Windows and macOS runners |

The app has no runtime npm dependencies: esbuild bundles what main needs (`electron-updater`
included) into `dist-electron/`. Everything else is Electron and Node itself.


## 2. Main-process folders

| Folder | Holds | Start reading at |
|---|---|---|
| `core/` | Shared state (`runtime.ts`), every IPC channel (`ipc.ts`) and handler (`ipc-handlers.ts`), atomic JSON storage (`json-store.ts`), preferences (`prefs-store.ts`), concurrency helpers | `ipc.ts` for the contract between processes |
| `windows/` | Main window, the view manager (one view per mailbox × app), warm-up, low-memory budget, overlays, crash page | `main-window.ts` → `createWindow()`; `profile-view-manager.ts` |
| `accounts/` | Detecting signed-in accounts, the account cache, tombstones, tab colours | `detection-controller.ts` |
| `auth/` | OAuth linking (PKCE, loopback redirect intercepted in-app), token store and sealing, config sources, health and reconnect banner, tokens for delegated mailboxes | `oauth-flow.ts`, `mailbox-token.ts` |
| `delegation/` | Delegated mailboxes: relay calls, URL scraping from the account switcher, health checks, the removal guard | `delegated-controller.ts` |
| `gmail/` | The Gmail API client, quota pacing, retry, batching, history cursor, opening the exact message | `gmail-api.ts`, `quota.ts`, `retry.ts` |
| `mail/` | Mail drop, copy, label copy, batched jobs, duplicate scan, journals, rollback, cleanup. Subfolders: `drag/` (the in-page strip, label drags, the pull lock), `pull/` (fetching mail to disk, the drop folder, cleanup), `copy/` (copying into mailboxes, journals, markers, the "already there" index), `job/` (batched label jobs), `purge/` (emptying a label), `shared/` (MIME reader, JSONL store, chunking) | `mail-drop-controller.ts` (the engine) |
| `push/` | **API polling, not push** (the name is historical): `history.list` sweeps | `mail-sync-controller.ts` |
| `notify/` | Notification policy (per account, quiet hours, sound), log file | `notification-policy.ts`, `notify-log.ts` |
| `toast/` | The app's own notification window and click handling | `toast-presenter.ts`, `toast-activation.ts` |
| `unread/` | Unread count from the title, badge maths, taskbar overlay | `unread-parser.ts` |
| `compose/` | `mailto:` dispatch, account chooser, compose window | `mailto-controller.ts` |
| `menus/` | Context menu, tray, keyboard shortcuts, native menus | `tray-setup.ts`, `shortcuts.ts` |
| `system/` | OS integration: notifications identity, default mail client (registry), links, downloads, `app://` scheme | `system-integration.ts` |
| `updates/` | Auto-update, the beta channel, the "what's new" panel from `CHANGELOG.md` | `update-controller.ts` |
| `feedback/` | Feedback mail, automatic crash reports, log redaction | `crash-controller.ts`, `log-redact.ts` |


## 3. Startup, in order

1. Before Electron is ready (`electron/main.ts`):
   1. Hardware acceleration is read from disk.
   2. Crash reporting is installed and `app://` is registered.
   3. The **single-instance lock** is taken. A second launch only focuses the first one and
      hands over any `mailto:`.
2. `createWindow()` (`windows/main-window.ts`):
   1. Opens `notify.log`.
   2. Builds every store. Tokens are migrated to the sealed format, and tokens outside the
      domain are dropped.
   3. Creates the view manager and the toast window, then loads the shell page.
3. Once the shell has loaded, the app:
   1. Loads delegated mailboxes.
   2. Starts **account detection**: it probes `/mail/u/0`, `/u/1`, and so on.
   3. Starts the OAuth health check, which runs every 5 minutes.
4. After that, it:
   1. Registers as a mail client.
   2. Starts the notification sweeps and the 6-hourly drop-folder cleanup.
   3. Resumes any copy run a crash left behind.
   4. Starts the updater, which checks every 30 minutes.
   5. Sends any queued crash reports.

Quitting goes through `before-quit`, which flushes the message index. Closing the window only
hides it to the tray.


## 4. Features and where they live

| Feature (user's words) | Code |
|---|---|
| Tab per mailbox, tab windows, 20+ tabs | `renderer/app/Topbar.tsx`, `topbar-tabs.ts`; `windows/profile-view-manager.ts` |
| Detect my accounts / add an account | `accounts/detection-controller.ts` (`startDetection`, `addAccount`) |
| Link an account ("Koppelen") / reconnect banner | `auth/oauth-flow.ts` (`connectAccount`), `auth/oauth-health-check.ts`, `renderer/app/reconnect/` |
| Delegated mailboxes in the tab bar | `delegation/delegated-controller.ts`, `windows/switcher-reader.ts` |
| Notifications, own accounts | shim in `preload.ts` (`createNotificationShim`), then `notify/`, then `toast/` |
| Notifications, delegated mailboxes | `push/mail-sync-controller.ts` (15-second sweep) |
| Click a notification → the right mail | `toast/toast-activation.ts`, `notify/notify-match.ts`, `gmail/message-anchor.ts` |
| Unread badge | `unread/` plus `preload.ts` `computeAndReport` |
| Drag mail onto the strip → `.eml` on disk | `mail/drag/dropzone.ts` (in-page), `mail/mail-drop-controller.ts` `handleMailDrop`, `mail/pull/mail-archive.ts` |
| Copy dragged mail into other mailboxes ("Kopieer") | `mail-drop-controller.ts` `copyToMailboxes` → `copyToMailbox` → `copyOneFile`; UI `renderer/app/maildrop/page.tsx` |
| "Staat er al": duplicate warning | `mail-drop-controller.ts` `startExistingScan`, `findDuplicates`; `mail/copy/message-index.ts`; `gmail-api.ts` `labelsHoldingMany` |
| Drag a whole label, with or without its structure | `mail/drag/label-drop.ts`, `mail/copy/label-tree.ts` |
| Big label (> 2,000 conversations) in batches | `mail/job/label-job.ts`, `mail-drop-controller.ts` `planJob` / `advanceJob` / `walkJob`, `mail/job/job-guard.ts` |
| Pause / stop / undo a copy | `mail/copy/copy-control.ts`, `mail/copy/copy-journal.ts`, `mail/copy/copy-marker-sweep.ts`, `resumeOrphanedCopyRuns` |
| Empty a label ("Labels opruimen") | `mail/purge/label-purge.ts`, `mail/purge/label-purge-controller.ts`, settings section in `renderer/app/settings/` |
| Verification code copied automatically | `gmail/verification-code.ts`, `push/mail-sync-controller.ts` |
| `mailto:` / default mail client | `compose/`, `compose/mailto.ts`, `system/mail-client-registration.ts` |
| Google apps (Calendar, Drive, Docs, …) in the app | `renderer/lib/surfaces.ts` (the nine surfaces), `windows/surface-opener.ts` |
| Low-memory mode | `windows/view-budget.ts`, `windows/view-surfaces.ts` |
| Phishing check on external links | `system/link-guard.ts` |
| Updates, beta channel, "what's new" | `updates/` |
| Feedback and crash reports | `feedback/` |
| Onboarding tour, settings, languages | `renderer/app/`, `renderer/app/strings.ts` |


## 5. What the app needs from outside

| Dependency | Used for | Configured in |
|---|---|---|
| `accounts.google.com`, `mail.google.com` and the other Google apps | the views themselves | `renderer/lib/surfaces.ts`, `gmail/google-urls.ts` |
| Google OAuth (`oauth2.googleapis.com`) | linking and refreshing tokens | `auth/google-oauth.ts` (scopes, port 47813 redirect) |
| Gmail API (`gmail.googleapis.com`) | drag, copy, sweeps, cleanup, crash mail | `gmail/gmail-api.ts` |
| Relay, `POST delegatedTokenUrl` | token for one delegated mailbox | `google-oauth.json` key, or env `GMAIL_DELEGATED_TOKEN_URL` |
| Relay, `GET delegatedMailboxesUrl` | which mailboxes this person is a delegate of | `google-oauth.json` key, or env `GMAIL_DELEGATED_MAILBOXES_URL` |
| GitHub releases of `Abovomaxlead/gmail-desktop` | auto-update | baked into each installer by `electron-builder.yml` |

**Gmail scopes** (`electron/auth/google-oauth.ts`): `gmail.readonly`, `gmail.insert`,
`gmail.modify`, `gmail.send`, `userinfo.email`. Changing this list makes every stored token
"incomplete", and every user must link again. The relay's `DELEGATED_SCOPES` and the
Workspace domain-wide delegation entry must carry the same Gmail scopes.

`relayUrl` and `pushTopic` in the config file are left over from the removed push design.
Nothing reads them.


## 6. The relay

A separate repository, `gmail-push-relay` (Bitbucket, team `abovomedia_internet`), with its
own `README.md` and `DEPLOYMENT.md`. It is a single stateless Node process.

| Route | Purpose | Status |
|---|---|---|
| `GET /healthz` | liveness check | used by Docker |
| `POST /delegated/token` | mints a 1-hour token for one delegated mailbox after the checks in 01 §5 | **in use** |
| `GET /delegated/mailboxes` | lists the caller's delegated mailboxes; it sweeps the domain directory as an admin and caches the result for 1 hour | **in use** |
| WebSocket on `/` + Pub/Sub pull | realtime push trigger | **dormant**: no app version since 2026-09-02 connects |

Its configuration (names only) is in `.env.example`. The four keys that matter:

| Key | What it must hold |
|---|---|
| `OAUTH_CLIENT_ID` | must equal the app's `clientId` |
| `ALLOWED_DOMAINS` | `abovomaxlead.nl` |
| `DELEGATION_KEY_FILE` | the path to the domain-wide delegation key |
| `DELEGATED_ADMIN_SUBJECT` | a Workspace admin to impersonate for the directory |

The relay refuses to start when a required key is missing, rather than run half-protected.


## 7. What lives on a user's machine

userData is `%APPDATA%\gmail-desktop\` on Windows and `~/Library/Application Support/gmail-desktop/`
on macOS. The dev build and the installed app **share it**.

| File | Holds | If it is lost or corrupt |
|---|---|---|
| `prefs.json` (+ `.bak`) | every setting | settings return to defaults; one bad field only resets that field |
| `google-tokens.json` | sealed refresh tokens | every account shows "not linked"; drag and copy stop until re-linked. Copied to another PC it cannot be opened and is moved aside as `.unopenable-<ts>` |
| `google-oauth.json` (optional) | hand-placed OAuth config; **wins over the bundled one** | falls back to the bundled config |
| `accounts.json` | last-known accounts, so tabs draw instantly | tabs appear once detection finishes; the tour may show again |
| `hidden.json` | removed accounts and mailboxes | they all come back at next start |
| `delegated.json` | delegated mailboxes and their Gmail URL | rediscovered, but each URL has to be captured again |
| `colors.json`, `downloads.json`, `recent-labels.json`, `gmail-history.json` | cosmetics and cursors | harmless |
| `message-index.json` | hint for "already there" | harmless; Gmail is asked instead |
| `crash-reports.json` | queued crash reports | queued reports lost |
| `notify.log` | the main diagnostic log, **UTC timestamps**, reset at 512 KB | diagnostics only |
| `update.log` | updater log, 256 KB | diagnostics only |
| `Partitions/google/` | Chromium cookies for **every** Google account | everyone is signed out of every account at once; tokens survive |

To really reset a store, delete both `X.json` and `X.json.bak`.

Outside userData:

- **Drop folder.** The default is `%LOCALAPPDATA%\Gmail Desktop\Mail`, or the folder chosen in
  Settings. It holds the saved `.eml` files, plus:
  - `log.jsonl`, the permanent record of what was saved and copied;
  - `<runId>.rollback.jsonl`, one copy journal per run;
  - `<jobId>.job.jsonl`, one plan per batched job.

  Everything except `log.jsonl` is removed after 3 days.
- **Registry (HKCU).** Holds the `mailto` handler registration and the login item.
