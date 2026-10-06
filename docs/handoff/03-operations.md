# Operations

Everything you do with your hands: set up a machine, run it, test it, release it, redeploy
the relay, and read the logs when a colleague says "it doesn't work".


## 1. A development machine from zero (Windows)

1. Install **Node 22, at least 22.12** — Electron 44's own install scripts and electron-builder
   need it. (The original workstation runs 22.0.0, below the floor; do not copy that.) Install
   Git for Windows.
2. Clone and switch to `dev`. `master` is stale and only exists as GitHub's default branch.
   ```bash
   git clone https://github.com/Abovomaxlead/gmail-desktop.git
   cd gmail-desktop
   git checkout dev
   ```
3. Install both packages. The root and `renderer/` have separate lockfiles.
   ```bash
   npm ci
   npm ci --prefix renderer
   ```
4. **Get the OAuth config.** It is not in git. Pick one route:
   - Copy `%APPDATA%\gmail-desktop\google-oauth.json` from a working machine over a private
     channel.
   - Extract it from an installed release: `resources\app.asar` contains
     `assets/oauth-defaults.json`.
   - Download the client JSON from Google Cloud project `app-gmail-desktop`
     (Credentials → the Desktop client), then use Settings → Accounts → "Set up connection…".
     That screen also accepts Google's own downloaded `client_secret_*.json`.

   **Never create a new OAuth client.** That unlinks every user; see risk R1.
   The `GOOGLE_OAUTH_JSON` GitHub secret cannot be read back.
5. Run the app: `npm run dev`. This starts the Next dev server, watches the Electron bundles
   and launches Electron.
   - A change in `renderer/` hot-reloads.
   - A change in `preload.ts` reloads the Gmail views.
   - A change in main restarts Electron.
6. Run the tests: `npm test`. They are plain Node and safe to run while dev runs.
   Typecheck with `npx tsc -p tsconfig.json`; the renderer is checked by its own build.

### The four traps that look like bugs

| You see | It actually is | Do |
|---|---|---|
| `npm run dev` / `electron .` exits immediately, code 0, no output | The **installed** app holds the single-instance lock. Dev and installed share userData. | Quit the installed app from the tray, or test with `npx electron . --user-data-dir=%TEMP%\gd-test`. |
| Dev serves 404 for `/toasts`; notifications fall back to Windows' own; `EPERM` on `renderer/.next/trace` | A production build ran while dev was running; both use `renderer/.next` | Stop everything, check for leftover `node` processes on port 3000, `rm -rf renderer/.next`, restart dev. **Never build while dev runs.** |
| Every route 404s after restarting dev | The old Next dev server survived the restart | Kill the stray `node` processes, wipe `.next`, start again |
| `renderer/next-env.d.ts` is always modified | `next dev` and `next build` write different paths | `git checkout renderer/next-env.d.ts`; the build variant is committed |

To build an installer while dev runs, use a detached worktree:

1. Create the worktree: `git worktree add --detach .claude/worktrees/build dev`.
2. In PowerShell, junction `node_modules` and `renderer/node_modules` to the main checkout.
3. Run `npm run bundle:oauth-config`, then `npm run build` and
   `npx electron-builder --win nsis --publish never`.

Remove the junctions before you delete the worktree.

### Scripts

| Script | Use it to |
|---|---|
| `npm run dev` (`scripts/dev.mjs`) | Run the app in development. |
| `npm run bundle:oauth-config` | Copy your userData OAuth config into `assets/` before a local `npm run dist`. It refuses a different project without `--force`. |
| `npm run check:oauth` | Check the bundled config. It runs automatically before every build. |
| `npm run dist` | Make a local, unsigned installer in `dist/`. |
| `node scripts/release-notes.mjs <version>` | Preview the release notes taken from `CHANGELOG.md`. |
| `node scripts/check-dwd.mjs <key.json> <mailbox>` | Find out why a delegated mailbox gives `unauthorized_client`: a missing grant, a wrong scope list, or propagation delay. |
| `node scripts/check-directory.mjs`, `check-delegates-raw.mjs`, `check-directory-id.mjs` | Debug delegated discovery. These need a service-account key. |
| `node scripts/check-google-setup.mjs` | Show which Google Cloud project each key or client belongs to. |
| `node scripts/cycles.mjs` | Check for import cycles after a refactor. |

