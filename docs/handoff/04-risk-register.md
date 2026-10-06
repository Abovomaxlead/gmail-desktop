# Risk register

What can break, how you will notice, and how to repair it without the original developer.
Each risk has an id, so the other documents and future tickets can refer to it.

**Likelihood** is a judgement for the next twelve months. **Impact** is how many people it stops
and how badly: **High** means most users lose their core work, **Medium** means one feature or one
group, **Low** is an inconvenience.


## Overview

| Id | Risk | Likelihood | Impact |
|---|---|---|---|
| [R1](#r1-the-oauth-client-is-replaced-deleted-or-its-secret-withdrawn) | The OAuth client is replaced, deleted or its secret withdrawn | Low | **High** |
| [R2](#r2-a-release-ships-without-or-with-the-wrong-oauth-config) | A release ships without, or with the wrong, OAuth config | Low (gated) | **High** |
| [R3](#r3-only-one-person-can-change-the-google-cloud-project) | Only one person can change the Google Cloud project | Medium | **High** |
| [R4](#r4-the-relay-is-down) | The relay is down | Medium | Medium |
| [R5](#r5-the-relay-secrets-are-lost) | The relay secrets are lost | Low | Medium → High |
| [R6](#r6-google-moves-the-project-to-the-new-gmail-quota-table) | Google moves the project to the new Gmail quota table | **High** | Medium |
| [R7](#r7-gmail-changes-its-page) | Gmail changes its page (title, DOM, notification calls) | **High** | Medium → High |
| [R8](#r8-google-blocks-sign-in-inside-the-app) | Google blocks sign-in inside the app | Low | **High** |
| [R9](#r9-the-workspace-delegation-entry-or-admin-account-changes) | The Workspace delegation entry or admin account changes | Medium | Medium |
| [R10](#r10-the-relay-and-the-app-disagree-on-the-oauth-client) | The relay and the app disagree on the OAuth client | Low | Medium |
| [R11](#r11-installers-are-not-code-signed) | Installers are not code-signed | Certain | Low → Medium |
| [R12](#r12-a-release-is-cut-from-a-branch-that-lacks-shipped-work) | A release is cut from a branch that lacks shipped work | Medium | Medium |
| [R13](#r13-the-old-github-repository-disappears) | The old GitHub repository disappears | Low | Medium |
| [R14](#r14-github-actions-or-the-release-secret-stop-working) | GitHub Actions or the release secret stop working | Low | Medium |
| [R15](#r15-feedback-and-crash-reports-reach-nobody) | Feedback and crash reports reach nobody | **High** | Medium |
| [R16](#r16-dependency-and-platform-upgrades) | Dependency and platform upgrades break the build or the app | Medium | Medium |
| [R17](#r17-a-copy-duplicates-loses-or-misplaces-mail) | A copy duplicates, loses or misplaces mail | Low | **High** |
| [R18](#r18-the-drop-folder-cleanup-removes-an-unfinished-runs-journal) | The drop-folder cleanup removes an unfinished run's journal | Low | Medium |
| [R19](#r19-the-token-file-cannot-be-opened-on-a-new-pc-or-profile) | The token file cannot be opened on a new PC or profile | Medium | Low |
| [R20](#r20-a-delegated-tab-silently-shows-the-wrong-mailbox) | A delegated tab silently shows the wrong mailbox | Medium | Medium |
| [R21](#r21-relay-tls-certificate-or-registry-credentials-expire) | Relay TLS certificate or registry credentials expire | Medium | Medium |
| [R22](#r22-untested-code-paths-and-no-tests-in-ci) | Untested code paths, and no tests in CI | Certain | Medium |
| [R23](#r23-customer-mail-on-local-disks) | Customer mail on local disks | Certain | Medium (privacy) |
| [R24](#r24-hardening-gaps-in-the-electron-layer) | Hardening gaps in the Electron layer | Low | Medium |
| [R25](#r25-leftovers-of-the-removed-push-design) | Leftovers of the removed push design | Certain | Low |
| [R26](#r26-small-hard-coded-limits) | Small hard-coded limits (10 accounts, one domain) | Medium | Low |


## Accounts, Google and credentials

### R1. The OAuth client is replaced, deleted or its secret withdrawn

**Symptom.** Every linked account on every machine shows "Verbinding verlopen". The reconnect
banner names them all, and reconnecting either fails or works only on some machines.

**Cause.** Every refresh token belongs to one OAuth client in project `app-gmail-desktop`
(number `910925363385`). This breaks it:
- A new client: a new project, or someone "cleaning up" Credentials.
- A reset secret.
- Google withdrawing a secret found in a public place.

**Repair.**
1. Find which case it is: in `update.log` and `notify.log`, `invalid_client` means a secret
   problem and `invalid_grant` means a revoked token.
2. **Same client, new secret.** Put the new secret in `GOOGLE_OAUTH_JSON`
   (`gh secret set GOOGLE_OAUTH_JSON -R Abovomaxlead/gmail-desktop < google-oauth.json`) and
   release. Machines with a hand-placed `%APPDATA%\gmail-desktop\google-oauth.json` keep the old
   secret: replace that file, or have users import the new one in Settings.
3. **New client.** Do everything in step 2, plus:
   1. Change `EXPECTED_PROJECT_NUMBER` in `scripts/check-bundled-oauth.mjs` in the same commit.
   2. Set the relay's `OAUTH_CLIENT_ID` to the new id and redeploy it (R10).
   3. Authorise the new client id in the Workspace admin console, if your policy requires it.
   4. Announce in the changelog that everyone must link again.

**Prevent.** Never commit the config. Never delete the client in the console. Keep R3 solved,
so someone can act.

### R2. A release ships without, or with the wrong, OAuth config

**Symptom.** After an update, a fresh install cannot link any account. Or every user is asked to
link again. The developer's own machine never shows it, because his hand-placed config wins.

**Cause.** A missing or emptied `GOOGLE_OAUTH_JSON` secret writes an empty file, and the build
would still succeed. This already happened in August 2026.

**Repair.** The `check:oauth` step now fails the release instead. If it fails, set the secret
again from a working `google-oauth.json` (R1 step 2) and re-run the workflow. A re-run is
idempotent.

**Prevent.** Never bypass `check:oauth`. To check a released exe, unpack it (see 03 §2).

### R3. Only one person can change the Google Cloud project

**Symptom.** Nothing, until something has to change: a key, a secret, IAM, an API, the consent
screen. Then nobody can.

**Cause.** `app-gmail-desktop` has exactly one owner. The developer has no project-level role
and cannot grant or read IAM.

**Repair.** Ask the owner. There is no technical route around it.

**Prevent.** **Add a second owner now**, with the Workspace admin or IT as a break-glass account.
Write down which project holds the domain-wide delegation key. It is a different project from
the Pub/Sub key, and that project needs its own second owner too.

### R8. Google blocks sign-in inside the app

**Symptom.** "This browser or app may not be secure" when adding an account, or a consent
page that never completes.

**Cause.** Google tightens its rules for embedded browsers. The app sends Electron's default
user agent, which names Electron.

**Repair.**
1. **Short term.** Give the `persist:google` session a plain Chrome user agent. Call
   `session.fromPartition('persist:google').setUserAgent(...)` with the `Electron/…` and
   `gmail-desktop/…` tokens removed. The place to do it is `electron/system/system-integration.ts`
   or `session-setup.ts`.
2. **For linking.** Move consent to the system browser with a real listener on
   `127.0.0.1:47813`. The redirect URI is already of the loopback type
   (`electron/auth/google-oauth.ts`), so no change is needed at Google.
3. **Keep Entra in-app.** Microsoft sign-in pages must stay inside the app either way
   (`external-links.ts`).

### R9. The Workspace delegation entry or admin account changes

**Symptom.** Copying into or from `support@`-style mailboxes fails, and the relay log shows
`unauthorized_client` (HTTP 502). Delegated mailboxes no longer appear, or the list freezes.

**Cause.**
- Admin console → Security → API controls → **Domain-wide delegation**: someone edited the
  entry for the relay's service-account client id. Pasting a single scope *replaces* the
  whole list.
- Or the admin named in `DELEGATED_ADMIN_SUBJECT` lost admin rights or left.
- Or a delegation is only `pending` and not `accepted`, which is refused by design.

**Repair.**
1. Restore the full comma-separated scope list on that client id:
   `https://www.googleapis.com/auth/gmail.readonly`, `…/gmail.insert`, `…/gmail.modify`,
   `…/gmail.send`, `…/userinfo.email`, `…/admin.directory.user.readonly`.
2. Run `node scripts/check-dwd.mjs` against the key to confirm. Propagation can take minutes.
3. If the admin subject changed, set `DELEGATED_ADMIN_SUBJECT` to a current admin and run
   `docker compose up -d`.

### R10. The relay and the app disagree on the OAuth client

**Symptom.** Every delegated call fails with 401. The relay log says `aud_mismatch`. Own accounts
are fine.

**Cause.** The relay's `OAUTH_CLIENT_ID` is not the app's `clientId`. That happens after R1, or
after a new relay host was set up from `.env.example`.

**Repair.** Set `OAUTH_CLIENT_ID` to the `clientId` from the app's config, then run
`docker compose up -d`. The relay prints the value it expects at startup.

### R19. The token file cannot be opened on a new PC or profile

**Symptom.** After a PC migration, a Windows profile reset or a restored roaming profile,
every account shows "not linked". `notify.log` says `sealed elsewhere`.

**Cause.** Tokens are sealed with the Windows user's keystore. This is by design.

**Repair.** Link each account again. The old file stays as `.unopenable-<ts>` and can be
deleted.


## The relay

### R4. The relay is down

**Symptom.**
- Delegated mailboxes stop notifying. Mail cannot be copied into or out of them, and their
  labels are missing from the picker.
- `notify.log`: `Relay niet bereikbaar`, `delegated mailbox … could not be read`.
- Own accounts are **not** affected. No mailbox is ever removed because of an outage.

**Cause.** It is one container on one company server, with no standby. Possible causes are the
host, Docker, Traefik, DNS, the TLS certificate (R21), or a relay that refuses to boot: it will
not start with a missing key, and then the whole domain answers 404.

**Repair.**
1. `curl https://<relay-domain>/healthz`.
2. On the host, run `docker compose ps` and `docker compose logs --tail 100 relay`. A boot
   refusal names the missing key.
3. Fix the key, or restore the secret (R5).
4. Run `docker compose up -d`.
5. **To move the relay to a new host,** follow `DEPLOYMENT.md` in the relay repository. Bring
   the same `.env` and both key files, then repoint DNS.

### R5. The relay secrets are lost

**Symptom.** It shows up as R4 once the host is rebuilt: the relay will not start.

**Cause.** `.env`, `secrets/sa.json` (Pub/Sub, unused today) and `secrets/delegation-sa.json`
(domain-wide delegation) exist **only on the server**. Nothing is in git or a vault, by design
for git and by omission for the vault.

**Repair.**
1. `OAUTH_CLIENT_ID` comes from the app's config. `ALLOWED_DOMAINS` is `abovomaxlead.nl`.
   `DELEGATED_ADMIN_SUBJECT` is any Workspace admin.
2. Create a **new JSON key** for the delegation service account in its Google Cloud project.
   That needs the project owner (R3). A new key on the *same* service account keeps the same
   client id, so the delegation entry in the admin console needs no change.
3. Delete the old key in the console if it may have leaked.

**Prevent.** Put all three files in the company password vault today. The delegation key opens
every mailbox in the domain, so treat it accordingly.

### R21. Relay TLS certificate or registry credentials expire

**Symptom.**
- **TLS expired.** Every relay call fails with a certificate error (R4 symptoms).
- **Registry credentials expired.** A redeploy cannot pull, or the Bitbucket pipeline fails at
  `docker login`.

**Cause.**
- The certificate is configured by hand in Traefik's file provider, not ACME.
- The Azure service principal secret used by the pipeline has an expiry date.

**Repair.**
- Renew the certificate and reload Traefik.
- Renew the service principal secret in Azure, then update `AZURE_CLIENT_SECRET` in the Bitbucket
  repository variables.
- As a stopgap, build the image on the host (`docker build -t <image>:latest .`) and run
  `up -d`.
- Check that `ACR_REPOSITORY` in Bitbucket matches the path `docker-compose.yml` pulls
  (`am-dev/gmail-push-relay`). The docs still mention `am-tools`.

**Prevent.** Put both expiry dates in a calendar.


## Gmail and Google changing under us

### R6. Google moves the project to the new Gmail quota table

**Symptom.** Copies and big label drags slow down sharply. `notify.log` keeps showing
`[quota] Gmail refused a call inside the budget; ceiling now …` and the ceiling never climbs
back.

**Cause.** The project is still on Google's old table: 250 units per second per user,
`messages.get` costs 5. Projects created after May 2026 get 100 units per second, where
`messages.get` costs 20. Google has said the grandfathering is temporary. The app already
adapts its ceiling by itself, so this is a slowdown, not an outage.

**Repair.**
1. In `electron/gmail/quota.ts`, set `UNITS_PER_SECOND` to `100` and update the prices in
   `QUOTA_COST` from Google's current quota page.
2. Re-measure `COPY_IN_FLIGHT` in `mail-drop-controller.ts`.
3. Release.

### R7. Gmail changes its page

The app reads a small number of things from Gmail's page. When Google changes one, the
matching feature breaks. Unit tests sit next to each parser, so a fix is a regex or selector
change plus a test.

| What changes | You notice | Fix in |
|---|---|---|
| The title format `(n) … - Gmail` | wrong or zero unread badge; tabs warm up slowly (25-second cap) | `electron/unread/unread-parser.ts` |
| The avatar (`a[aria-label]` with an e-mail address and an `img`) | **no accounts detected**; the first mailbox shows but no tab appears | `electron/preload.ts` `extractIdentity` |
| `data-legacy-thread-id` / `data-legacy-message-id` | notification clicks open the inbox, not the mail | `preload.ts`, `gmail/message-anchor.ts` |
| Gmail no longer calls `window.Notification` | no notifications for own accounts; `shim installed` but never `Gmail raised a notification` | `preload.ts` shim |
| The list rows, label links or the drag gesture | the drop strip does nothing, or picks the wrong row | `electron/mail/drag/dropzone.ts`, `label-drop.ts` |
| The account switcher widget | delegated mailboxes never get a URL: `still unresolved after` | `electron/delegation/delegation.ts` `SWITCHER_SCRAPE_JS`, `windows/switcher-reader.ts` |
| The `AddSession` URL | "+" does nothing | `electron/gmail/google-urls.ts` |
| The batch reply format | silent; logs `batch … falling back one by one` and keeps working, slower | `electron/gmail/batch.ts` |
| The `rfc822msgid:` OR limit drops below 10 | the duplicate warning goes quiet; the canary catches it | `BATCH_QUERY_LIMIT` in `gmail-api.ts` |

**Rule for every fix:** match on structure (roles, hrefs, attributes), never on visible text or
class names. Gmail is localised and its class names are generated.

### R20. A delegated tab silently shows the wrong mailbox

**Symptom.** The `support@` tab shows *your own* inbox. Its badge count matches yours.

**Cause.** The `/d/<id>/` in a delegated mailbox URL rotates at Google, and Gmail then falls
back to the signed-in user's inbox. The app detects this from the page title and re-reads the
account switcher once.

**Repair.**
1. Search `notify.log` for `switcher geeft dezelfde url voor …; niets vervangen`. If it is
   there, the delegation itself is gone, not rotated: have the owner of the mailbox delegate it
   again in Gmail settings.
2. Otherwise restart the app. If it persists, check `%APPDATA%\gmail-desktop\delegated.json`.

**Never loosen the removal guard** in `delegated-reconcile.ts` / `delegated-access.ts`. Doing so
wipes delegation lists during an ordinary relay outage.


## Releases and distribution

### R11. Installers are not code-signed

**Symptom.**
- Windows SmartScreen shows "Unknown publisher" on first install, and some antivirus or company
  policies block the exe.
- macOS reports the app as "damaged".

**Cause.** There is no code-signing certificate and no Apple Developer account.

**Repair.**
- **Windows.** Choose More info → Run anyway. Auto-updates work unsigned, because
  electron-updater checks the sha512 hash.
- **Mac.** Run `xattr -dr com.apple.quarantine "/Applications/Gmail Desktop.app"`.

**Prevent.** Buy an OV/EV certificate or use Azure Trusted Signing, and add it to the workflow.
**Do not set `publisherName` without actually signing**, or every update fails its signature
check. Mac auto-update needs signing *and* a mac job in `release.yml`.

### R12. A release is cut from a branch that lacks shipped work

**Symptom.** After an update, users lose features they had: tab windows, the opt-in beta switch,
the persistent event reminder.

**Cause.** A tag was pushed from a feature branch that was never merged. This happened with
`v1.0.0-beta.1789652279`, tagged on `feature/tab-windows`. That branch was merged into `dev`
and `master` on 2026-10-01, so it is resolved for now. The same shape can come back with
any branch.

**Repair.** Before a release, check what the last release contains that the branch does not:
`git log --oneline dev..v<last-release>`. Merge whatever that shows, run the tests, then release.

**Prevent.** Tag only on `dev`, and only after merging.

### R13. The old GitHub repository disappears

**Symptom.** Colleagues still on a pre-1.0 build never get an update again, and see update errors.

**Cause.** Those builds have `lucamanuel-art/gmail-desktop`, the developer's personal account,
baked in. They reach the organisation repository only through the bridge release there. Only
that personal account can manage the repository.

**Repair.** If it is gone, those users must download the current installer by hand from the
organisation's releases page.

**Prevent.** Add a colleague as an admin collaborator on that repository. Check in the feedback
mails whether anyone still reports a `0.x` version; once nobody does, the repository can be
archived. Keep its releases.

### R14. GitHub Actions or the release secret stop working

**Symptom.** The release run fails at "Create the release" or at upload with a 403, or at
"Check the bundled OAuth config".

**Cause.**
- The organisation set workflow permissions to read-only.
- The `GOOGLE_OAUTH_JSON` secret was removed.
- A runner image changed.

**Repair.**
- Under Settings → Actions → Workflow permissions, choose **Read and write**.
- Set the secret again (R1 step 2).
- If a runner image broke the build, pin `windows-2022` or `macos-14` in the workflow.

### R16. Dependency and platform upgrades

**Symptom.** The build fails, or after an upgrade the views, notifications, the badge or tokens
behave differently.

**Cause.** Electron releases a major version about every eight weeks and supports only the last
three. Next 16 builds with Turbopack. Tailwind, vitest and electron-builder each have majors
waiting.

**Repair or upgrade procedure.**
1. Upgrade on a branch.
2. Read the breaking changes.
3. Run `npm test` and `npx tsc -p tsconfig.json`.
4. Smoke-test by hand with `--user-data-dir`: sign-in, detection, the badge, a notification and
   its click, OAuth reconnect, tokens still opening, a drag, a copy, and a sound playing.

Three settings in `renderer/next.config.mjs` must survive any Next upgrade:
- `output: 'export'`;
- `turbopack.root` at the *repository* root (pages import from `electron/`);
- `agentRules: false`.

**Relay.** The Dockerfile runs Node 26 while the tooling container is pinned to 20. Align them
on an LTS version.


## Mail integrity

### R17. A copy duplicates, loses or misplaces mail

**Symptom.** Mail appears twice in the target, or the copy reports fewer copied than dragged.

**Cause and the safety nets that exist.** Each part of a copy has its own guard:
- **Uploads.** An insert is never retried after a timeout, so a timeout is reported as a
  failure rather than risk a duplicate.
- **Concurrent copies.** A second copy or drag during a running job is refused. This is the
  717-duplicates lesson.
- **Marking.** Every run marks its own mail with a hidden label, so a stop or rollback acts on
  exactly what the run created.
- **Crashes.** A crashed run is resumed or offered at the next start.

**Known gap.** A 401 while copying **into a delegated mailbox** cannot recover. `copyToMailbox`
calls `forceRefresh`, which only knows own accounts. The mail fails with "Verbinding verlopen"
and the delegated mailbox lands in the reconnect list. Fix: use `freshTokenAfter401` from
`electron/auth/mailbox-token.ts` there (`mail-drop-controller.ts`, both `forceRefresh` call
sites). It bites on long copies into `support@`.

**Repair after the fact.**
1. Every run's journal (`<runId>.rollback.jsonl` in the drop folder) lists what it inserted.
   `log.jsonl` lists every saved and copied mail.
2. A finished run can be rolled back as long as its journal exists. A rollback moves the mail to
   the trash, so it stays recoverable for 30 days.
3. To remove duplicates by hand, search the target for the hidden marker label of the run, if
   it was not stripped yet, or by `rfc822msgid:`.

**Prevent.** The rule in 01 §1: speed may change, which mail lands where may not.

### R18. The drop-folder cleanup removes an unfinished run's journal

**Symptom.** A copy that was interrupted and never answered is no longer offered for
continue or undo. Hidden `_gmd-copy-…` labels stay on the copied mail.

**Cause.** *Found in this review, not yet reproduced.* `expiredEntries` in
`electron/mail/pull/mail-drop-cleanup.ts` keeps only `log.jsonl`. Journals (`*.rollback.jsonl`) and
job plans (`*.job.jsonl`) older than three days are deleted like any saved mail. This only
matters for a run left undecided for more than three days.

**Repair.** Make `expiredEntries` also keep `*.rollback.jsonl` and `*.job.jsonl` whose run is not
closed, or simply keep both suffixes and let them age out after, say, 30 days. Leftover marker
labels are harmless and hidden. They can be deleted in Gmail settings → Labels, where they show
when "show hidden" is on, or by API.

### R23. Customer mail on local disks

**What.** Dragged mail is stored as `.eml` files in the drop folder for three days. `notify.log`
and `log.jsonl` carry mailbox addresses and label names, but no bodies or subjects; the
redaction covers subjects and senders. Logs written before 2026-08-20 sit on the redirected
Documents share and may still contain mail text in `body` fields. The cleanup strips those it
can reach.

**Do.** Keep the three-day term. Do not point the drop folder at a synced or shared folder;
Settings warns about that. When adding a log line, check `electron/feedback/log-redact.ts`.


## Process and code health

### R15. Feedback and crash reports reach nobody

**Symptom.** Colleagues report problems and nothing happens.

**Cause.** `FEEDBACK_TO` in `electron/feedback/feedback-mail.ts` is the developer's personal work
address, and automatic crash reports go there too. Installed versions keep using the address
they were built with.

**Status.** On 2026-10-01 the owner decided this is fine for now.

**Repair, when the developer is away for longer.**
1. Set an auto-forward or a delegate on that mailbox.
2. In a release, point `FEEDBACK_TO` at a shared group address.

### R22. Untested code paths, and no tests in CI

**What.** About 2,300 unit tests cover the pure logic. None run in CI. Nothing in the repository
exercises Electron or a real Gmail mailbox. Several copy features have never had a recorded
acceptance run (05 §2). `renderer/app/maildrop/page.tsx`, the copy UI, has no tests at all.

**Do.**
1. Add `npm test` as a step in `release.yml` before the build.
2. Run the live checks in 05 against the scratch label (05 §2) before trusting a change to the
   copy engine.

### R24. Hardening gaps in the Electron layer

- The permission handler on `persist:google` grants everything except notifications. That covers
  camera, microphone and clipboard on any page in that session (`notify/notification-policy.ts`).
  It is acceptable for Meet and Chat; restrict it to Google origins if you harden.
- IPC handlers do not check which page sent the message (`core/ipc-handlers.ts`). Google pages
  cannot reach `ipcRenderer` without also breaking the preload, but checking `e.sender` on
  privileged channels is cheap.
- macOS has no `activate` handler: clicking the Dock icon after closing the window does
  nothing.
- With the tray icon switched off, closing the window hides it with no way back except
  relaunching.

### R25. Leftovers of the removed push design

The relay still runs the WebSocket route and pulls Pub/Sub. The Google Cloud project still has
topic `gmail-push`, subscription `gmail-push-relay` and the subscriber key `sa.json`. Nothing uses
them since 2026-09-02, and on the developer's machine the relay copy logs `PERMISSION_DENIED`
on Pub/Sub at every start.

**Decide.** Either retire them, along with the relay's push code and that key, or restore push
from git history (`git show 35f7049^`), including a daily `users.watch` renewal. Until then, a
broken Pub/Sub key can block the relay from starting.

### R26. Small hard-coded limits

| Limit | Where | Effect when exceeded |
|---|---|---|
| 10 own accounts | `accounts/detection-planner.ts` `maxAccounts` | the 11th signed-in account is never detected |
| one domain, `abovomaxlead.nl` | `auth/account-domain.ts`, also `hd=` in `google-oauth.ts` and the relay's `ALLOWED_DOMAINS` | a rename or a second domain cannot link, and its tokens are **deleted** at start |
| labels up to 50,000 conversations by API (2,000 by page scrape) | `mail/drag/label-drop.ts` | the rest is not copied; the app says so |
| updater installs on quit without checking for a running copy | `updates/update-controller.ts` `installUpdate` | the copy is interrupted; the journal offers it back at the next start |
