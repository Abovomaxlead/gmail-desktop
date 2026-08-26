# Copying a label that is too big for one run

## The problem

A copy of 2,574 mails reported `2573 van 2574 gekopieerd` and, beside it, Gmail's own words:
*Quota exceeded for quota metric 'Queries' and limit 'Previous quota: Units per minute per
user'*. One mail short of the whole label, after four minutes of work, with nothing to point
at and nothing to resume.

The size is not the cause. Quota is a rolling meter, not an allowance per run: five batches of
2,000 spend exactly what one run of 10,000 spends. Three separate things in the quota layer
turned a rate into a lost mail.

- **There is no headroom, by construction.** `messages.insert` costs 25 units and
  `UNITS_PER_SECOND = 250` (`electron/gmail/quota.ts:49`) is exactly 15,000 a minute — the
  very limit the error names. The copy paces at 100% of what it is allowed, so it does not
  burst over the line, it drifts over it. Four minutes in is where the drift landed.
- **A refusal cannot be waited out.** `retryWaitMs` (`electron/gmail/retry.ts`) gives an
  insert three attempts spread over about two seconds — `MAX_ATTEMPTS = 3` at line 37, 500ms
  then 1.5s from `BASE_WAIT_MS`, and `MAX_WAIT_MS = 30_000` capping even a Retry-After Gmail
  asked for. A blown *minute* cannot be waited out in two seconds. So the policy exhausts
  itself inside the same window that refused it and hands the caller a failed mail.
- **A refusal is not always recognised.** `GmailHttpError` (`electron/gmail/gmail-api.ts:75`)
  carries a message, a status and a Retry-After. Gmail's own `error.errors[].reason` and
  `error.status` are never read — line 1775 keeps `error.message` and drops the rest. Only a
  literal 429 calls `budget.refused()` (line 1525) or lets an insert retry
  (`RETRIABLE_INSERT_STATUS`, `retry.ts:49`). A 403 carrying `userRateLimitExceeded` is, to
  this code, indistinguishable from a 403 meaning "no access to this mailbox", and is retried
  zero times. Which of the two the live failure was is not recoverable: that run has rotated
  out of `notify.log`.

One thing that was suspected and is **not** wrong: `budget.take()` sits inside the retry loop
(`gmail-api.ts:1518`), so every attempt is priced and booked. The pacing is honest. That is
what makes the first point damning rather than reassuring.

**The API was never the obstacle.** `listLabelThreadIds` (`gmail-api.ts:585`) already pages
`threads.list` with a pageToken, 100 ids a page (`threadsListUrl`, line 548). Ten thousand
threads is 100 pages and 1,000 units — four seconds of budget. The app can know exactly which
conversations it is about to fetch before it fetches one. The 2,000 is ours:
`MAX_THREADS` (`electron/mail/label-drop.ts:39`).

So there are two pieces of work, and the order between them matters more than either:

1. **Survive the ceiling.** Headroom, a refusal that can be waited out, and reading the reason.
   After this a label of 10,000 copies in one go — insert-bound at roughly 19 minutes per
   target mailbox (250,000 units at the paced rate below), plus about 8 to pull it — and it
   does not fail.
2. **Then batch it**, for grip: progress that means something, a stop that does not cost the
   whole label, and a restart that can pick the job up.

Batching is not the quota fix. If it ever gets described that way, this paragraph is the
answer.

## What must not change

- **Which mail lands where.** `maildrop-behaviour-is-settled`. `CopyMode`
  (`electron/mail/mail-copy.ts:50`) keeps its three meanings exactly: `'check'` looks and asks,
  `'new'` skips what the target already holds, `'all'` copies regardless and skips the scan.
  A batch evaluates that policy against **its own** mails, live, the same way a whole drag does
  today. Nothing about duplicates is decided from a plan on disk.
- **A label that fits in one batch.** Its drag, its preview, its `log.jsonl` lines, its folder
  and file names, its copy: byte-for-byte what they are today. The job is a second shape around
  the existing one, never a rewrite of it. A single-batch job must be indistinguishable from no
  job at all.
- **The marker discipline.** Every insert keeps riding out with its run's marker label folded
  into the same POST (`copyToMailboxes`, `mail-drop-controller.ts:1670` onwards). A sweep acts
  only on a `markerLabelId` a journal header recorded, never on one re-derived from a name.
- **The journal's crash-safety.** One line per insert, appended the moment the insert answers;
  a closing line is the only thing that tells a kept run from a crashed one. The job's own file
  is written under the same discipline and never replaces the journal.
- **`MAX_THREADS` still reports when it bites.** It stops applying to the API path (see below),
  but wherever a cap still truncates, the user is still told. Truncating in silence reads as
  "everything saved", which was the original defect and stays fixed. This narrows what the
  label-tree spec (`2026-08-25-label-tree-copy-design.md`) says about the cap bounding a whole
  tree; the reporting requirement it states is unchanged.