`build.cmd`, `rel.cmd`, `pack.cmd` and `run-dev.sh` are older helpers. `rel.cmd` does **not**
publish. The `*.log` files in the root are leftovers and are ignored by git.


## 2. Releasing a version

The release workflow builds and publishes **Windows only**. It runs when a `v*` tag is pushed.

1. **Make sure the branch is green.** Run `npm test`. CI does **not** run the tests.
2. **Bump the version.**
   ```bash
   npm version 1.0.0-beta.$(date +%s) --no-git-tag-version
   git commit -am "chore: release 1.0.0-beta.<n>"
   ```
   For a stable release, use a version without a suffix, such as `1.0.0`. It becomes
   GitHub's "Latest" and is offered to everyone.

   **Once a stable version is out, a beta must carry the next number.** Semver ranks
   `1.0.0-beta.<n>` *below* `1.0.0`, so after 1.0.0 that beta is never offered to anyone.
   Betas towards the next version are `1.1.0-beta.$(date +%s)` (or `1.0.1-beta.…` for a fix
   release), and the stable that follows them is `1.1.0`.
3. **Write the changelog section by hand** at the top of `CHANGELOG.md`, headed exactly
   `## [1.0.0-beta.<n>] — YYYY-MM-DD`. It is written for end users. It becomes the GitHub
   release notes and the in-app "what's new" panel. A wrong heading silently drops both.
   Commit it as `docs: changelog for <version>`.
4. **Tag and push.** Tag on the branch that has *all* the released work. Check with
   `git log --oneline dev..v<last-release>`: it must print nothing (risk R12).
   ```bash
   git tag v1.0.0-beta.<n>
   git push origin dev
   git push origin v1.0.0-beta.<n>
   ```
5. **Watch the run:** `gh run list -R Abovomaxlead/gmail-desktop`. It takes about 2 minutes. The
   workflow:
   1. writes the OAuth config from `GOOGLE_OAUTH_JSON`;
   2. **refuses to continue** if that config is missing or names the wrong project;
   3. creates the release, as a prerelease when the version has a `-`;
   4. builds and uploads the installer, its blockmap and `latest.yml`.
6. **Check the result.** `gh release view v<version> -R Abovomaxlead/gmail-desktop` should list
   those three assets. The file size proves nothing about the config inside. To be sure, unpack
   the exe, open `resources/app.asar` and check `assets/oauth-defaults.json`.

**How users get it.** An installed app checks at start and every 30 minutes. It downloads
when the user clicks, and installs on quit. Betas reach only users on the beta channel.
Installs are unsigned, so Windows SmartScreen asks once; see risk R11.

**Test builds without publishing.** In Actions, run **Build (no publish)** (`build.yml`) for
Windows or **Build macOS (no publish)** (`build-mac.yml`) for a Mac. Both produce a download
artifact instead of a release. The mac build is unsigned and comes with an `OPEN-ME-FIRST.txt`
explaining the Gatekeeper warning. It is also the only way to get a mac build at all, because
electron-builder refuses to build for macOS on Windows.

### The old repository and the bridge

Installs older than 1.0.0 ask `lucamanuel-art/gmail-desktop` for updates. One *bridge*
release there (`v1.0.0-beta.1787829939`) moves them to the organisation repository for good.
**Do not delete, archive or empty that repository.**

If a second bridge is ever needed, follow the steps in this order. Each one avoids a trap
that has already been hit:

1. Publish on the organisation repository first.
2. Disable the old repository's release workflow. Otherwise pushing a tag there rebuilds the
   old code over your assets.
3. Push the tag onto a **freshly dated empty commit**, not onto `master`. The feed is ordered
   by commit date.
