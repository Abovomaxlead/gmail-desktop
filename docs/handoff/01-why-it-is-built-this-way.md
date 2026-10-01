# Why it is built this way

Each decision below is load-bearing: it looks like something you could simplify, and
simplifying it brings back a bug that has already happened once. Every entry names the
decision, the reason, and where it lives. If you want to change one of them, the reason is
what you have to answer first.


## 1. The product decisions

**A wrapper around Gmail's own web interface, not a mail client.** Gmail stays the UI, so
the app is always as current as Gmail itself, every Gmail feature works on day one, and the
team maintains a shell instead of a mail client. The price is that the app depends on
Gmail's page: its title, a handful of DOM shapes, its notification calls. Every such
dependency is listed in the risk register. Original brief: `docs/rebuild-prompt.md`.

**Electron.** It ships its own Chromium, so Google's sign-in treats it as a browser.
Embedded web views in other toolkits are sometimes refused by Google's login page.

**Speed is the only thing that may change in the mail drop.** The drag-and-copy flow is in
daily use across the company. Which mail is saved, under which label it lands, the file and
folder names and the log are considered *finished*. An optimisation that changes any of that
— such as fetching fewer messages per conversation — is rejected however defensible, because
a mail in the wrong place costs more than the seconds it saves. The one deliberate exception
is the label-tree copy, and only while its "keep structure" switch is on.

**Destructive actions are trash only, and never automatic.** Rollback of a copy and the
label cleanup move mail to Gmail's trash, which Google keeps for 30 days. Permanent delete
is not requested anywhere. Three reasons: it is recoverable; permanent delete needs the
`mail.google.com` scope, and adding a scope forces every user to re-consent; and the relay
and the Workspace delegation entry would have to change in lockstep. The cleanup is always a
choice the user makes on screen. A "clean up after copy" mode was designed and then
**cancelled** by the owner; do not build it.

**Linking is limited to the company domain; viewing is not.** Anyone can open a private
Gmail account in the app. Only `@abovomaxlead.nl` accounts can be linked to the Gmail API,
which is what drag, copy, cleanup and crash reports need (`electron/auth/account-domain.ts`).
Tokens for other domains are deleted at every start, by design.


## 2. Windows, views and accounts

**One shared Chromium session (`persist:google`) for every Google account.** A view in a
different partition is a different browser as far as Google is concerned, and would be
signed out while the rest of the app is not. Accounts are told apart by Google's own
multi-login index, `/mail/u/<n>/`. The cost: Google can sign every account out at once.
(`electron/core/session-partition.ts`)

**Accounts are discovered, not configured.** No API lists the accounts a browser is signed
into, so the app probes `/mail/u/0`, `/u/1`, … and reads the identity from the page. It
stops at the first gap. The index is never cached, because the digit belongs to the browser
session, not the account. (`electron/accounts/detection-controller.ts`, `detection-planner.ts`)

**Removing a mailbox writes a tombstone (`hidden.json`).** Neither discovery path can be
told to stop finding something; without a tombstone, a manager with twenty delegations
cleared the same twenty rows after every update. Do not reuse the old `removed.json` name:
an orphaned copy of that file is still on some machines and would silently hide a mailbox.

**One native view per mailbox × Google app, kept alive.** Switching tabs is instant because
nothing reloads. Views are native layers *above* the shell page, which is why the settings
panel hides them and why dialogs are separate overlay views. (`electron/windows/profile-view-manager.ts`)

**Views warm up off-screen but visible.** An invisible view counts as occluded and Gmail
never builds its message list in it, so a warming view is parked at x = −4000 until its
title looks like a loaded mailbox.

**Low-memory mode works per view, not per account.** The first version only discarded mail
views and changed nothing noticeable, because calendar, Drive and the other apps stayed
loaded. (`electron/windows/view-budget.ts`)

**`contextIsolation: false` in Google views, `true` everywhere else.** The preload must
replace `window.Notification`, `window.open`, the permissions query and the service worker's
`showNotification` *inside the page's own JavaScript world*. That is only possible without
isolation, and it is accepted because those views load only Google's own domains. Every page
the app itself owns uses isolation and a narrow `window.desktop` bridge.

**The notification permission dance.** The session *denies* notifications, so Gmail's service
worker cannot reach the Windows notification centre on its own. The page shim *answers
"granted"*, or Gmail stops notifying at all. Google Calendar raises reminders through the
service worker, so that path is rerouted through the same shim. (`electron/preload.ts`)

**The app draws its own notifications** in a separate toast window, with a watchdog. If the
toast page does not come up, the app falls back to native notifications and recovers on its
own after a minute. (`electron/toast/`)

**The unread count comes from the page title, matched by shape.** Gmail is localised, so the
code matches `(n)` in the title and an `aria-label` holding an e-mail address, never
translated text. The title is the authority; the API sweep only fills in where the page has
said nothing.

