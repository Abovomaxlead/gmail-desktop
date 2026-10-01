# Gmail Desktop — handoff

Start here. This folder is written for a colleague who has to keep Gmail Desktop running,
release it, or fix it while its original developer (Luca Manuel) is not available. It
assumes you can read TypeScript and use git, and nothing else about this project.

Written 2026-10-01 from a full read of the desktop repository, the push relay repository,
the CI configuration and the developer's working notes. Where something could not be
verified from here, the text says so.

> **The repository is public.** Hostnames, internal IP addresses, account names and who
> holds which key are deliberately kept out of these files. They live in
> [`INTERNAL-access-and-infrastructure.md`](INTERNAL-access-and-infrastructure.md), which
> is git-ignored for that reason. Keep the real copy in a private place, such as the Bitbucket
> relay repository or the company drive, and tell colleagues where it is.


## What this is, in one paragraph

Gmail Desktop is a Windows (and, unsigned, macOS) desktop app used inside Abovo Maxlead. It
shows the **real Gmail web interface** — not a home-built mail client — for every Google
account a person is signed into, plus the mailboxes they are a delegate of (such as
`support@`). Around Gmail it adds what the browser cannot: a tab per mailbox, its own
notifications, an unread badge, a tray icon, `mailto:` handling, and above all
**drag-and-drop of mail and whole labels from one mailbox into another**, with duplicate
detection, pause/cancel and rollback. It is built with Electron, a small Next.js shell, and
a separate server component (the *relay*) that hands out access to delegated mailboxes.


## The documents

| File | Read it when |
|---|---|
| [01-why-it-is-built-this-way.md](01-why-it-is-built-this-way.md) | Before changing anything. Every load-bearing design decision and the reason behind it. |
| [02-architecture.md](02-architecture.md) | You need to find code, understand the moving parts, or know what lives on a user's disk. |
| [03-operations.md](03-operations.md) | Setting up a dev machine, releasing a version, redeploying the relay, reading the logs. |
| [04-risk-register.md](04-risk-register.md) | **Something is broken**, or you want to know what could break. Every risk with symptom, cause and the repair. |
| [05-open-work.md](05-open-work.md) | Picking up unfinished work: open bugs, unverified features, loose branches. |
| `INTERNAL-access-and-infrastructure.md` | You need a hostname, an account, or to know who to ask. Not for the public repo. |

Older material that is still useful: `docs/superpowers/specs/` (one design document per
feature, mostly Dutch) and `docs/superpowers/plans/` (the implementation plans). The
`CHANGELOG.md` at the root is written for end users and doubles as a feature history.


## The system on one page

```
 ┌─────────────────────────── a colleague's PC ───────────────────────────┐
 │  Gmail Desktop (Electron)                                              │
 │   ├─ Next.js shell: tab bar, settings, copy picker, toasts             │
 │   ├─ one Chromium view per mailbox × Google app, real mail.google.com  │
 │   │    └─ preload script: unread count, notifications, drag strip      │
 │   └─ main process: accounts, OAuth tokens, Gmail API, copy engine      │
 └───────┬───────────────────────────────┬────────────────────────────────┘
         │ Gmail API (own token)          │ "give me a token for support@"
         ▼                                ▼
   Google Workspace               relay (Docker, company server)
   abovomaxlead.nl                 ├─ checks the caller's token and Google's delegate list
         ▲                         └─ mints a token with a domain-wide delegation key
         │                                │
         └──────── Google Cloud project app-gmail-desktop ────────┘
                   (OAuth client, service accounts)

 GitHub Abovomaxlead/gmail-desktop ── release workflow ──► installer + auto-update feed
```

Three things outside this repository keep the app alive, and each is a single point of
failure described in the risk register:

1. **The Google Cloud project `app-gmail-desktop`** holds the OAuth client every installed
   copy is tied to. Replace it and every user has to re-link every account.
2. **The relay** (separate repository `gmail-push-relay`, on Bitbucket) is the only way to
   reach delegated mailboxes. Down means no notifications from and no copying into
   `support@`-style mailboxes; own accounts keep working.
3. **The GitHub repository and its `GOOGLE_OAUTH_JSON` secret** produce every release and
   serve every auto-update. A release built without that secret cannot link accounts.


## Do these first

Ranked by how much they hurt if left. Details and the reasoning are in
[05-open-work.md](05-open-work.md) and [04-risk-register.md](04-risk-register.md).

1. **Put the relay secrets in a vault.** Its `.env` and both service-account keys exist only
   on the server it runs on. Losing that machine means re-issuing keys through the only
   owner of the Google Cloud project.
2. **Give the Google Cloud project and the old GitHub repository a second owner.** Both
   currently have exactly one person who can change them.
3. **Look at the uncommitted crash-report work** on the developer's machine (05 §1). It is
   not in git yet.
4. **Know where feedback goes.** Every feedback mail and every automatic crash report goes to
   the developer's own address, hard-coded in `electron/feedback/feedback-mail.ts`. The owner
   accepted that for now (2026-10-01). If he is away for longer, set a forward on that mailbox,
   or change the address and release.

Done on 2026-10-01: `feature/tab-windows`, which the newest release was tagged on, is merged
into `dev` and `master`, so a release from `dev` no longer takes features away.


## Who to ask

Roles only here; names and addresses are in the internal file.

| Area | Role |
|---|---|
| The app, the relay code, everything in these documents | Original developer |
| Google Cloud project `app-gmail-desktop` (OAuth client, IAM, service accounts) | Its sole owner (named in the internal file) |
| Workspace Admin console (domain-wide delegation, admin accounts) | Workspace administrator |
| Relay image pipeline, Azure container registry | The colleague who built the Bitbucket pipeline |
| GitHub organisation `Abovomaxlead` | Organisation admin |
| Company server the relay runs on, its Traefik and TLS certificate | Server/infra administrator |