## Design

### Part 1 — Pacing that leaves room

`UNITS_PER_SECOND` stays the published figure, because that is what it documents. What changes
is that the budget no longer spends all of it: a `SAFETY` fraction (0.9) is applied where the
cursor is advanced, so the app paces at 225 units a second and leaves a tenth of the minute
unspent. The published number stays the thing `refused()` and `recover()` measure against, so a
move to the new price list is still detected the way `quota.ts` already describes.

**A rolling minute meter was designed here and then cut.** It is worth recording why, because
it looks like the obvious answer to a per-minute limit and it is not. The cursor advances by
`cost / (ceiling * SAFETY)` and never banks idle time (`mine = Math.max(cursor, now)`), so the
spend inside *any* 60-second window is already bounded by the paced rate times sixty — by
construction, not by luck. And since `take()` sits inside the retry loop (`gmail-api.ts:1518`),
there is no unbooked spend left for a meter to catch. It would be a ring buffer and a running
sum earning nothing.

There is one genuine hole, and a meter would not have closed it either. `budgetFor` keys budgets
by access token (`gmail-api.ts:1461`), so **a token refreshed mid-copy starts a fresh budget with
a fresh cursor** while the minute it is entering still carries the old budget's spend on Gmail's
side. The file's own comment already admits this — "at worst lets one window through twice". A
per-token meter is reset by that very same refresh, so it would have measured nothing. Closing it
properly means keying budgets by user instead of by token, which reaches through `requestJson`'s
signature into every call site: out of scope here, and named as a known limitation rather than
quietly left out. Against a 60-minute token a 19-minute copy makes this narrow, and the safety
fraction is what absorbs it when it does happen.

### Part 1 — A refusal is its own kind of error

`GmailHttpError` gains a `reason: string | null`, read at `gmail-api.ts:1775` from
`error.errors[0].reason`, falling back to `error.status` — two different fields Google fills in
two different layers, and either one is enough to recognise a refusal. A new predicate —
`isRateLimit`, living in `retry.ts` beside the policy that consumes it — is true for status 429,
and for status **403** whose reason is one of `rateLimitExceeded`, `userRateLimitExceeded`,
`quotaExceeded` or `RESOURCE_EXHAUSTED`.

Only 403, and only with one of those four reasons. A 400 is never a rate limit, and admitting
one would let a genuinely malformed insert be retried six times over six minutes instead of
failing at once. A 403 with any other reason — or none — stays what it is today: a mailbox
refusing us, reported immediately.

Both places that currently test `status === 429` (`gmail-api.ts:1525` and `:1584`) call the
predicate instead, so `budget.refused()` fires on a refusal however it is dressed.

`RetryAttempt` gains `rateLimited?: boolean`, and `retryWaitMs` grows one branch ahead of the
per-method ones:

- A rate-limited attempt gets `QUOTA_ATTEMPTS = 6` instead of 3, and its wait is
  `max(Retry-After, 60s + QUOTA_MARGIN_MS)` where `QUOTA_MARGIN_MS = 5_000`, capped by
  `MAX_QUOTA_WAIT_MS = 75_000` rather than by `MAX_WAIT_MS`. A full minute rather than the
  remainder of one: the app cannot see where Gmail's window boundary falls, and waiting the
  whole width is the only figure guaranteed to clear it. Five extra seconds because the meter
  the app keeps and the one Gmail keeps do not tick together. Six attempts means five such
  waits, so just over six minutes of patience for one mail — the right trade for an insert
  inside a 19-minute copy and the wrong one for a drag, which is why the cap is a separate
  constant and not a raised `MAX_WAIT_MS`.
- The `'POST'` branch keeps its discipline: an insert is still only repeated when something
  proves Gmail refused it outright. `isRateLimit` is such a proof — a rate-limited call was
  turned away before it was accepted, so nothing landed. This widens that branch by exactly
  one predicate, named, and by nothing else. `retry.ts`'s own comment forbidding silent
  widening is the reason to say so here.

A `cancelled` attempt is still refused before any of this: a run the user stopped must not sit
out a quota window.

### Part 2 — The job, as a plan on disk

A new module, `electron/mail/label-job.ts`, holding the plan and the state machine and no I/O
beyond the file it owns. Pure enough to test without Electron, which is the reason it is not
more controller.

The plan is one append-only file in the drop folder, `<jobId>.job.jsonl`, written with
`copy-journal.ts`'s discipline and for its reasons: a header, one line per batch transition, a
closing line, each appended the moment the thing it records is true. It never duplicates the
journal — it *references* it, by the `runId` a batch's copy minted.