**`window.open` returns a stub, never `null`.** Gmail reads `null` as a popup blocker and
gives up opening anything.

**Microsoft Entra sign-in pages stay inside the app.** The domain signs in to Google through
Entra; handing that POST to the system browser turns it into a GET, which fails with
AADSTS900561. (`electron/system/external-links.ts`)


## 3. Storage and credentials

**Every settings file is written atomically and keeps a `.bak`.** The installer kills the app
during an update. The old `writeFileSync` truncated first, so a half-written `prefs.json`
read back as "nothing stored" and the defaults were saved over it. Now the code writes a
`.tmp` file, fsyncs it, renames it into place and keeps a backup copy. Side effect worth
knowing: deleting `prefs.json` alone does nothing, because it comes back from `prefs.json.bak`.
(`electron/core/json-store.ts`)

**Refresh tokens are sealed with the OS keystore (`safeStorage`: DPAPI, Keychain or
libsecret).** A refresh token never expires and grants read, insert and modify access to a work
mailbox. The domain already redirects Documents to a server share, and AppData is one policy
away from the same fate. A file that cannot be decrypted is moved aside
(`.unopenable-<time>`), never overwritten, because a locked keyring is temporary and an
overwrite is not. Unlinking also revokes the token at Google.

**The OAuth client secret is not treated as a secret.** A desktop OAuth client's secret is
public by Google's own definition (RFC 8252), ships in every installer, and the flow already
uses PKCE. It is kept out of the *public repository* only because credential scanners find
it there and Google then withdraws it.

**The OAuth config is injected at build time and pinned.** `assets/oauth-defaults.json` is
git-ignored and written by CI from the `GOOGLE_OAUTH_JSON` secret.
`scripts/check-bundled-oauth.mjs` refuses to build when that file is missing, empty or names
a different Google Cloud project than `910925363385`. This gate exists because a release
once shipped without the config, and the developer never saw it: a hand-placed config in his
own AppData always wins over the bundled one. A different OAuth client would unlink every
account on every machine the moment the update installs.


## 4. Gmail API and the copy engine

**Quota is paced, not rationed.** Calls are priced with Google's own unit table and spaced
evenly at 90 % of the allowance. Pacing at 100 % drifted over the per-minute limit after about
four minutes and lost one mail out of 2,574. A refusal inside the budget means the price
list changed under us, so the ceiling drops to 60 % and climbs back one step per quiet
minute. The project is still on Google's *old* quota table (250 units per second per user);
Google has said that grandfathering will end. (`electron/gmail/quota.ts`)

**Budgets are per access token.** Quota is per user, and a delegated mailbox is its own user
with its own token. Twenty delegated mailboxes therefore have twenty allowances.

**An upload is never retried after a timeout.** The mail may have landed; a retry would put
it in twice. An insert is repeated only on an explicit 429, a 503 or a named rate-limit
reason. A reported failure is preferred over a silent duplicate. (`electron/gmail/retry.ts`)

**Batching buys round trips, not quota.** Reads go through Gmail's per-API batch endpoint,
fifty per request, or ten for raw mail. `messages.insert` cannot be batched, because Google
refuses media uploads inside a batch. If a batch reply does not parse, the code silently
falls back to one call at a time and logs it. (`electron/gmail/batch.ts`)

**The upload budget is in bytes, not a count.** A count low enough for one 11 MB mail
throttled the ninety-nine 53 KB mails beside it. Measured: the app's own limit of 8 uploads
in flight was the bottleneck, not Gmail. Now 64 MB may be in flight.

**Every copy run carries a hidden marker label, inside the same upload.** Each insert is
tagged `_gmd-copy-<runId>` in the *same* multipart request, never by a follow-up call that
could be cut off. "What did this run create?" is then label membership, not guesswork. That
is what makes pause, cancel and rollback safe, and it survives a crash, because the label
lives in Gmail. A journal file (`<runId>.rollback.jsonl`) records the run; the stop decision
is written *before* the cleanup sweep, so a crash during cleanup resumes without asking
again. Sweeps act on the label id from the journal, never on a name looked up later.

**One drag at a time, and nothing new while a big job runs.** A second drop used to overwrite
the first one's results. A second copy started while a batched job was running inserted
**717 mails twice** on 2026-08-26, because Gmail's search index lags behind fresh inserts
and the duplicate check could not see them. Both are now refused with a message.

**Labels over 2,000 conversations become a batched job.** Each batch is an ordinary drag and
copy with its own run, journal and marker, so everything downstream stays the same code path.

**Label cleanup is count-then-purge with a one-shot handle.** The purge acts only on the ids
the user was shown, so mail that arrives in between survives, and one count buys exactly one
purge. Gmail's nesting is naming, not containment (`Klanten/Acme` is a separate label), so
every sublabel is its own line.

