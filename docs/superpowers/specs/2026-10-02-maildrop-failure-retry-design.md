# Saying which mail failed, and offering to try it again

## The problem

When one mail in a drag or a copy fails, the rest carries on — that part works. What the user
gets told about the failure does not.

- **A partial pull says nothing.** `dropFailures` (`renderer/lib/drop-outcome.ts:38`) returns
  reasons only when *nothing* was saved. One conversation of ten failing leaves the preview
  silent, and the picker opens on the other nine as if that were the whole drag.
- **The strip reads a partial drag as a success.** `dropOutcome`
  (`electron/mail/dropzone.ts:436`) sums the mails each row produced against the number of rows.
  Every row yields at most one mail, so `8 van 10 opgeslagen` is the right count — but it is
  reported `ok: true` and drawn in the done colour, beside nothing that says two failed.
- **The copy report names one error and no mail.** `tallyOutcomes`
  (`electron/mail/mail-copy.ts:432`) keeps only `lastError`; the per-mailbox line reads
  `18 van 20 gekopieerd — <last error>`. Which two mails, and whether they failed for the same
  reason, is only in `log.jsonl`.
- **A batched job hides partial batches.** A batch is recorded `failed` only when its copy
  answered `ok: false` (`mail-drop-controller.ts:3158`), which is nothing copied at all. A batch
  that lost twenty mails is recorded `copied`, and the job ends green on
  `Klaar — 1980 van 2000 mailtjes gekopieerd`, indistinguishable from twenty skipped duplicates.

And once the user does know, the only way to try again is to drag again — which re-pulls
everything and leans on the duplicate scan, the one safety net that is known not to see inserts
made seconds earlier (see the 26-08 incident in the driven-batch notes).

## What is wanted

Decided with the owner on 2026-10-02:

- A failure names **which** mails: subject and reason, per mail.
- **One button**, `Mislukte opnieuw proberen`, under the list, that retries all of them. No
  per-mail buttons.
- Both kinds of failure get it:
  - **pull failures** — retried before any label is chosen, in the preview;
  - **copy failures** — retried into **exactly the same mailboxes and labels** as the first
    attempt.
- The offer lives **as long as the panel is open**. Closing the panel or the app drops it;
  `log.jsonl` still holds every failure.
- In a **batched job**, failures are gathered **at the end of the job, across every batch** —
  never reported or retried between batches.
- Nothing about which mail lands where changes. The same mail goes to the same place, once
  more. This keeps the work inside the speed-only rule for the mail drop.

## Scope: two parts

**Part 1 (this spec):** clear reporting everywhere, the retry button for ordinary drags and for
label drags of up to one batch (`JOB_BATCH_THREADS`, 2000 conversations), and an honest job end
for batched jobs — with a failure count, but no retry button yet.

**Part 2 (its own spec, later):** the retry button at the end of a batched job. That one has to
collect failures across batches that each had their own `lastDropSaved`, and re-pull
conversations whose batch has long since been replaced. It is the riskiest piece and is kept
apart on purpose.

## Design

### What a row is

`saveOneThread` keeps exactly one message per conversation — the dragged one, or else the
newest — and `saveLabel` does the same per thread. A row therefore either produced one mail or
failed; there is no half-saved row. A row counts as **failed** when `saved === 0` and it carries
an error. Rows that are not conversations — `Afgekapt op …`, `Niet in het logboek gezet` — are
warnings: shown, never retried.

### The pull side

**On screen.** While the picker is in `picking` and any row failed, a red block sits above the
label choice:

```
2 van 10 gesprekken niet opgehaald
  ✕ Offerte Q3 — Ophalen via de API mislukt (…)
  ✕ Re: levering — Kan niet schrijven naar …
  [ Mislukte opnieuw ophalen ]
```

The rest stays copyable; retrying first is not required. When every row failed, the existing
failure screen stays and gets the same button. The strip keeps its count —
`8 van 10 opgeslagen`, conversations, which a row already is — and draws it in the failed colour
whenever one failed.

**What main keeps.** `pullMailDrop` records, beside `lastDropSaved`, a `PullFailures` entry: the
failed rows with what is needed to fetch them again (for a drag the `MailDropItem` —
`threadId`, `message`, `messageUnknown`; for a label the thread and its `labels`, which is the
tree membership), the `acctKey`, `authuser`, `ik`, the account, and the `dropSerial` it belongs
to. It gets a `retryId`.

**Retrying.** A new IPC call `MAIL_DROP_PULL_RETRY { retryId }`. Main refuses — with a message the
panel shows — when the id is not the current one, the `dropSerial` moved on, a job is driving, a
pull is running, or a copy run is active. Otherwise it takes the pull lock (the veil returns, as
for any pull) and fetches only the failed rows through the same function the first attempt used
(`saveOneThread` for a drag; the per-thread fetch and `writeLabel` for a label, newest message
only, with the same `sourceLabels`). New refs are **appended** to `lastDropSaved`; for a label,
`lastDropTree`'s member counts are recomputed. The preview is re-sent with those rows replaced,
`lastScan` is cleared and `startExistingScan` runs again, because the set of files changed.
What still fails becomes the next `PullFailures` with a fresh `retryId`.

### The copy side

**On screen.** The per-mailbox report lists every failed mail of that mailbox:

```
info@klant.nl — 47 van 50 gekopieerd
  ✕ Offerte Q3 — Gmail: quota overschreden
  ✕ Re: levering — geen antwoord van Google (time-out) · mogelijk toch aangekomen
  ✕ Factuur 2291 — Kan … niet lezen
[ Mislukte opnieuw proberen ]
```