4. Run `gh release create` there with the organisation's assets.
5. Re-enable the workflow.

Stable installs on 0.3.0 only ever read "latest", so they need a *full* release, not a
prerelease.


## 3. The relay

Source: Bitbucket `abovomedia_internet/gmail-push-relay`. It is the only live copy; the old
GitHub remote no longer exists. The production host, its paths and the people with access are
in the internal file.

- **Build.** A push to `main` that touches the code builds the image, scans it with Trivy
  and pushes `:latest` and `:<commit>` to the Azure container registry. A push that only
  changes docs is skipped, and still shows green. The manual pipeline **`rebuild-relay`**
  forces a build. Trivy fails the build on any fixable HIGH or CRITICAL vulnerability, so a new
  upstream CVE alone can block a deploy.
- **Deploy**, on the host, in the relay folder:
  ```bash
  az acr login --name <registry>          # or docker login
  docker compose pull relay
  docker compose up -d                    # also required after any .env change
  docker compose logs -f relay
  curl https://<relay-domain>/healthz     # → ok
  ```
  A healthy start prints:
  - the port and `1 allowed domain(s)`;
  - `tokens must be minted for <client id>`;
  - `delegated mailboxes enabled via <service account>`;
  - `delegated discovery over the domain, as <admin>`.
- **Roll back.** Set `RELAY_TAG=<previous commit sha>` in `.env`, then `pull` and `up -d` again.
- **Tests.** In the tooling container, run `docker exec gmail-push-relay-node-1 npm test`. WSL
  has no Node of its own.


## 4. Diagnosing a colleague's problem

1. **Get the logs.** Ask them to send feedback with diagnostics on (Settings → Feedback). The
   redacted tail of `notify.log` and `update.log` arrives in the mail. For more, have them
   zip `%APPDATA%\gmail-desktop\notify.log` and the drop folder's `log.jsonl`.
2. **Know which build they run.** Tags are not a record of what is installed. Read the
   version from their About screen, or grep it out of the installed `app.asar`:
   ```bash
   A="$LOCALAPPDATA/Programs/gmail-desktop/resources/app.asar"
   grep -aoE '"version"[[:space:]]*:[[:space:]]*"[0-9][^"]*"' "$A" | head -1
   ```
3. **Mind the clocks.** `notify.log` is in **UTC**. File times in the drop folder are local
   time, which is UTC+1 or UTC+2. Comparing the two raw invents failures that never happened.
4. Each launch starts with `--- app start, <version> ---`. Search from the last one.

### Log lines that answer the question

| Question | Grep `notify.log` for |
|---|---|
| Does Gmail raise notifications in this view? | `notification shim installed` should be followed by `Gmail raised a notification`. |
| Is a delegated mailbox silent because of the relay? | `delegated mailbox … could not be read`, `Relay niet bereikbaar`, `no relay configured` |
| Was a delegated mailbox rotated or revoked? | `switcher geeft dezelfde url voor …; niets vervangen`. If you see this, the delegation itself is gone. |
| Are we being throttled by Gmail? | `[quota]`. A *persistent* lower ceiling means Google moved the project to the new quota table; see risk R6. |
| Did batching break? | `batch failed, falling back one by one`, `batch answered nothing usable` |
| Why did a drag do nothing? | `second drag refused`, `drag refused: a job is already copying`, `could not be listed over the API` |
| Did a copy finish or get stuck? | `copy done: X copied, Y skipped`, `sweep of run … not complete yet, will be resumed`, `journal could not be started` |
| Did a notification click open the right mail? | `message … on screen:` followed by `shown`, `opened`, `stuck`, `hidden` or `missing` |
| Are custom notifications failing? | `[toast] page reported no size`, `giving up on the stack` |
| Did the token file survive? | `sealed elsewhere`, `unopenable` |

Every one of these is a literal `notifyLog(...)` string, so `git grep` on the text finds the
code that wrote it. Most mail-drop lines come from `electron/mail/mail-drop-controller.ts`.