- **header** — `jobId`, `startedAt`, source account, the dragged label (and, once task 6 of the
  label-tree work lands, the tree it resolved to), the full ordered thread-id list, and
  `batchSize`.
- **choices** — written the moment batch 1's copy is accepted: the targets, their labels, and
  the resolved `CopyMode`. Batches 2..n are copied with these and nothing else.
- **batch** — `index`, `state`, and once copied the `runId` and the counts. States:
  `pending → pulled → copied`, plus `failed`.
- **done** — `outcome`, mirroring the journal's vocabulary: `completed`, `kept`,
  `rolled-back`, `rolled-back-partial`. Its absence is what a crash looks like, exactly as in
  `findOrphanedRuns`.

The thread-id list is written once, in the header, and never recomputed. That is the whole
point: the batches are slices of a list that was true at one instant, so a mail arriving in the
label mid-job does not shift the boundaries underneath the job, and a resumed job asks for the
same ids the original one planned.

### Part 2 — One batch is one of today's drags

`handleMailDrop` (`mail-drop-controller.ts:845`) keeps doing what it does. What changes is
inside: when the label's id list is longer than `batchSize`, `pullMailDrop` writes a plan and
then pulls only batch 0's slice. Everything downstream — `saveLabel`, the preview, the
duplicate scan, `copyToMailboxes` — sees a normal drag of 2,000.

When batch 0's copy answers, a driver advances the job: take the drop lock again, pull batch 1's
slice, copy it with the remembered choices, and on to the next. The driver is the only new
control flow in the controller; the per-batch steps are today's calls, re-entered.

Three things make the re-entry safe rather than lucky, and all three are properties of a job
running strictly one batch at a time:

- `dropSerial += 1` (`:902`) happens per batch, so `scanKey` changes and the duplicate scan
  cache (`lastScan`) cannot carry an answer about batch *n*'s mails into batch *n+1*.
- `runId` is minted per `copyToMailboxes` call (`:1670`), so every batch already gets its own
  id, its own journal and its own marker label per mailbox. Per-batch rollback needs no new
  machinery — it needs the job to remember which runIds are its own.
- `lastDropSaved`, `lastDropPreview` and the drop lock are module-level and built for one drag.
  A job never has two batches in flight, so they hold. This is a constraint the driver must
  honour, not an accident: **no overlapping of batch *n+1*'s pull with batch *n*'s copy**, even
  though the two spend different mailboxes' quota and overlapping would nearly halve the wall
  clock. That optimisation is deliberately not in this design.

The drop lock veils every Gmail view while a pull runs. Per batch it goes up and down once,
rather than standing for the whole job — which is the behaviour a 25-minute job needs, and
falls out of re-entry for free.

### Part 2 — Inheriting batch 1's choices

The user is asked once. Batch 1 opens the picker as it does today; the user ticks mailboxes and
labels and presses Kopieer; if duplicates turn up, the existing confirm round decides between
"only new" and "all". Whatever that resolves to is written to the plan's **choices** line, and
batches 2..n run with it and are never asked again.

The resolved mode is read off what batch 1 actually did, not off what the user clicked:

- The user confirmed "only new" → `'new'`.
- The user confirmed "copy duplicates too" → `'all'`.
- No confirmation ever appeared, because batch 1 had no duplicates → `'new'`. Faithful, not a
  guess: `mode === 'check'` with no hits falls through to the copy with an empty skip index
  (`:1653`), which is what `'new'` does when nothing is duplicated. Inheriting `'all'` here
  would silently grant permission the user was never asked for.

`'new'` in a later batch still runs that batch's own live scan and still skips only what Gmail
says is already there. The job never decides a duplicate from its own file.

A batch that fails outright — a mailbox that starts refusing, a token that cannot be had — does
not advance the job. It writes `failed`, stops, and asks. An unattended job that keeps trying
the next 2,000 into a mailbox that just locked us out is worse than one that waits.

### Part 2 — Stopping: this batch, or all of them

`MailDropCopyControlAction` (`electron/core/ipc.ts`) is today
`'pause' | 'resume' | 'stop-keep' | 'stop-rollback'`. Inside a job, `'stop-rollback'` is
ambiguous, so it splits: `'stop-rollback-batch'` and `'stop-rollback-job'`. The paused dialog
asks which, and only while a job is running — a plain drag keeps the two buttons it has.

`'stop-rollback-batch'` is today's rollback: sweep the running run's markers, leave the earlier
batches where they are. `'stop-rollback-job'` sweeps the running run and then every completed
batch's run in reverse order, each from its own journal and its own recorded marker id. Nothing
new is inferred — the sweep is the sweep, run once per runId. It is slow (a trash is 20 units)
and it must say so before it starts: 7,500 mails is minutes of work, and the paused dialog is
where that expectation is set.

