# Retrying the mail a batched job lost

Part 2 of `2026-10-02-maildrop-failure-retry-design.md`. Part 1 names failed mail and retries it
for ordinary drags; a batched label job only says `…, N mislukt` at its end. This adds the retry
button there.

## What is wanted

Decided with the owner on 2026-10-02:

- Offered only when a job ends **completed** with losses. A job the user stopped, or one stuck on a
  failed batch, gets no offer (the stuck one keeps its own continue/keep/undo offer at start).
- **One button**, `Mislukte opnieuw proberen`, that first fetches the conversations no batch could
  fetch, then copies everything that did not land into **the job's own mailboxes and labels**.
- Shown under the job's closing line when the panel is open. When it is closed, a **toast**
  `Klus klaar — 1980 van 2000 gekopieerd, 20 mislukt` says so; clicking it opens the panel on that
  closing line with the button. The panel never opens on the picker for this.
- The offer lives in memory until the app closes or a new drag starts (same as part 1).
- What fails again is offered again, for only that remainder.
- More than `JOB_BATCH_THREADS` (2000) unfetched conversations: the first 2000 are fetched per press,
  the rest stay in the offer.
- Nothing about which mail is saved, which labels it gets, or where files are written changes.

## Design

### Gathering, per batch

A module-level `jobFailures` belongs to the job being walked (keyed by `jobId`, reset when a job
starts). After each batch's copy — batch 0's from the picker as well as the driver's — the copy's
`failuresByTarget` is merged into it per mailbox. After each batch's pull, the conversations that
could not be fetched are added with their `TreeThread` (labels included, so a later fetch files them
in the same tree). `walkJob` today passes `threads: []` to `rememberPullFailures`; it passes the real
threads instead. Nothing is shown or retried between batches.

The merge rules live in a pure module `electron/mail/job-failures.ts`: copy failures merge per
mailbox email, a file appears once per mailbox; pull failures merge by `threadId`.

### The offer at the end

When `walkJob` ends a job `completed` and `jobFailures` is non-empty, it becomes `lastJobFailures`:
`{ retryId, serial: dropSerial, jobId, account, label, targets: job.choices.targets, copy, pull }`.
`JobEndInfo` (and the renderer's `JobEnd`) gain `retryId?`. Any other ending discards `jobFailures`.
A new pull clears `lastJobFailures` as it clears the part-1 offers.

With an offer, `walkJob` also raises a toast of a new kind `'maildrop'` with the closing line as its
title and `Klik om het opnieuw te proberen` as body, persistent. Activating it calls
`showJobReport()` in the controller, which opens the overlay with a payload carrying `jobEnd` (the
same `JobEndInfo` the panel got) and no picker data. `dropPreviewItems()` returns `jobEnd` too while
an offer is held, so a reopened panel lands on the report. The panel treats a payload with `jobEnd`
exactly like a job end on the progress channel (`phaseFromJobEnd`), never as a drag to pick for.

### The retry

`MAIL_DROP_JOB_RETRY { retryId, mode }` → `retryFailedJob`. Refused by `retryRefusal` on the same
conditions as part 1 (stale id, moved serial, job driving or held, pull running, copy running or a
retry in flight). The IPC handler narrows `mode` to `check | new | all`.

**Step A — fetch (mode `check` only).** When `pull` is non-empty, under `withPullLock`: take up to
`JOB_BATCH_THREADS` threads, `fetchThreadSlice(account, slice)`, `writeCollected(ts, account, root,
label, fetched, [])`. Every new `SavedRef` is added to the copy set of **every** job target (that
mail landed nowhere). Threads that failed again stay in `pull`; the untaken rest stays too. A stale
check after the lock (serial and offer unchanged) applies as in part 1.

**Step B — copy.** `copyToMailboxes({ retry: { targets, files, retryId }, mode, jobRetry: true })`,
targets limited to those with files. `jobRetry` means: do not hold `lastCopyFailures` — instead the
caller rebuilds `lastJobFailures` from the run's `failuresByTarget` plus the remaining `pull`, with a
fresh `retryId` (or null when nothing is left). The result gains `retryId` (the job offer's) and
`unfetched?: FailureLine[]` for conversations still not fetched. On a confirm-screen follow-up (`new`
/ `all`) step A is skipped.

Everything else is the part-1 retry path: per-target files, the retry's own scan key, fresh
duplicate check, journal, marker, pause/stop/rollback, `retryInFlight`.

### The panel

- `JobReport` shows `Mislukte opnieuw proberen` when `end.retryId` is set. Pressing it runs the copy
  runner with `retryMailDropJob(retryId, mode)`; a panel-side `retryKind: 'copy' | 'job'` routes the
  confirm screen's buttons and the next retry press to the right bridge call.
- The result is the ordinary `CopyReport`, plus a red block above it listing `unfetched` with
  `N gesprekken nog steeds niet opgehaald`.
- Annuleren on a retry's confirm screen returns to the report it came from (the job report for the
  first press), as in part 1.
- A payload with `jobEnd` (toast click, reopen) sets the job-report phase; it never enters `picking`.

## Testing

Unit: `job-failures.ts` merge rules, the 2000 slice, the count; `retryRefusal` reused. Typecheck both
projects; full suite green. Controller and panel have no harness (as in part 1).

Live, against the scratch label, a job of more than 2000 conversations with the network cut during
batch 2: the closing line in amber with `N mislukt`, the toast with the panel closed, the toast
opening the panel on the report, the button landing the mail once in the job's labels.

## Out of scope

- Keeping the offer across an app restart.
- Offers for stopped or stuck jobs.
