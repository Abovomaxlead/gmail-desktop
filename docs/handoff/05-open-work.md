# Open work

The state of things on 2026-10-01: what is unfinished, unverified or simply lying around.
Tidy section 1 first, because it can lose work. The rest is a backlog.


## 1. Repository state, tidy this first

| What | Where | Do |
|---|---|---|
| Uncommitted work | `electron/feedback/crash-controller.ts`, `crash-report.ts`, `electron/preload.ts`, `tests/crash-report.test.ts` (about 140 lines, crash reporting), on the developer's machine only | Ask the developer, or review it, run the tests and commit. `renderer/next-env.d.ts` is only the dev/build flip; restore it. |
| Untracked script | `scripts/check-rooms.mjs`, which diagnoses calendar room addresses and bookings | Commit it if it is still wanted. |
| Unmerged feature | `origin/feature/beta-access-gate`: one commit beyond what is merged, `667b6c0`, "the relay decides who is offered betas", by Google-group membership. | **The relay side does not exist**: no such route is in the relay repository. The app treats "endpoint not deployed" as "no change", so merging is harmless, but the feature does nothing until the relay gets the route and the config gets `betaAccessUrl`. |
| `master` | Brought level with `dev` on 2026-10-01, `feature/tab-windows` included | `dev` stays the working branch. Merge it into `master` when you want GitHub's default branch to show the current state. |
| Local worktrees | `.claude/worktrees/big-label-batching`, `default-mail-client`, `eager-account-load` | Merged or abandoned. **Their `node_modules` are junctions into the main checkout:** remove the junctions first (PowerShell `[System.IO.Directory]::Delete(path, $false)`), then `git worktree remove`. |
| Branches on the old remote | `old/docs/delegated-api` and a few `old/worktree-*` | Historical; nothing to recover. |

The relay repository is clean: `main` equals Bitbucket. Its old GitHub remote
(`lucamanuel-art/gmail-notifications-relay`) no longer exists, so remove that remote.


## 2. Built and unit-tested, not formally verified against a real mailbox

All of this runs in daily use, so parts have demonstrably worked in practice. For example,
large label copies into `support@` ran on 2026-08-26, and the 717-duplicates incident was one
of them. But none of the items below has had a deliberate acceptance run that checks the
specific behaviour. The developer's notes list what each check should look for. Use the
scratch label `test` / `test/test123` in the developer's own mailbox. It looks like real client
mail but is a test fixture; confirm *which mailbox* before deleting from it, not whether the mail
matters.

| Feature | What a live check must show |
|---|---|
| Pause / stop / rollback with marker labels | Stop-and-undo trashes exactly what the run inserted. Kill the app mid-copy: the next start **offers** the run rather than silently resuming it. |
| Big label as a batched job (> 2,000 conversations) | The plan line names the batch count before any mail is pulled. `Batch 1 van 2`, then `Batch 2 van 2`. Two `.rollback.jsonl` files plus one `.job.jsonl` that ends in `done`. |
| Label-tree copy | The shape is recreated in the target. A conversation in two labels lands once, with both. An empty sublabel is created. A rollback deletes the created labels and leaves a reused one alone. |
| A copy into **two** mailboxes, and over conversations with several messages | Every run so far was one mailbox and one message per conversation. In that shape two code paths were the identity and never actually ran. |
| HTTP batching | No `batch failed` / `batch answered nothing usable` lines in `notify.log`. |
| Duplicate scan at drop time | The picker's warning matches what is really in the target. |
| Notification click opens the exact message | `message … on screen: shown` or `opened` in `notify.log`. `stuck` means the click did not reach Gmail. |
| Delegated 15-second sweep | Notifications arrive from `support@`. A scope refusal would log `gedelegeerd postvak … kon niet gelezen worden`. One machine had `support@` set to `"notify": false` in `prefs.json`. |
| Sealed tokens (`safeStorage`) in a real installed build | After an update, accounts stay linked, and `google-tokens.json` holds `{"v":1,"enc":"safeStorage",…}`. |
| macOS auto-update (needs the zip) | Never released for mac. Every mac build so far is a manual artifact. |

Label cleanup **was** tested live and works.


## 3. Known bugs

1. **401 while copying into a delegated mailbox cannot recover** (risk R17). Replace
   `forceRefresh` with `freshTokenAfter401` at both call sites in `mail-drop-controller.ts`.
2. **The drop-folder cleanup can delete open journals** (risk R18). This was found in this review
   and is not reproduced.
3. **The updater can install mid-copy** (`installUpdate` does not check for a running copy).
   The journal recovers the copy, but the user gets an unexpected question at the next start.
4. **`dropzone.ts` holds three definitions of "a list row".** Each disagreement has a concrete
   failure shape, but no trigger has been seen live. This was deliberately left alone; look at
   it only if a drag picks the wrong row.
5. **Two copy-panel edge cases**:
   - A late pause can overwrite a genuine stop error.
   - One job can receive two "job ended" events, so the outcome flips on screen.
6. **`dropDisallowedTokens` deletes out-of-domain tokens without revoking them at Google.**


## 4. Decisions waiting for someone

- **Push: retire it or bring it back?** See risk R25. Today the Pub/Sub resources and one key
  exist for nothing.
- **A stable release.** Every release on the organisation repository is a prerelease, so an
  install that is not on the beta channel finds no update at all. Tagging `v1.0.0` without a
  suffix fixes that, once someone decides the current state is "stable".
- **Code signing** (risk R11): budget and owner.
- **Where feedback goes** (risk R15): fine as it is for now, by the owner's decision of
  2026-10-01. Revisit if the developer is away for longer.
- **Tests in CI** (risk R22): one step in `release.yml`.


## 5. Explicitly decided against — do not build

These were built or designed and then rejected on purpose by the product owner. Re-proposing
them needs a new reason, not the old one.

- **Fewer messages per conversation in the mail drop**, or any other change to which mail lands
  where in the name of speed.
- **"Clean up the source label after a copy"** as an automatic step or a second cleanup mode.
  The cleanup stays a manual choice in Settings.
- **Permanent delete** anywhere. Trash only.
- **A log file or attachment with feedback**, or a folder window that opens on send.
- **Using `autoUpdater.channel`** for the beta switch.
- **Narrowing the `rfc822msgid:` OR-query past its tested limit**, or hiding labels the user hid
  themselves in the copy picker. Only the app's own `_gmd-copy-` markers are hidden.