`'stop-keep'` needs no scope. Keeping is keeping.

### Part 2 — Resuming after a restart

The existing orphan path — `findOrphanedRuns` in `copy-journal.ts`, and
`resumeOrphanedCopyRuns` / `pendingOrphanDecision` / `decideOrphanRun`
(`mail-drop-controller.ts:2032`, `:2051`, `:2073`) — already finds runs that never reached a
closing line. A job file with no `done` line is the same shape of evidence one level up, and is
found the same way.

The next start offers, and does not act: *label X, 4,000 of 10,000 copied, continue?* with
continue / leave it / roll back. Automatic resumption is refused on purpose — an app that comes
back from a crash and starts inserting thousands of mails unattended is not something the user
can oversee, and the crash's cause is unknown at that moment.

Continuing re-pulls the batch that was in flight. Its slice may be partly copied already; the
inherited `'new'` mode is what makes that safe, since the scan will find what landed and skip
it. A job resumed with `'all'` will duplicate that batch's already-copied mails — so the offer
says so, in those words, when the inherited mode is `'all'`.

The orphan offer is described in `cancel-with-rollback-designed` as built but never wired.
Wiring it is a prerequisite of this section, not a bonus of it.

### What the user sees

`MailDropCopyProgress` (`electron/core/ipc.ts:155`) gains an optional `job?: { batch: number;
batches: number; done: number; total: number }`. Present only during a job; the strip draws its
current line unchanged when it is absent. The counts are conversations, matching what the drop
progress already counts. Without this the bar restarts from zero five times and reads as four
failures.

### The cap splits in two

`MAX_THREADS` is one constant standing for two unrelated limits, and the API path is the one
that never needed it. It becomes:

- `SCRAPE_MAX_THREADS = 2000` — a real ceiling. Gmail's list view is scraped 50 rows a page and
  re-shows the last page for a too-high number; 40 pages is where that stops being worth it.
  `MAX_PAGES` derives from this one, and truncation is still reported.
- `API_MAX_THREADS = 50_000` — a sanity bound, not a limit anyone should meet. At 100 ids a page
  it is 500 pages and 5,000 units to plan, and at the insert-bound rate a full one is a day's
  copying. It exists so a runaway page loop cannot allocate without end, and if it ever bites,
  it is reported like the other one.

## Tests

Unit, in the existing vitest suite:

- **`quota.ts`** — a call is paced at the safety fraction and not at the published figure (an
  insert advances the cursor by 111ms, not 100ms); the spend booked across a simulated minute
  stays under `UNITS_PER_SECOND * 60`; idle time is still not banked, so the fraction cannot be
  recovered by waiting; `ceiling()`, `refused()` and `recover()` still report and measure against
  the published figure and not the paced one. Injected clock, as today.
- **`retry.ts`** — `isRateLimit` for 429, for 403 with each of the four reasons, and false for a
  403 permission denial; a rate-limited insert retried six times and not three; a wait that
  outlasts a minute and is capped at `MAX_QUOTA_WAIT_MS`; a cancelled rate-limited attempt still
  refused.
- **`gmail-api.ts`** — `reason` parsed off an error body, and absent without one.
- **`label-job.ts`** — slicing a list into batches, including a last batch shorter than the
  rest and a list shorter than one batch; the mode-inheritance table above, all three rows;
  advancing through states and refusing an impossible transition; a plan round-tripped through
  its own file; a plan with no `done` line read back as resumable; a plan whose file has one
  corrupt line read back with the rest intact, the leniency `parseCopyJournal` already extends.

What tests cannot finish: the driver's re-entry into the controller, and every number in part 1.
Both need one run against a real mailbox. That puts this in the same company as
`parallel-mail-copy-work` and `cancel-with-rollback-designed` — written, green, never run live —
and the live run is the acceptance criterion, not the suite.

## Implementation order

Part 1 stands alone and goes first. It touches `quota.ts`, `retry.ts` and `gmail-api.ts`, no
controller, no UI, and it is what actually fixes the reported failure. It is worth shipping and
watching on its own before anything below it is built.

Part 2 waits on the label-tree work. Tasks 6, 7 and 8 of
`docs/superpowers/plans/2026-08-25-label-tree-copy.md` are open, and task 6 rewrites collection
at drop time in `mail-drop-controller.ts` — the exact step a plan draws its thread-id list from.
For a tree drag that list is the merged `mergeTreeThreads` list, not one label's. Building the
job first means building it against a collection step that is about to change shape, and then
changing it again.

So: part 1, then label-tree 6-8, then part 2. If part 2 is wanted sooner than that, the thing to
say out loud is that its plan will be rewritten once task 6 lands.
