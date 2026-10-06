# Tier 2 restructuring — T2-1, T2-2 and T2-3 step 1 done; the rest left as is

Status: **T2-1, T2-2 and T2-3 step 1 are done.** T2-3 step 2 and T2-4 through T2-7 are
deliberately left as they are, by the owner's decision of 2026-10-06.
They are what the structural audit of 2026-10-06 proposed after Tier 1 (dead code, small
duplications, misplaced modules) was finished in commits `353935d`, `0652197`, `c819698` and
`8d5d6d4`.

Every item is behaviour-preserving restructuring: same IPC, same log lines, same files on
disk. Line numbers for the items still to do are for `dev` at `8d5d6d4` and drift; function
names do not.

Order of risk, highest first: T2-1 (done), T2-4, T2-2, T2-3, T2-5, T2-6, T2-7. Each remaining
item stands alone and can be approved, deferred or dropped on its own.


## T2-1. Split `electron/mail/mail-drop-controller.ts` (4,485 lines) — done

**Landed** in commits `c4b8584..085032b`. The prerequisite (untangling `copyToMailboxes` from
the job driver's own bookkeeping) and the module split both happened as planned, with one
correction found while doing it: the final layout has no separate `mail-drop-controller.ts`
and no `job/job-retry.ts`. What was left of the controller after every other job moved out
*was* the job driver, so it became `job/job-driver.ts` outright — hook wiring included —
rather than staying behind as a thin wrapper around it. `retryFailedJob` stayed in
`job/job-driver.ts` too, rather than moving to its own file as first proposed, because it
shares the job's offer state (`lastJobFailures`, `pendingJob`) with `advanceJob` and
`decideJobRun`.

**Original problem**, for the record: one file carried six separate jobs. Their module state
was declared as one block (about lines 282-417), plus three variables declared far from it:
`existingScan` (~1785), `pendingOrphans` (~3858) and `pendingJob` (~3864). The `// Helper
functions` tail (4061-end) mixed helpers for every one of the six jobs. `copyToMailboxes`
(2833-3520, ~690 lines) did seven things at once: re-entrancy guards, tree planning, the
duplicate check and confirm, recording job choices, creating marker labels, the upload loop
with its journal/sweep/warnings tail, and finally job bookkeeping plus `void advanceJob()` to
drive the next batch. `walkJob` (2656) called `copyToMailboxes`, whose tail called
`advanceJob` again; that mutual recursion is why `advanceJob` needed its own re-entrancy
guard. The fix: `runCopyToMailboxes` returns its result and knows nothing about jobs;
`copyToMailboxes` — now the job-aware wrapper in `job/job-driver.ts` — does the batch-state
bookkeeping and decides the next batch itself, using what the copy returned. The picker's own
Kopieer button and plain IPC copies never touched job state and keep not touching it.

**Final module list:**

| Module | Holds | State it owns |
|---|---|---|
| `drop-state.ts` | shared drag state | `dropSerial`, `copiedSerial`, `lastDropSaved`, `lastDropSource`, `lastDropTree`, `lastDropPreview`, `activePull`, `pullDone`, `batchPullFailedThreads` |
| `pull/pull-collect.ts` | `saveOneThread`, `saveLabel`, `collectLabelThreads`, `writeCollected`, `listLabelTree`, `fetchThreadSlice` | none — pure over `gmail-api` + `drop-state.ts` |
| `pull/pull-controller.ts` | `handleMailDrop`, `planJob`, `withPullLock`, `pullMailDrop`, `cancelMailDropPull`, preview helpers (`dropPreviewItems`, `openDropPreview`, `closeDropPreview`, `showJobReport`, `jobReportPayload`), `mailDropFolder`, the `JobDriverHooks` interface and registry | `lastPullFailures`, the `hooks: JobDriverHooks` registry |
| `pull/pull-retry.ts` | `retryFailedPull` | none — reads/writes state in `drop-state.ts` and `pull-controller.ts` |
| `copy/duplicate-scan.ts` | `findDuplicates`, `labelsForMailboxes`, `labelsForCopyTargets`, `labelsForEveryMailbox`, `existingSnapshot`, `startExistingScan`, `existingForCopyTargets` | `lastScan`, `lastExisting`, `existingScan` |
| `copy/tree-setup.ts` | `planTrees`, `createTreeLabels`, the `TreePlanning` type | none — pure over `gmail-api` + `label-tree` |
| `copy/upload.ts` | `CopyOutcome`, `copyToMailbox`, `copyOneFile` | none — everything arrives as arguments (plus `messageIndex`) |
| `copy/copy-run.ts` | `runCopyToMailboxes` (the engine, ≈1,040 lines), `controlCopyRun`, `sweepRunMarkers`, the `CopyJobHooks` interface | `activeRun`, the `jobHooks: CopyJobHooks` registry, `COPY_IN_FLIGHT` |
| `copy/copy-retry.ts` | `retryFailedCopy`, the `CopyEntryPoint` registry | `lastCopyFailures`, `lastRunFailures`, `retryInFlight`, `copyEntry` |
| `copy/orphan-runs.ts` | `resumeOrphanedCopyRuns`, `pendingOrphanDecision`, `decideOrphanRun`, the `OrphanJobHooks` registry | `pendingOrphans`, the `jobHooks: OrphanJobHooks` registry |
| `job/job-guard.ts` | `JobEndInfo`, `JobPlanRef`, `sameJobPlan`, `pullRefusal` | none |
| `job/job-driver.ts` | `copyToMailboxes` (the job-aware entry, ≈1,140 lines), `advanceJob`, `walkJob`, `stopWalkedJob`, `retryFailedJob`, `pendingJobDecision`, `decideJobRun`, plus the hook wiring (`setJobDriverHooks`, `setCopyJobHooks`, `setOrphanJobHooks`, `setCopyEntryPoint`) at the bottom | `activeJob`, `rollbackWholeJob`, `jobStopWanted`, `jobDriving`, `jobFailures`/`jobFailuresFor`/`jobFailuresPartial`, `jobOfferToast`, `lastJobFailures`, `lastJobEnd`, `pendingJob` |

`ipc-handlers.ts` and `main.ts` now import `handleMailDrop`/`planJob`/`pullMailDrop`/
`cancelMailDropPull`/`mailDropFolder` straight from `pull/pull-controller.ts`, and
`copyToMailboxes`/`retryFailedJob`/`decideJobRun`/`pendingJobDecision` straight from
`job/job-driver.ts`; there is no wiring-only file left to import from instead.

**Cycle risk**, as predicted: pull ↔ job driver (`planJob` ends a stale job; `walkJob` pulls)
and job driver ↔ copy/orphan state all cross through the setter registries above
(`setJobDriverHooks` in `pull-controller.ts`, `setCopyJobHooks` in `copy-run.ts`,
`setOrphanJobHooks` in `orphan-runs.ts`, `setCopyEntryPoint` in `copy-retry.ts`) — the
project's existing hook convention — so no module imports the one that drives it. Checked
with `node scripts/cycles.mjs`.

**Still oversized.** `job/job-driver.ts` (≈1,140 lines) and `copy/copy-run.ts` (≈1,040 lines)
are the two files left above the ~900-line target this split was aiming for. Both are now a
single job apiece rather than six, so a further split is a later, separate decision, not a
leftover of this one.

**Verified with.** The controller harness tests (`tests/maildrop-*.test.ts`,
`tests/support/controller-harness.ts`), which drive the real code against a fake Gmail, plus
one real label drag of more than 2,000 conversations (a batched job) and pause/stop/rollback
by hand.


## T2-2. Split `electron/windows/profile-view-manager.ts` (1,288 lines)

**Done** in `573ee19`. `windows/mail-thread-navigator.ts` (≈355 lines) and
`windows/mail-view-messages.ts` (≈117) are small classes the manager owns; the manager drops
to ≈1,016 lines. The manager keeps its public methods (`openMailThread`, `popOutThread`,
`sendDropLock`, …) as one-line forwards to them, so no caller changed: the view-manager tests
call those methods on the manager directly.

**Problem.** The class owns view lifecycle and window hosting. It also holds two concerns
that only need `this.views`:

- **Opening a specific Gmail thread and popping it out**, from `openMailThread` (831) to about
  line 1094: `claimMailView`, `anchorMailMessage`, `anchorPopout`, `openMailSearch`,
  `popOutThread`, `readHash`, `restoreHash`, `clickPopoutButton`, and the
  `anchorRun`/`popoutExpectUntil` state.
- **Sending state into the mail views**, from `pushNotifyAllowed` (1097) to about 1270:
  `pushMailDropAllowed`, `sendDropResult`, `sendDropLock`, `sendDropProgress`,
  `sendToMailViews`.

**Change.** Move the first into `windows/mail-thread-navigator.ts` and the second into
`windows/mail-view-messages.ts`. Each takes one dependency, a lookup from account key to
`WebContents`. Callers (`toast-activation.ts`, `mail/pull/pull-controller.ts`, `mail/job/job-driver.ts`, `notify-gating.ts`)
call the new modules or keep calling thin delegating methods. Decide which during the change;
prefer direct calls with no delegators left behind.

**Verification.** `tests/notify-open-thread.test.ts`, `tests/popout-thread.test.ts`,
`tests/notify-delivery.test.ts`, `tests/profile-view-manager.test.ts`. By hand: click a
notification and confirm it opens the right message, then pop that message out.


## T2-3. Split `renderer/app/maildrop/page.tsx` (1,855 lines)

**Step 1 done** in `8f9472e`: the 16 components are in `maildrop/report-parts.tsx` (≈936
lines), `page.tsx` is ≈959. Step 2 (the `useMailDropCopy` hook) is not planned.

**Problem.** `MailDropModalPage` (177-~995) has 20 `useState` hooks, the preview, label and
existing-scan effects, the whole copy/retry/job/orphan state machine (`copy`, `retryCopy`,
`retryJobCall`, `retryJob`, `copyFresh`, `retryPull`, `controlCopy`, `decideOrphan`,
`decideJob`), and JSX that branches on `phase.kind`. Lines 1000-1855 are 16 presentational
components that only take props: `RailPlaceholder`, `LabelSearch`, `Status`, `DropFailure`,
`ExistingWarning`, `DuplicateWarning`, `StopConfirm`, `OrphanDecision`, `JobDecision`,
`StoppedReport`, `WarningsList`, `JobRunning`, `JobReport`, `CopyReport`, `FailureList`,
`PullMisses`.

**Change.**
1. Move the 16 components to `maildrop/report-parts.tsx`, the same way `panel-parts.tsx` is
   already split out. Mechanical; no behaviour involved.
2. Second, optional: move the copy/retry/job state machine into a `useMailDropCopy` hook.

**Verification.** Renderer type check and build. By hand, open the picker after a drag and walk
through: duplicate warning, copy report, stop dialog, job report.


## T2-4. Pull the decision logic out of `installDropzone` in `electron/preload.ts`

**Problem.** `installDropzone` (348-~712) is 360 lines with no unit test. It builds the strip's
DOM, a MutationObserver, mouse and key listeners, and also a small state machine: `saving`,
`locked`, `mine`, `pullDone`, `cancelSentAt`, `CANCEL_GRACE_MS`. That machine decides which
text the strip shows and when the cancel button comes back. Every other piece of decision
logic in this file sits in tested pure functions in `mail/dropzone.ts` (`resultText`,
`resultState`, `savingText`, `cancelledText`, `isOverZone`, `movedEnough`).

**Change.** Move the decisions (what to show for a given saving/locked/mine/pullDone/
cancelSentAt/now, and when cancel may reappear) into pure functions in `mail/dropzone.ts`,
with tests in `tests/dropzone.test.ts`. `installDropzone` keeps only the DOM and event wiring.

**Risk.** This code runs inside Gmail's page with `contextIsolation: false` and was tuned
against Gmail's real DOM. Verify by hand: drag a mail, drag a label, cancel during a pull, and
check the strip while another view holds the drop lock.


## T2-5. One shared Electron fake for the tests

**Problem.** Seven test files each define their own fake `WebContents`/`WebContentsView`
(or `BrowserWindow`): `notify-delivery`, `notify-open-thread`, `popout-thread`,
`profile-view-manager`, `toast-window-repair`, `oauth-flow`, `overlay-view`. Each has a
handlers map, a record of what was sent, `send`/`on` and a `visible` flag.

**Change.** One `tests/support/fake-electron.ts`, with options for the small per-test
differences (initial hash, which handlers fire), used by all seven. Several of these fakes
are created inside `vi.hoisted`, so check the shared one can be imported there.


## T2-6. `electron/delegation/delegated-controller.ts` (689 lines) — lower value

Five jobs in one file: loading profiles (93-125), reading and refreshing URLs from the
account switcher (141-257), the health watch and repair loop (289-453), the relay membership
sweep (465-505, 566-634), and add/discover/remove (507-563, 636-689). The file's own header
argues that URL refresh and the health watch belong together because they share
`repairsFor`/`rereadAt`/`repairedAt`/`sentHomeFor`. Splitting them first means passing that
state explicitly. Recommendation: **leave it unless it grows**. If it is split, it becomes
`delegated-url-refresh.ts` plus `delegated-health-watch.ts`, and this file keeps loading,
the sweep and add/remove.


## T2-7. Topbar icons — cosmetic

`renderer/app/Topbar.tsx` 463-494: `PlusIcon`, `ChevronsIcon`, `FeedbackIcon`, `GearIcon`
are props-only SVG components at the bottom of the stateful `Topbar` file. Move them to
`app-icons.tsx`, beside the other icons.


## Smaller follow-ups noted during the audit (not structural, not done)

- `registerIpc()` in `electron/core/ipc-handlers.ts` is one function of about 450 lines over
  roughly 80 channels. Add section comments (tabs, accounts, settings, mail drop, OAuth, …)
  so it is easier to navigate; splitting the table is not proposed.
- `mail-copy.ts`: `countExisting` and `groupDuplicates` repeat the same group-by-(email,
  labelId)-and-count loop. Two short, tested call sites, so this is low value.
- `mail-copy.ts` `CopyOutcomeTally` mirrors the controller's local `CopyOutcome` by hand to
  avoid an import cycle. If T2-1 moves `CopyOutcome` into a module `mail-copy.ts` can import
  without a cycle, the mirror can go.


## How to run it

Each item is its own branch and commit. After each item: `npx tsc -p tsconfig.json`,
`npx tsc -p renderer/tsconfig.json --noEmit --incremental false`, `node scripts/cycles.mjs`,
`npm test`, `npm run build`, then the hand checks listed under the item.