A list longer than 20 shows the first 20 and `+ 13 meer`; the button retries all of them. After
a retry, its report replaces the previous one, and what still failed gets the button again.

**Maybe landed.** A timed-out insert may have reached Gmail. `copyOneFile` marks an outcome
`maybeLanded` when the error is a `GmailTimeoutError` (exported for the purpose, or exposed
through a type guard from `gmail-api.ts`). Quota refusals, 4xx answers and unreadable files are
never `maybeLanded`. The flag is shown, not acted on — the duplicate check on retry is what acts.

**What main keeps.** After the outcomes are tallied, `copyToMailboxes` records a `CopyFailures`
entry: per target the target exactly as it was copied to (`email`, `labelIds`, `tree`), the
`SavedRef`s that failed there with their error and `maybeLanded`, the `dropSerial`, and a
`retryId`. The result carries `failures` per account — subject, error, `maybeLanded` — and the
`retryId`. `tallyOutcomes` gains the list of failed entries beside `lastError`, which stays for
the log line.

**Retrying.** A new IPC call `MAIL_DROP_COPY_RETRY { retryId }`. The renderer sends nothing but
the id: no paths, no labels, so a retry cannot be pointed anywhere the first attempt did not go.
Main refuses on the same conditions as the pull retry. Otherwise it calls `copyToMailboxes` with
an internal `retry` argument — not reachable from the ordinary `MAIL_DROP_COPY` handler — that
supplies the targets and, **per target**, the files to copy. A mailbox where everything landed is
not part of the retry at all.

Inside `copyToMailboxes`, the file set becomes per target instead of `lastDropSaved` for all;
`copyTotal` counts the per-target sets. Everything else is the ordinary path: the journal, the
run marker, pause, cancel and rollback, the quota budget, the progress bar, the job guard.

**The duplicate check always runs fresh on a retry.** The ordinary path reuses `lastScan` when
`scanKey(targets)` matches the previous attempt — and a retry always matches it, so it would
reuse a scan taken before the first copy inserted anything. A retry clears `lastScan` and runs
in mode `check`; a hit opens the existing "staat er al" confirm screen. This is the guard for a
`maybeLanded` mail that did land and is already indexed. One that landed and is **not yet**
indexed can still be inserted twice; that window is accepted and is why the flag is shown.

### The batched job

**During the walk** nothing about failures is shown. A batch that lost some mails is not
retried, does not stop the job, and does not change the walking panel.

**Recorded per batch.** `recordJobBatchState` gains a `failed` count beside `copied` and
`skipped`: the number of conversations that failed in at least one mailbox. Counted in
conversations, never in messages times mailboxes — the same unit the job line speaks. Because it
is in the job file, a job resumed after a restart still totals correctly. Old job files without
the field read as 0.

**At the end**, `JobEndInfo` gains `failed`, summed over every batch. A `completed` job with
`failed > 0` reads, in amber rather than green:

```
Klaar — 1980 van 2000 gekopieerd, 20 mislukt (zie log.jsonl)
```

A batch whose copy answered `ok: false` still stops the job as `stuck`; that rule is unchanged.

### Where the code goes

`renderer/app/maildrop/page.tsx` has no tests, so it only draws. The decisions live in plain
modules:

- `electron/mail/copy-failures.ts` — builds `CopyFailures` from outcomes and targets, knows
  `maybeLanded`, and answers whether a retry id may run (`retryRefusal`).
- `electron/mail/pull-failures.ts` — the same for the pull side, including which rows are
  conversations and which are warnings.
- `renderer/lib/failure-list.ts` — the texts: `2 van 10 gesprekken niet opgehaald`, the per-mail
  line, the `+ n meer` cut-off, the job end with failures.
- `renderer/app/job-panel.ts` — `jobEndText` learns the failed count.

New IPC channels `MAIL_DROP_PULL_RETRY` and `MAIL_DROP_COPY_RETRY` in `electron/core/ipc.ts`,
handlers in `ipc-handlers.ts`, bridges in `sidebar-preload.ts`.

## Testing

Unit tests, no mailbox:

- `copy-failures`: failed outcomes become per-target entries with the target's own labels;
  `maybeLanded` only for a timeout; a mailbox with no failures is absent.
- `pull-failures`: failed rows are kept with their fetch details; truncation and log rows are
  warnings, not failures.
- `retryRefusal`: refused for a stale id, a moved `dropSerial`, a driving job, a running pull,
  an active copy.
- `failure-list`: every text, the cut-off at 20, singular and plural.
- `copyToMailboxes` on a retry: only the failed files, only to the targets they failed in, with
  the same labels; `lastScan` is not reused; refused while a job drives.
- Label job: `failed` is recorded per batch, summed at the end, read as 0 from an old file.
- `jobEndText`: a completed job with failures reads as such.

The full suite and both `tsc` projects stay green.

Live, against the scratch test label:

- Drag a few conversations and cut the network during the pull. Check the red block, press
  `Mislukte opnieuw ophalen`, copy, and check the mail is in the chosen label and nothing is
  doubled.
- Cut the network during a copy. Check the per-mail list, press `Mislukte opnieuw proberen`, and
  check the mail lands in the same label(s) of the same mailbox(es), once.

## Out of scope

- The retry button at the end of a batched job (part 2).
- Keeping the offer across a closed panel or a restart.
- Per-mail retry buttons.
- Any change to which mail is saved, which labels it gets, or where files are written.