**The drop folder is local, not Documents.** Documents is redirected to a server share, and
that share silently zeroed appended log records: 65 KB of a 578 KB log was lost in one day.
The default is now `%LOCALAPPDATA%\Gmail Desktop\Mail`. The folder is a staging area, not an
archive; it holds complete customer mail outside Gmail, so it is emptied after three days.
Only `log.jsonl` is kept.


## 5. Delegated mailboxes and the relay

**The domain-wide delegation key lives on the relay, never in the app.** It opens every
mailbox in the domain and is the only real secret in the system. The app asks the relay for
a token for one mailbox at a time.

**The relay checks who is asking and whether Google agrees.** It verifies the caller's
Google token, including that it was minted *for this app's OAuth client* (`aud`). Without
that check, any Google token a colleague ever gave any app could be traded for mail access.
It then mints a token for the target, reads the target's own delegate list with it, and
hands the token over only if the caller is listed as `accepted`. Domain membership is only a
pre-filter; Google's delegate list is the authority.

**Delegated mailbox URLs are read from Gmail's account switcher.** The `/d/<id>/` part exists
nowhere else, cannot be built from the address, and rotates. A rotated id silently drops the
view onto the user's *own* inbox, so the app compares the address in the page title with
the one it expects, and re-reads the switcher once when they differ.

**A mailbox is removed only on unanimous, certain evidence.** Only when every own account
answered, and every one got a 403. A relay outage, a timeout, or an empty list never removes
anything. Loosening this guard wipes people's delegation lists.

**Delegated mailboxes are swept every 15 seconds over the API.** Gmail never fires a
notification inside a delegated view; this was proven from the logs. The sweep is their
only source of notifications. It costs 2 quota units per sweep against that mailbox's own
allowance.

**Realtime push was removed.** The original design ran Gmail push through Pub/Sub, then the relay,
then a WebSocket into the app. It was deleted as dead code in the 2026-09-02 audit (commit
`35f7049`): own accounts are notified by the Gmail page, delegated ones by the sweep. The relay
still contains the push half, unused.


## 6. Releases and updates

**Version `1.0.0-beta.<unix time>`.** The number only ever increases and needs no counter. The
`beta.` part is not decoration. electron-updater ignores any release whose prerelease
channel is not `alpha` or `beta`, so `1.0.0-1787829939` published green and was never
offered to anyone.

**The workflow creates the GitHub release itself.** electron-builder would mark every release
as a prerelease, and a repository whose newest release is a prerelease has no "latest"
release, so stable installs would find nothing. The workflow sets `--prerelease` only when
the version has a `-` suffix.

**The beta opt-in is tri-state, and `autoUpdater.channel` is never used.** "Not chosen" has to
mean "follow the running version", or shipping the switch would park every beta tester.
Setting `channel` silently enables downgrades.

**The organisation repository is a copy, not a transfer.** It was moved without its old
releases, so GitHub provides no redirect. Every install up to `0.3.1-beta.14` still asks the
developer's personal repository `lucamanuel-art/gmail-desktop` for updates and reaches the
organisation only through one *bridge release* there. That repository must stay online.

**macOS needs both `dmg` and `zip`.** The dmg is what a person installs; the zip is what the
updater reads. A mac release without the zip fails every update check.

**Feedback goes through the user's own Gmail compose window, with the log tail in the body.**
The body rides in Gmail's compose URL, and Google rejects a URL longer than about 8 KB
(measured: 8,157 bytes accepted, 8,357 refused), so only the redacted tail of the logs fits.
A folder window and a log-file attachment were both built and removed on the owner's
instruction; do not reintroduce them.

**Crash reports send themselves.** The app sends them through the Gmail API from the user's
own linked account, redacted, at most once per six hours per fault. This is why the
`gmail.send` scope exists.


## 7. Code conventions

- Pure, Electron-free logic lives in small modules with unit tests, and the Electron layer is
  thin wiring on top. That is why there are about 2,300 tests and almost none touch Electron.
- `electron/main.ts` only wires. Dependencies that point *up* the stack are injected as
  hooks in `wireModules()` instead of imported, to keep import cycles out
  (`node scripts/cycles.mjs` checks this).
- Files are divided by fixed banner comments (`// Types`, `// Constants`,
  `// Exported functions`, `// Helper functions`), and docblocks state the contract.
- New code, comments, commits and docs are in English. Older specs, the changelog and log
  lines are partly Dutch; leave them as they are.
- The UI exists in English, Dutch and "Rene mode": very plain Dutch at 170 % zoom, an
  accessibility mode for colleagues who need it. Every string lives in `renderer/app/strings.ts`.
