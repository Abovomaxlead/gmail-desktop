# Batched label job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dragged label of any size is pulled and copied in batches, driven by a plan on disk, so a stop costs one batch instead of the whole label and a restart can offer to pick the job up.

**Architecture:** A new pure-ish module `electron/mail/label-job.ts` owns the plan: one append-only `<jobId>.job.jsonl` in the drop folder, the slicing, the batch state machine and the mode-inheritance rule. `mail-drop-controller.ts` gains a driver that re-enters today's `pullMailDrop` and `copyToMailboxes` once per batch — every batch is, to everything downstream, an ordinary drag. Each batch keeps its own `runId`, journal and marker labels, which is what lets a stop roll back either the running batch or the whole job.

**Tech Stack:** TypeScript, Electron main process, React (the maildrop picker), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-big-label-copy-batching-design.md` — this plan implements **part 2**. Part 1 (the quota fix) is already built: `docs/superpowers/plans/2026-08-26-quota-headroom-and-rate-limit-retry.md`.

**Unvalidated assumption, stated up front:** part 1 has never been run against a live mailbox, so its numbers are unconfirmed. `JOB_BATCH_THREADS` is therefore a named constant with a stated rationale rather than a measured figure. After the first live copy of a few thousand mails, revisit it — nothing else in this plan depends on its value being right, only on there being one.

## Global Constraints

- **Written artifacts are English.** Comments, docblocks, commit messages. The repository is otherwise Dutch; do not translate what is already there. User-facing strings stay Dutch, matching every string already in the picker.
- **Comment convention.** Banner sections (three lines, a row of 27 `=`, the Title-case name, another row of 27 `=`), fixed section order per file, empty sections stay. Docblocks are one-line description, blank `*`, then tags. Inline comments say *why*, never restate the line below. Roughly one comment line per ten of code.
- **Which mail lands where does not change.** `CopyMode` keeps its three meanings: `'check'` looks and asks, `'new'` skips what the target already holds, `'all'` copies regardless and skips the scan. A batch evaluates that policy against **its own** mails, live. Nothing about duplicates is ever decided from the plan file.
- **A label that fits in one batch behaves exactly as it does today** — same drag, same preview, same `log.jsonl` lines, same folder and file names. No plan file is written, no driver runs, no job progress is sent. This is the property that keeps the change safe, and Task 4 tests it directly.
- **The marker discipline.** Every insert keeps riding out with its run's marker label folded into the same POST. A sweep acts only on a `markerLabelId` a journal header recorded, never on one re-derived from a name.
- **One batch in flight at a time.** `lastDropSaved`, `lastDropPreview`, `lastDropTree`, `dropSerial` and the drop lock are module-level and built for one drag. The driver must never overlap batch *n+1*'s pull with batch *n*'s copy, even though their quota is separate and overlapping would nearly halve the wall clock. Deliberately out of scope.
- **Verification commands:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p renderer/tsconfig.json`. Baseline at the start of this plan: 1902 tests green.
- **Do not run `npm run build`, `npm run build:renderer`, or `npm run dev`.** A production build poisons `renderer/.next` and makes the user's dev server 404 its own routes. This plan needs none of them.
- **`renderer/app/maildrop/page.tsx` contains a raw NUL byte** in `const TOP_LEVEL = '\0bovenin';` (line 61), which makes most tools treat it as binary. Read it with `sed -n` or `grep -a`. Do not "fix" it in this plan — it is another change's fresh work.

---

## Task Overview

| Task | Files | Depends on |
|---|---|---|
| 1 | `label-drop.ts`, `mail-drop-controller.ts`, `tests/label-drop.test.ts` | — |
| 2 | `label-job.ts` (new), `tests/label-job.test.ts` | — |
| 3 | `mail-drop-controller.ts` | 1 |
| 4 | `mail-drop-controller.ts`, `tests/label-job.test.ts` | 2, 3 |
| 5 | `mail-drop-controller.ts` | 4 |
| 6 | `ipc.ts`, `mail-drop-controller.ts`, `maildrop/page.tsx` | 5 |
| 7 | `ipc.ts`, `mail-drop-controller.ts`, `maildrop/page.tsx` | 5 |
| 8 | `label-job.ts`, `ipc.ts`, `ipc-handlers.ts`, `mail-drop-controller.ts`, `maildrop/page.tsx` | 5 |

Tasks 1 and 2 are independent and can be done in parallel. Everything from 3 on is **sequential**, 6, 7 and 8 included: they depend only on 5 in the dependency sense, but all three edit `electron/core/ipc.ts` and `renderer/app/maildrop/page.tsx`, and 7 fills in the very prop 6 adds to `StopConfirm`. Running them at once means three writers on two files.

---

### Task 1: The cap splits in two

**Files:**
- Modify: `electron/mail/label-drop.ts` — replace `MAX_THREADS` with two constants
- Modify: `electron/mail/mail-drop-controller.ts` — the four references, and `EXISTING_SCAN_LIMIT`
- Test: `tests/label-drop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const SCRAPE_MAX_THREADS = 2000` and `export const API_MAX_THREADS = 50_000` from `electron/mail/label-drop.ts`. `MAX_THREADS` stops existing; every reader picks the one that matches its path.

**Why:** `MAX_THREADS` is one constant standing for two unrelated limits. For the scrape fallback 2,000 is a real ceiling — Gmail's list view gives 50 rows a page and re-shows the last page for a too-high number. For the API path, which pages `threads.list` at 100 ids for 10 units, it is arbitrary, and it is the thing stopping a big label from being planned at all.

**The third reader, which is the part that is easy to get wrong:** `EXISTING_SCAN_LIMIT = MAX_THREADS` (`mail-drop-controller.ts:1155`) bounds the duplicate scan that runs from the drop, and its comment states the intent — *set above the most a drag can produce*. Pointed at `API_MAX_THREADS` it would pre-scan 50,000 Message-IDs, which is 5,000 batched searches for a picker that only ever draws one batch. It must be pointed at the most a **single pull** can produce. In this task that is `SCRAPE_MAX_THREADS`; Task 4 moves it to the batch size.

- [x] **Step 1: Write the failing test**

`tests/label-drop.test.ts` already imports `MAX_THREADS` and uses it in the `mergeThreads` cap test. Change that import to `SCRAPE_MAX_THREADS`, change the two uses in that test, and append:

```ts
describe('the two caps', () => {
  // The scrape reads Gmail's own list view 50 rows at a time and it re-shows the last page for
  // a page number past the end, so there is a real point past which paging stops being worth
  // it. That is what this number is, and MAX_PAGES derives from it.
  it('bounds the scrape at what paging Gmail\'s list view is worth', () => {
    expect(SCRAPE_MAX_THREADS).toBe(2000);
    expect(MAX_PAGES).toBe(Math.ceil(SCRAPE_MAX_THREADS / PAGE_SIZE));
  });

  // Not a limit anyone should meet: threads.list pages 100 ids for 10 units, so a full one is
  // 500 pages and 5,000 units to plan. It exists so a runaway page loop cannot allocate without
  // end, which is a different job from the scrape's ceiling.
  it('bounds the API path far above anything a mailbox holds', () => {
    expect(API_MAX_THREADS).toBe(50_000);
    expect(API_MAX_THREADS).toBeGreaterThan(SCRAPE_MAX_THREADS);
  });
});
```

Add `SCRAPE_MAX_THREADS`, `API_MAX_THREADS`, `MAX_PAGES` and `PAGE_SIZE` to the existing import from `../electron/mail/label-drop`, and remove `MAX_THREADS` from it.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/label-drop.test.ts`
Expected: FAIL — the import of `SCRAPE_MAX_THREADS` does not resolve, so the file fails to collect.

- [x] **Step 3: Split the constant**

In `electron/mail/label-drop.ts`, replace:

```ts
export const MAX_THREADS = 2000;
export const MAX_PAGES = Math.ceil(MAX_THREADS / PAGE_SIZE);
```

with:

```ts
/** Where paging Gmail's own list view stops being worth it. The scrape reads 50 rows a page and
 * Gmail re-shows the last page for a page number past the end, so forty pages is the point past
 * which more paging buys guesses rather than rows. A real ceiling, and still reported when it
 * bites: truncating in silence reads as "everything saved". */
export const SCRAPE_MAX_THREADS = 2000;

/** A bound on the API path, not a limit anyone should meet. `threads.list` pages 100 ids for 10
 * units, so a full one is 500 pages and 5,000 units just to plan, and copying it would take a
 * day. It is here so a runaway page loop cannot allocate without end -- a different job from the
 * scrape's ceiling above, which is why the two are no longer one constant. */
export const API_MAX_THREADS = 50_000;

export const MAX_PAGES = Math.ceil(SCRAPE_MAX_THREADS / PAGE_SIZE);
```

Then `mergeTreeThreads`, which both paths call, reads the cap from the module. Make the caller's path decide it instead:

```ts
export function mergeTreeThreads(
  acc: TreeThread[],
  member: string,
  page: LabelThread[],
  /** defaults to the scrape's own ceiling, so a caller that never named one keeps today's
   * behaviour; the API path passes its own, which is a different limit entirely */
  cap = SCRAPE_MAX_THREADS,
): { added: number; total: number } {
```

and inside, `if (acc.length >= cap) continue;`. Defaulting to the scrape's cap means every existing call site keeps today's behaviour with no edit.

`mergeThreads` used to need the same treatment and no longer exists — task 6 of the label-tree work replaced it with `mergeTreeThreads`. If a `mergeThreads` turns up in this file, this plan is being executed against an older tree than it was written for; stop and re-read.

Also update the file's opening comment, which says `MAX_THREADS caps the total`. Replace that clause with: `the scrape caps the total at SCRAPE_MAX_THREADS and the API path at API_MAX_THREADS — reported when either bites, since truncating silently reads as "everything saved"`.

- [x] **Step 4: Point each reader at the right one**

In `electron/mail/mail-drop-controller.ts`, five places:

1. The import — `MAX_THREADS` becomes `SCRAPE_MAX_THREADS, API_MAX_THREADS`.
2. `collectLabelThreads` (`:648`), the scrape: `if (total >= MAX_THREADS)` becomes `if (total >= SCRAPE_MAX_THREADS)`.
3. `collectLabelViaApi` (`:691` and `:695`), the API path: `listLabelThreadIds(token, labelId, MAX_THREADS)` becomes `listLabelThreadIds(token, labelId, API_MAX_THREADS)`, and `if (total >= MAX_THREADS)` becomes `if (total >= API_MAX_THREADS)`. Its `mergeTreeThreads` call gains `API_MAX_THREADS` as the fourth argument.
4. The two truncation messages at `:885` and `:902` name the number in Dutch text. Both are reached from either path, so neither constant is right on its own — pass the cap that actually bit. Add a `cap: number` to what `saveLabel` already returns from its two collectors, thread it to those two strings, and interpolate it there instead of the constant.
5. `EXISTING_SCAN_LIMIT = MAX_THREADS` (`:1155`) becomes `SCRAPE_MAX_THREADS`, and its comment's clause `a label drag stops at MAX_THREADS` becomes `a label drag stops at SCRAPE_MAX_THREADS, and once a job exists at one batch (Task 4)`.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/label-drop.test.ts`
Expected: PASS.

Then: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, and exit 0. Nothing changes behaviour for a label under 2,000; a bigger one now lists further on the API path, which nothing yet slices.

- [x] **Step 6: Commit**

```bash
git add electron/mail/label-drop.ts electron/mail/mail-drop-controller.ts tests/label-drop.test.ts
git commit -m "refactor(maildrop): split the thread cap into the scrape's and the API's

One constant stood for two unrelated limits. Forty pages is a real
ceiling for scraping Gmail's list view, which re-shows the last page for
a number past the end; for threads.list, which pages 100 ids for 10
units, 2000 was arbitrary and it is what stopped a big label from being
planned at all. The duplicate scan's own limit stays on the scrape's
number: pointed at the API bound it would pre-scan 50,000 Message-IDs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The job plan, and the file it lives in

**Files:**
- Create: `electron/mail/label-job.ts`
- Test: `tests/label-job.test.ts`

**Interfaces:**
- Consumes: `TreeThread` from `./label-drop`, `CopyTarget` from `./mail-copy`, `CopyRunId` from `./copy-run-types` (types only).
- Produces, all from `electron/mail/label-job.ts`:
  - `export const JOB_BATCH_THREADS = 2000`
  - `export type JobBatchState = 'pending' | 'pulled' | 'copied' | 'failed'`
  - `export type JobOutcome = 'completed' | 'kept' | 'rolled-back' | 'rolled-back-partial'`
  - `export interface JobBatch { index: number; state: JobBatchState; threads: TreeThread[]; runId?: CopyRunId; copied?: number; skipped?: number; error?: string }`
  - `export interface JobChoices { targets: CopyTarget[]; mode: 'new' | 'all' }`
  - `export interface LabelJob { jobId: string; startedAt: number; account: string; label: string; members: string[]; batchSize: number; total: number; choices: JobChoices | null; batches: JobBatch[]; outcome: JobOutcome | null }`
  - `export function sliceIntoBatches(threads: TreeThread[], batchSize: number): TreeThread[][]`
  - `export function inheritedMode(confirmed: 'new' | 'all' | null): 'new' | 'all'`
  - `export function jobPath(root: string, jobId: string): string`
  - `export function startLabelJob(root: string, header: Omit<LabelJob, 'choices' | 'batches' | 'outcome'>, batches: TreeThread[][]): void`
  - `export function recordJobChoices(root: string, jobId: string, choices: JobChoices): void`
  - `export function recordJobBatchState(root: string, jobId: string, at: { index: number; state: JobBatchState; runId?: CopyRunId; copied?: number; skipped?: number; error?: string }): void`
  - `export function finishLabelJob(root: string, jobId: string, outcome: JobOutcome): void`
  - `export function parseLabelJob(raw: string): LabelJob | null`
  - `export function readLabelJob(root: string, jobId: string): LabelJob | null`
  - `export function findUnfinishedJobs(root: string): LabelJob[]`
  - `export function nextBatch(job: LabelJob): JobBatch | null`
  - `export function jobProgress(job: LabelJob): { batch: number; batches: number; done: number; total: number }`

**Why the file is append-only, one line at a time:** exactly the reason `copy-journal.ts` gives for itself. A job that is killed loses whatever it has not written, so the moment that matters is the transition, not the end of the run. And the absence of a closing line is the only thing that tells a crashed job from a finished one, which is what Task 8 reads.

**Why the thread list is written once, at plan time:** the batches are slices of a list that was true at one instant. A mail arriving in the label mid-job must not shift the boundaries underneath the job, and a resumed job must ask for the same ids the original one planned. Each batch's slice is its own line, so the header stays small and a 10,000-thread plan is not one megabyte-long line.

**Note on the drop folder's sweep:** `mail-drop-cleanup.ts` removes entries older than `KEEP_DAYS` (3), falling back to mtime for a name with no timestamp in it. A `.job.jsonl` has no timestamp in its name, so an abandoned job file is swept after three days exactly like an orphaned `.rollback.jsonl` already is. That bounds how long Task 8's resume offer survives, which is correct and needs no change.

- [x] **Step 1: Write the failing tests**

Create `tests/label-job.test.ts`:

```ts
// The plan behind a label too big for one run: how it is sliced, what it remembers, and what a
// half-written file reads back as. The file itself is the unit under test alongside the pure
// parts, the same way tests/copy-journal.test.ts treats its own journal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JOB_BATCH_THREADS,
  sliceIntoBatches,
  inheritedMode,
  jobPath,
  startLabelJob,
  recordJobChoices,
  recordJobBatchState,
  finishLabelJob,
  parseLabelJob,
  readLabelJob,
  findUnfinishedJobs,
  nextBatch,
  jobProgress,
  type LabelJob,
} from '../electron/mail/label-job';

const thread = (id: string, labels = ['Klanten']) => ({ threadId: id, subject: `re ${id}`, labels });

const threads = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => thread(`t${i + from}`));

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'labeljob-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A plan of `count` threads at `batchSize`, written to disk, so the file cases below do not
 * each repeat six lines of setup. */
const written = (count: number, batchSize = 2): LabelJob => {
  const all = threads(count);
  const slices = sliceIntoBatches(all, batchSize);
  startLabelJob(
    root,
    {
      jobId: 'job-1',
      startedAt: 1_000,
      account: 'luca@example.com',
      label: 'Klanten',
      members: ['Klanten', 'Klanten/Acme'],
      batchSize,
      total: count,
    },
    slices,
  );
  return readLabelJob(root, 'job-1')!;
};

describe('sliceIntoBatches', () => {
  it('cuts an exact multiple into equal batches', () => {
    const out = sliceIntoBatches(threads(6), 3);
    expect(out.map((b) => b.length)).toEqual([3, 3]);
    expect(out[1][0].threadId).toBe('t3');
  });

  it('leaves the last batch short rather than padding it', () => {
    expect(sliceIntoBatches(threads(7), 3).map((b) => b.length)).toEqual([3, 3, 1]);
  });

  // The case the whole safety property rests on: a label that fits is one batch, and Task 4
  // writes no plan at all for it.
  it('answers one batch for a list shorter than the batch size', () => {
    expect(sliceIntoBatches(threads(5), 2000).map((b) => b.length)).toEqual([5]);
  });

  it('answers nothing for an empty list', () => {
    expect(sliceIntoBatches([], 2000)).toEqual([]);
  });

  it('keeps every thread exactly once, in the order it was given', () => {
    const all = threads(10);
    expect(sliceIntoBatches(all, 4).flat().map((t) => t.threadId)).toEqual(
      all.map((t) => t.threadId),
    );
  });
});

describe('inheritedMode', () => {
  // The rule, and the reason it is a named function rather than a ternary at the call site.
  it('carries an explicit choice for duplicates forward', () => {
    expect(inheritedMode('all')).toBe('all');
    expect(inheritedMode('new')).toBe('new');
  });

  // Batch 1 having no duplicates means the user was never asked, and 'check' with no hits
  // copies with an empty skip index -- which is what 'new' does when nothing is duplicated.
  // Inheriting 'all' here would grant permission nobody gave.
  it('falls back to skipping duplicates when nobody was ever asked', () => {
    expect(inheritedMode(null)).toBe('new');
  });
});

describe('the batch size', () => {
  it('is the number the user settled on', () => {
    expect(JOB_BATCH_THREADS).toBe(2000);
  });
});

describe('the plan on disk', () => {
  it('round-trips a plan through its own file', () => {
    const job = written(5, 2);
    expect(job.jobId).toBe('job-1');
    expect(job.label).toBe('Klanten');
    expect(job.members).toEqual(['Klanten', 'Klanten/Acme']);
    expect(job.total).toBe(5);
    expect(job.batches.map((b) => b.threads.length)).toEqual([2, 2, 1]);
    expect(job.batches.every((b) => b.state === 'pending')).toBe(true);
    expect(job.choices).toBeNull();
    expect(job.outcome).toBeNull();
  });

  it('remembers the choices batch one was copied with', () => {
    written(5, 2);
    recordJobChoices(root, 'job-1', {
      targets: [{ email: 'support@example.com', labelIds: [], tree: { parentLabelId: null } }],
      mode: 'new',
    });
    const job = readLabelJob(root, 'job-1')!;
    expect(job.choices?.mode).toBe('new');
    expect(job.choices?.targets[0].email).toBe('support@example.com');
  });

  it('folds the state lines so the last one for a batch wins', () => {
    written(5, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'pulled' });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    const job = readLabelJob(root, 'job-1')!;
    expect(job.batches[0].state).toBe('copied');
    expect(job.batches[0].runId).toBe('run-a');
    expect(job.batches[0].copied).toBe(2);
    expect(job.batches[1].state).toBe('pending');
  });

  it('never loses a batch slice to a state line', () => {
    written(5, 2);
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    expect(readLabelJob(root, 'job-1')!.batches[1].threads.map((t) => t.threadId)).toEqual([
      't2',
      't3',
    ]);
  });

  it('closes with the outcome', () => {
    written(2, 2);
    finishLabelJob(root, 'job-1', 'completed');
    expect(readLabelJob(root, 'job-1')!.outcome).toBe('completed');
  });

  it('answers nothing for a job that was never started', () => {
    expect(readLabelJob(root, 'nope')).toBeNull();
  });

  // The same leniency parseCopyJournal already extends: one unreadable line must not cost the
  // rest of the plan.
  it('skips a line it cannot parse and keeps the rest', () => {
    written(4, 2);
    const path = jobPath(root, 'job-1');
    writeFileSync(path, `${readFileSync(path, 'utf8')}{ niet json\n`);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a' });
    const job = readLabelJob(root, 'job-1')!;
    expect(job.batches[0].state).toBe('copied');
    expect(job.batches).toHaveLength(2);
  });

  it('answers nothing for a file with no header to anchor the rest to', () => {
    expect(parseLabelJob('{"type":"state","index":0,"state":"pulled"}\n')).toBeNull();
  });
});

describe('findUnfinishedJobs', () => {
  it('finds a job that never reached its closing line', () => {
    written(4, 2);
    expect(findUnfinishedJobs(root).map((j) => j.jobId)).toEqual(['job-1']);
  });

  it('leaves a closed job alone', () => {
    written(4, 2);
    finishLabelJob(root, 'job-1', 'completed');
    expect(findUnfinishedJobs(root)).toEqual([]);
  });

  // The drop folder holds the copy journals too, and those must not read as jobs.
  it('ignores a rollback journal sitting beside it', () => {
    written(4, 2);
    writeFileSync(join(root, 'run-a.rollback.jsonl'), '{"type":"header","runId":"run-a"}\n');
    expect(findUnfinishedJobs(root).map((j) => j.jobId)).toEqual(['job-1']);
  });

  it('answers nothing for a folder that is not there', () => {
    expect(findUnfinishedJobs(join(root, 'weg'))).toEqual([]);
  });
});

describe('nextBatch', () => {
  it('is the first batch not yet copied', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a' });
    expect(nextBatch(readLabelJob(root, 'job-1')!)?.index).toBe(1);
  });

  // A batch that was pulled but never copied is where a crash lands, and it is the batch to
  // resume -- not the one after it.
  it('is a pulled-but-not-copied batch rather than the one after it', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a' });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    expect(nextBatch(readLabelJob(root, 'job-1')!)?.index).toBe(1);
  });

  // A batch that failed stops the job. Handing back the one after it would be the driver
  // walking past a mailbox that just locked us out.
  it('stops at a failed batch instead of stepping over it', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'failed', error: 'geen toegang' });
    expect(nextBatch(readLabelJob(root, 'job-1')!)).toBeNull();
  });

  it('is nothing once every batch is copied', () => {
    written(4, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a' });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'copied', runId: 'run-b' });
    expect(nextBatch(readLabelJob(root, 'job-1')!)).toBeNull();
  });
});

describe('jobProgress', () => {
  it('counts conversations copied and the batch being worked on', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    expect(jobProgress(readLabelJob(root, 'job-1')!)).toEqual({
      batch: 2,
      batches: 3,
      done: 2,
      total: 6,
    });
  });

  // One-based, because it is read out to a person: "batch 1 van 3", never "batch 0 van 3".
  it('names the first batch as one, not zero', () => {
    expect(jobProgress(written(6, 2)).batch).toBe(1);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/label-job.test.ts`
Expected: FAIL — `electron/mail/label-job.ts` does not exist.

- [x] **Step 3: Write the module**

Create `electron/mail/label-job.ts`:

```ts
// The plan behind a label too big to copy in one run: which conversations, cut into which
// batches, copied with which choices, and how far it got.
//
// Append-only, one line per transition, for the reason copy-journal.ts gives for itself: a job
// that is killed loses whatever it has not written yet, so the moment that matters is the
// transition and not the end of the run. And the absence of a closing line is the only thing
// that tells a crashed job from a finished one, which is what the resume offer reads.
//
// This never replaces the journal and never duplicates it. A journal answers for one batch's
// inserts and owns the marker a rollback sweeps by; this answers for which batches there are.
// The link between them is the runId a batch's copy minted, recorded here the moment it is
// known.
//
// The conversation list is written once, at plan time, one line per batch. The batches are
// slices of a list that was true at one instant: a mail arriving in the label halfway through
// must not shift the boundaries underneath the job, and a resumed job has to ask for the same
// ids the original one planned. One line per batch rather than one line for all of them keeps a
// ten-thousand-thread plan off a single megabyte-long line.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CopyRunId } from './copy-run-types';
import type { TreeThread } from './label-drop';
import type { CopyTarget } from './mail-copy';


//===========================
// Types
//===========================

/** Where one batch has got to. 'pulled' means its mail is on disk and its preview was drawn;
 * 'copied' means its copy answered. 'failed' stops the job rather than moving to the next
 * batch -- an unattended job that keeps trying the next two thousand into a mailbox that just
 * locked us out is worse than one that waits. */
export type JobBatchState = 'pending' | 'pulled' | 'copied' | 'failed';

/** How a job was closed. The same vocabulary the journal's own outcomes use, one level up. */
export type JobOutcome = 'completed' | 'kept' | 'rolled-back' | 'rolled-back-partial';

export interface JobBatch {
  index: number;
  state: JobBatchState;
  /** The slice this batch was planned with, written at plan time and never recomputed */
  threads: TreeThread[];
  /** The copy run that carried this batch. The one key a rollback of this batch works from. */
  runId?: CopyRunId;
  copied?: number;
  skipped?: number;
  error?: string;
}

/** What batch one was copied with, and what every batch after it is copied with. Written once
 * the user has answered; never read to decide anything about duplicates, only to re-ask
 * Gmail the same question with the same policy. */
export interface JobChoices {
  targets: CopyTarget[];
  mode: 'new' | 'all';
}

export interface LabelJob {
  jobId: string;
  startedAt: number;
  /** The mailbox the label was dragged out of */
  account: string;
  label: string;
  /** Every label of the dragged tree, parents first, as the collection resolved it */
  members: string[];
  batchSize: number;
  /** Conversations across the whole job, which is the sum of the batches' slices */
  total: number;
  choices: JobChoices | null;
  batches: JobBatch[];
  outcome: JobOutcome | null;
}

interface JobHeaderLine {
  type: 'header';
  jobId: string;
  startedAt: number;
  account: string;
  label: string;
  members: string[];
  batchSize: number;
  total: number;
}

interface JobBatchLine {
  type: 'batch';
  index: number;
  threads: TreeThread[];
}

interface JobChoicesLine {
  type: 'choices';
  choices: JobChoices;
}

interface JobStateLine {
  type: 'state';
  index: number;
  state: JobBatchState;
  runId?: CopyRunId;
  copied?: number;
  skipped?: number;
  error?: string;
}

interface JobDoneLine {
  type: 'done';
  outcome: JobOutcome;
}

type JobLine = JobHeaderLine | JobBatchLine | JobChoicesLine | JobStateLine | JobDoneLine;


//===========================
// Constants
//===========================

/** How many conversations one batch holds.
 *
 * Not a quota figure -- pacing is what keeps a copy inside its allowance, and five batches of
 * two thousand spend per minute exactly what one run of ten thousand spends. This is how much
 * work a stop or a crash may cost, and how many rows a preview has to draw. Two thousand is the
 * number the mailbox owner settled on after a run of 2,574 failed one short of the end. */
export const JOB_BATCH_THREADS = 2000;

const SUFFIX = '.job.jsonl';


//===========================
// Exported functions
//===========================

/**
 * Cuts a planned conversation list into the batches it will be pulled in
 *
 * @param threads in the order the collection produced them, already deduplicated across the
 *   tree's labels
 * @param batchSize
 * @returns one slice per batch, the last one short rather than padded, and nothing at all for
 *   an empty list
 */
export function sliceIntoBatches(threads: TreeThread[], batchSize: number): TreeThread[][] {
  const out: TreeThread[][] = [];
  for (let at = 0; at < threads.length; at += batchSize) {
    out.push(threads.slice(at, at + batchSize));
  }
  return out;
}

/**
 * What every batch after the first is copied with, given what the first one resolved to
 *
 * A named function rather than a ternary at the call site, because it is the one place a
 * permission is inherited. 'all' means the user was shown duplicates and said to copy them
 * anyway. Anything else -- including batch one never raising the question because it had no
 * duplicates -- inherits 'new', which asks Gmail again per batch and skips what is already
 * there. Inheriting 'all' from silence would grant permission nobody gave.
 *
 * @param confirmed what the user answered, or null when they were never asked
 * @returns the mode the remaining batches run with
 */
export function inheritedMode(confirmed: 'new' | 'all' | null): 'new' | 'all' {
  return confirmed === 'all' ? 'all' : 'new';
}

/**
 * Where one job's plan lives
 *
 * @param root the drop folder
 * @param jobId
 */
export function jobPath(root: string, jobId: string): string {
  return join(root, `${jobId}${SUFFIX}`);
}

/**
 * Opens a job's plan with its header and one line per batch
 *
 * @param root the drop folder
 * @param header everything decided before the first batch is pulled
 * @param batches the slices, from sliceIntoBatches
 */
export function startLabelJob(
  root: string,
  header: Omit<LabelJob, 'choices' | 'batches' | 'outcome'>,
  batches: TreeThread[][],
): void {
  writeLine(root, header.jobId, { type: 'header', ...header });
  for (const [index, threads] of batches.entries()) {
    writeLine(root, header.jobId, { type: 'batch', index, threads });
  }
}

/**
 * Records the targets and the duplicate policy batch one was copied with
 *
 * @param root the drop folder
 * @param jobId
 * @param choices
 */
export function recordJobChoices(root: string, jobId: string, choices: JobChoices): void {
  writeLine(root, jobId, { type: 'choices', choices });
}

/**
 * Records one batch reaching a new state, the moment it does
 *
 * @param root the drop folder
 * @param jobId
 * @param at the batch, its new state, and whatever became known with it
 */
export function recordJobBatchState(
  root: string,
  jobId: string,
  at: Omit<JobStateLine, 'type'>,
): void {
  writeLine(root, jobId, { type: 'state', ...at });
}

/**
 * Closes a job's plan with what became of it
 *
 * Left to throw rather than swallowing its own failure, the same as finishCopyJournal: a job
 * reported as finished whose closing line never reached the disk would be offered for
 * resumption at the next start, which is the one thing this line exists to prevent.
 *
 * @param root the drop folder
 * @param jobId
 * @param outcome
 */
export function finishLabelJob(root: string, jobId: string, outcome: JobOutcome): void {
  writeLine(root, jobId, { type: 'done', outcome });
}

/**
 * Reads one job's plan back
 *
 * @param root the drop folder
 * @param jobId
 * @returns the plan, or null when this job never started one
 */
export function readLabelJob(root: string, jobId: string): LabelJob | null {
  let raw: string;
  try {
    raw = readFileSync(jobPath(root, jobId), 'utf8');
  } catch {
    return null;
  }
  return parseLabelJob(raw);
}

/**
 * Parses a plan's own text back into its header, batches, choices and closing line
 *
 * A line that will not parse is skipped rather than losing the rest -- the same leniency
 * parseCopyJournal extends to a file it cannot fully trust. State lines are folded in the order
 * they were written, so the last one for a batch is the one that stands.
 *
 * @param raw the file's contents
 * @returns null when there is no header to anchor the rest to
 */
export function parseLabelJob(raw: string): LabelJob | null {
  let header: JobHeaderLine | null = null;
  const slices = new Map<number, TreeThread[]>();
  const states = new Map<number, Omit<JobStateLine, 'type'>>();
  let choices: JobChoices | null = null;
  let outcome: JobOutcome | null = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const type = (parsed as { type?: unknown })?.type;
    if (type === 'header' && !header) header = parsed as JobHeaderLine;
    else if (type === 'batch') {
      const l = parsed as JobBatchLine;
      slices.set(l.index, Array.isArray(l.threads) ? l.threads : []);
    } else if (type === 'choices') choices = (parsed as JobChoicesLine).choices;
    else if (type === 'state') {
      const { type: _discriminator, ...state } = parsed as JobStateLine;
      states.set(state.index, state);
    } else if (type === 'done') outcome = (parsed as JobDoneLine).outcome;
  }
  if (!header) return null;

  const batches: JobBatch[] = [...slices.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const state = states.get(index);
      // Field by field rather than by spreading the state line over a default: the slice comes
      // from the batch line and never from a state line, since a state line records a transition
      // and not the work, and a spread would let a later line quietly shrink a batch -- or, with
      // its own index in it, move one.
      return {
        index,
        threads: slices.get(index) ?? [],
        state: state?.state ?? 'pending',
        runId: state?.runId,
        copied: state?.copied,
        skipped: state?.skipped,
        error: state?.error,
      };
    });

  return {
    jobId: header.jobId,
    startedAt: header.startedAt,
    account: header.account,
    label: header.label,
    members: header.members ?? [],
    batchSize: header.batchSize,
    total: header.total,
    choices,
    batches,
    outcome,
  };
}

/**
 * Which jobs in the drop folder never reached their closing line
 *
 * A crash and a job still running leave the same file behind, so this is only meaningful at a
 * start, before anything of this app is copying -- exactly where findOrphanedRuns is used.
 *
 * @param root the drop folder
 * @returns each unfinished job, in the order its file was found
 */
export function findUnfinishedJobs(root: string): LabelJob[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.endsWith(SUFFIX));
  } catch {
    return [];
  }
  const open: LabelJob[] = [];
  for (const name of names) {
    let raw: string;
    try {
      raw = readFileSync(join(root, name), 'utf8');
    } catch {
      continue;
    }
    const job = parseLabelJob(raw);
    if (job && !job.outcome) open.push(job);
  }
  return open;
}

/**
 * The batch the driver should work on next
 *
 * A batch that was pulled but never copied is where a crash lands, and it is the one to resume
 * -- not the one after it. A batch that failed stops the job: stepping over it would be the
 * driver walking past a mailbox that just refused us.
 *
 * @param job
 * @returns the batch, or null when the job is finished or stuck
 */
export function nextBatch(job: LabelJob): JobBatch | null {
  for (const batch of job.batches) {
    if (batch.state === 'failed') return null;
    if (batch.state !== 'copied') return batch;
  }
  return null;
}

/**
 * How far the whole job has got, for the strip above the picker
 *
 * Counted in conversations, matching what the drop progress already counts, and off the copied
 * batches rather than a running tally so a resumed job reports the same number the one before
 * it did.
 *
 * @param job
 * @returns the batch being worked on (one-based, because it is read out to a person), how many
 *   there are, and the conversations behind and in total
 */
export function jobProgress(job: LabelJob): {
  batch: number;
  batches: number;
  done: number;
  total: number;
} {
  const copied = job.batches.filter((b) => b.state === 'copied');
  const at = nextBatch(job);
  return {
    batch: (at?.index ?? job.batches.length - 1) + 1,
    batches: job.batches.length,
    done: copied.reduce((sum, b) => sum + b.threads.length, 0),
    total: job.total,
  };
}


//===========================
// Helper functions
//===========================

function writeLine(root: string, jobId: string, line: JobLine): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(jobPath(root, jobId), JSON.stringify(line) + '\n', 'utf8');
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/label-job.test.ts`
Expected: PASS.

Then: `npm test` and `npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0. Nothing imports this module yet.

- [x] **Step 5: Commit**

```bash
git add electron/mail/label-job.ts tests/label-job.test.ts
git commit -m "feat(maildrop): the plan behind a label too big for one run

Which conversations, cut into which batches, copied with which choices,
and how far it got -- appended a line at a time for the reason
copy-journal.ts gives for itself: the moment that matters is the
transition, and a missing closing line is the only thing that tells a
crashed job from a finished one.

The conversation list is written once, at plan time, one line per batch.
The batches are slices of a list that was true at one instant, so mail
arriving mid-job cannot shift the boundaries underneath it and a resumed
job asks for the same ids. Nothing here decides anything about
duplicates: inheritedMode carries a permission the user gave and never
invents one.

Nothing imports this yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Split listing a label from fetching it

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` — `collectLabelViaApi` splits in two; `saveLabel` takes a slice

**Interfaces:**
- Consumes: `API_MAX_THREADS` from Task 1.
- Produces, both private to the controller:
  - `async function listLabelTree(account: string, label: string): Promise<{ threads: TreeThread[]; members: string[]; capped: boolean; cap: number } | null>` — the listing alone, no mail fetched. Null when the account has no usable token or the label is not in its map, which is the existing signal to fall back to the scrape.
  - `async function fetchThreadSlice(account: string, slice: TreeThread[], report: SaveProgress): Promise<CollectedThread[] | null>` — the fetching alone.
  - `saveLabel` gains a parameter `slice: TreeThread[] | null`. Null means today's behaviour: list, then fetch everything listed.

**Why:** the two halves cost wildly different things and are needed at different moments. Listing a 10,000-thread tree is 100 pages and 1,000 units — four seconds of budget — and it is what the plan needs before a single mail is fetched. Fetching is `threads.get` per conversation and it is the expensive half. Today they are one function, so there is no way to know what a label holds without pulling all of it.

**Behaviour must not change in this task.** `saveLabel(…, null)` lists and then fetches everything, which is exactly what it does now. That is what makes this a refactor with a test suite that should not move.

- [x] **Step 1: Extract the listing**

Take the `try` block at the top of `collectLabelViaApi` — from `const all = await withToken(...)` through the `for (const member of members)` loop — and make it its own function above `collectLabelViaApi`:

```ts
/**
 * Lists every conversation of a dragged label's tree, without fetching any of them
 *
 * The cheap half of a label drag, and the half a batched job needs on its own: one
 * `threads.list` page is 100 ids for 10 units, so a tree of ten thousand is a hundred pages and
 * a thousand units -- four seconds of the budget, against the minutes fetching them costs. That
 * is what lets a plan know which conversations it is going to pull before it pulls one.
 *
 * @param account the mailbox the label was dragged out of
 * @param label the dragged label, whose tree is resolved from the mailbox's own label map
 * @returns the conversations with the tree labels each of them carries, the members in the
 *   order the tree resolved them, and whether the cap bit -- or null when this mailbox has no
 *   usable token or does not have the label, which is the caller's signal to scrape instead
 * @private
 */
async function listLabelTree(
  account: string,
  label: string,
): Promise<{ threads: TreeThread[]; members: string[]; capped: boolean; cap: number } | null> {
  if (!account) return null;
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  const threads: TreeThread[] = [];
  let capped = false;
  try {
    const all = await withToken((token) => fetchUserLabelMap(token));
    const members = labelTreeMembers([...all.keys()], label);
    if (members.length === 0) return null;
    // One listing per member, folded into one accumulator: the cap counts the tree, and a
    // conversation in two of its labels is one conversation carrying both.
    for (const member of members) {
      const labelId = all.get(member);
      if (!labelId) continue;
      const list = await withToken((token) => listLabelThreadIds(token, labelId, API_MAX_THREADS));
      const page = list.threadIds.map((threadId) => ({ threadId, subject: '' }));
      const { total } = mergeTreeThreads(threads, member, page, API_MAX_THREADS);
      capped = capped || list.capped;
      if (total >= API_MAX_THREADS) {
        capped = true;
        break;
      }
    }
    return { threads, members, capped, cap: API_MAX_THREADS };
  } catch {
    return null;
  }
}
```

- [x] **Step 2: Extract the fetching**

The rest of `collectLabelViaApi` — the `mapLimit` over `threads` — becomes:

```ts
/**
 * Fetches the mail of conversations already listed
 *
 * @param account
 * @param slice the conversations to fetch, which for a job is one batch of the plan and for an
 *   ordinary drag is everything listLabelTree answered
 * @param report moved on per conversation, in a finally, so one that could not be fetched still
 *   advances the count -- a counter that stops on a failure reads as a pull that hung
 * @returns one entry per conversation in `slice`, or null when the mailbox has no usable token
 * @private
 */
async function fetchThreadSlice(
  account: string,
  slice: TreeThread[],
  report: SaveProgress,
): Promise<CollectedThread[] | null> {
  const withToken = await withMailboxToken(account);
  if (!withToken) return null;

  let pulled = 0;
  report(0, slice.length);
  return await mapLimit(slice, THREAD_FETCH_LIMIT, async (thread) => {
    const { threadId } = thread;
    try {
      const raws = await withToken((token) => fetchThreadRaw(token, threadId));
      const messages: SavedMessage[] = raws.map((raw) => ({
        raw,
        headers: parseHeaders(raw.toString('utf8')),
      }));
      return {
        thread: { ...thread, subject: messages[0]?.headers.subject || NO_SUBJECT },
        messages,
        error: messages.length === 0 ? 'Geen bericht in dit gesprek' : undefined,
      };
    } catch (e) {
      return {
        thread: { ...thread, subject: '' },
        messages: [],
        error: `Ophalen mislukt (${(e as Error).message})`,
      };
    } finally {
      pulled += 1;
      report(pulled, slice.length);
    }
  });
}
```

Then delete `collectLabelViaApi` itself — the two functions above replace it in full.

- [x] **Step 3: Let saveLabel take a slice**

`saveLabel`'s signature gains **two** parameters after `report`. Two and not one: the caller has to list before it can decide whether this label needs a plan at all, so the listing already exists by the time `saveLabel` runs. Letting `saveLabel` list again for every label that turned out not to need a plan would double the `threads.list` pages of every ordinary label drag — which is the whole cheap half, done twice for nothing.

```ts
async function saveLabel(
  ts: string,
  account: string,
  root: string,
  label: string,
  authuser: string,
  ik: string,
  report: SaveProgress,
  /** What listLabelTree already answered for this drag, handed in rather than asked for again.
   * The caller has to list before it can decide whether this label needs a plan at all, and
   * listing twice would double the threads.list pages of every ordinary label drag. Null for a
   * job's later batch, which has no fresh listing and does not need one. */
  listed: Awaited<ReturnType<typeof listLabelTree>>,
  /** One batch of a job's plan, or null for an ordinary drag, which fetches everything the
   * listing above answered. Null is what keeps a label that fits in one batch byte-for-byte
   * today's drag. */
  slice: TreeThread[] | null,
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; rows: number[] }> {
```

and its `viaApi` block becomes:

```ts
  const toFetch = slice ?? listed?.threads ?? null;
  const viaApi =
    toFetch === null
      ? null
      : await fetchThreadSlice(account, toFetch, report).then((collected) =>
          collected === null
            ? null
            : {
                collected,
                members: listed?.members ?? lastDropTree?.members.map((m) => m.name) ?? [label],
                capped: listed?.capped ?? false,
                cap: listed?.cap ?? API_MAX_THREADS,
              },
        );
```

The `members` fallback matters: a job's later batch has no fresh listing, and the tree it belongs to was already resolved at plan time. Task 4 makes sure `lastDropTree` is set for every batch of a job, so this fallback is only ever reached with a real answer behind it.

Everything below in `saveLabel` — the `if (viaApi)` branch, the scrape branch, the truncation messages — stays as it is, except that the two messages now interpolate `cap` (from Task 1, Step 4) rather than a constant.

- [x] **Step 4: Update the one call site**

`pullMailDrop`'s label branch calls `saveLabel(ts, account, root, payload.label, payload.authuser, payload.ik, report)`. Add two arguments: the listing, and the slice. In this task there is no caller that has a listing yet, so it lists here and passes `null` for the slice — Task 4 moves the listing up so the plan decision can read it:

```ts
    const listed = await listLabelTree(account, payload.label);
    const { items: done, saved: refs, rows } = await saveLabel(
      ts, account, root, payload.label, payload.authuser, payload.ik, report, listed, null,
    );
```

Nothing else changes in this task, and behaviour is identical: one listing, then everything it listed is fetched.

- [x] **Step 5: Verify nothing moved**

Run: `npm test`
Expected: PASS, 1902 or more. This task is a refactor; a moved test is a bug in the refactor.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add electron/mail/mail-drop-controller.ts
git commit -m "refactor(maildrop): separate listing a label's tree from fetching it

The two halves cost wildly different things and are wanted at different
moments. Listing ten thousand conversations is a hundred threads.list
pages and a thousand units, four seconds of budget; fetching them is the
minutes. As one function there was no way to learn what a label holds
without pulling all of it, which is what a batched plan has to do first.

Behaviour is unchanged: saveLabel with a null slice lists and then
fetches everything it listed, exactly as before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Write the plan at drop time, pull only the first batch

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` — `pullMailDrop`'s label branch, `EXISTING_SCAN_LIMIT`
- Test: `tests/label-job.test.ts` (append)

**Interfaces:**
- Consumes: `sliceIntoBatches`, `startLabelJob`, `recordJobBatchState`, `JOB_BATCH_THREADS`, `LabelJob` from Task 2; `listLabelTree`, `fetchThreadSlice`, `saveLabel(…, slice)` from Task 3.
- Produces: `let activeJob: { job: LabelJob; root: string } | null` — module state in the controller, the job the driver in Task 5 advances. Null whenever no job is running, which includes every label that fits in one batch.

**Why:** this is where the safety property is decided. A label whose listing fits in one batch writes no plan, sets no `activeJob`, and goes down exactly today's path.

- [x] **Step 1: Write the failing test**

The plan-or-not decision is the part worth testing without Electron, so give it its own pure function and test it. Append to `tests/label-job.test.ts`:

```ts
describe('needsJob', () => {
  // The safety property, as a test: a label that fits is not a job at all, so no plan file is
  // written, no driver runs, and the drag is byte-for-byte today's drag.
  it('is false for a label that fits in one batch', () => {
    expect(needsJob(threads(2000), 2000)).toBe(false);
    expect(needsJob(threads(1), 2000)).toBe(false);
    expect(needsJob([], 2000)).toBe(false);
  });

  it('is true one conversation past the batch size', () => {
    expect(needsJob(threads(2001), 2000)).toBe(true);
  });
});
```

Add `needsJob` to the import from `../electron/mail/label-job`.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/label-job.test.ts`
Expected: FAIL — `needsJob` is not exported.

- [x] **Step 3: Add the decision to label-job.ts**

Beside `sliceIntoBatches`:

```ts
/**
 * Whether a listed label is big enough to be worth a plan
 *
 * The boundary the whole change rests on. At or under the batch size there is no plan file, no
 * driver and no job progress, and the drag is byte-for-byte the one this app already made -- so
 * everything a job adds can only ever be reached by a label that genuinely did not fit.
 *
 * @param threads what the listing answered
 * @param batchSize
 * @returns true when the list has to be cut
 */
export function needsJob(threads: TreeThread[], batchSize: number): boolean {
  return threads.length > batchSize;
}
```

- [x] **Step 4: Plan the job in pullMailDrop**

`pullMailDrop`'s label branch is today:

```ts
  if (payload.label) {
    report(0, 0);
    const { items: done, saved: refs, rows } = await saveLabel(
      ts, account, root, payload.label, payload.authuser, payload.ik, report, null,
    );
    lastDropSaved = refs;
    manager?.sendDropResult(acctKey, dropOutcome(rows, done.find((i) => i.error)?.error));
    openDropPreview(done);
    startExistingScan();
    return;
  }
```

It becomes:

```ts
  if (payload.label) {
    report(0, 0);
    // Listed before anything is fetched, so the size is known while it is still cheap to know:
    // a tree of ten thousand costs a thousand units to list and minutes to pull. A listing that
    // fails answers null and the scrape inside saveLabel carries the drag, as it always has --
    // which also means no job, since nothing scraped can exceed one batch.
    const listed = await listLabelTree(account, payload.label);
    const slice = await planJob(root, account, payload.label, listed);
    const { items: done, saved: refs, rows } = await saveLabel(
      ts, account, root, payload.label, payload.authuser, payload.ik, report, slice,
    );
    lastDropSaved = refs;
    manager?.sendDropResult(acctKey, dropOutcome(rows, done.find((i) => i.error)?.error));
    openDropPreview(done);
    startExistingScan();
    return;
  }
```

with `planJob` above `pullMailDrop`:

```ts
/**
 * Decides whether this label needs a plan, and writes one if it does
 *
 * @param root the drop folder
 * @param account
 * @param label
 * @param listed what listLabelTree answered, or null when it could not list at all
 * @returns the slice to pull now -- batch zero for a job, or null for a label that fits, which
 *   is what makes saveLabel list and fetch everything the way it always has
 * @private
 */
async function planJob(
  root: string,
  account: string,
  label: string,
  listed: Awaited<ReturnType<typeof listLabelTree>>,
): Promise<TreeThread[] | null> {
  activeJob = null;
  if (!listed || !needsJob(listed.threads, JOB_BATCH_THREADS)) return null;

  const batches = sliceIntoBatches(listed.threads, JOB_BATCH_THREADS);
  const jobId = randomUUID();
  const header = {
    jobId,
    startedAt: Date.now(),
    account,
    label,
    members: listed.members,
    batchSize: JOB_BATCH_THREADS,
    total: listed.threads.length,
  };
  // Written before a single mail is fetched: the plan is what a crash halfway through the first
  // batch is resumed from, and a plan written afterwards would not exist yet at the one moment
  // it is needed.
  try {
    startLabelJob(root, header, batches);
  } catch (e) {
    // A plan that cannot be written is not a reason to refuse the drag -- it is a reason to make
    // it an ordinary one. The label is then capped at a batch, and the truncation is reported
    // the way every other cap already is.
    notifyLog(`[maildrop] kon het plan voor "${label}" niet wegschrijven: ${(e as Error).message}`);
    return batches[0];
  }
  // Read back rather than assembled in memory, so what the driver walks is what is on disk. A
  // read that fails right after a successful write is not a state to invent a job for -- fall
  // back to the same ordinary drag a failed write gets, since a job whose plan cannot be read
  // cannot be advanced or resumed either.
  const planned = readLabelJob(root, jobId);
  if (!planned) {
    notifyLog(`[maildrop] plan voor "${label}" niet terug te lezen; als gewone sleep behandeld`);
    return batches[0];
  }
  activeJob = { job: planned, root };
  notifyLog(
    `[maildrop] label "${label}": ${listed.threads.length} gesprekken, ${batches.length} batches van ${JOB_BATCH_THREADS}`,
  );
  return batches[0];
}
```

Declare the module state beside `activeRun`:

```ts
/** The job the driver is advancing, or null when this drag was not big enough to need one. One
 * at a time, always: the drop lock admits one pull and a job never overlaps its own batches. */
let activeJob: { job: LabelJob; root: string } | null = null;
```

`randomUUID` is already imported in this file for `runId`.

- [x] **Step 5: Move the duplicate scan's limit onto the batch**

`EXISTING_SCAN_LIMIT` was pointed at `SCRAPE_MAX_THREADS` in Task 1. The most a single pull can now produce is a batch, so:

```ts
// Above this the picker says nothing about duplicates at all, so it is set above the most a
// single pull can produce -- which is one batch of a job, or a scrape's own ceiling for a label
// small enough not to be one. It used to be ten, which meant a drag of a hundred rows was
// reported on for none of them. What made this affordable is the batched query -- ten
// Message-IDs per search instead of one -- and that the scan runs from the drop rather than from
// the click, so its cost is paid while the window is still drawing.
const EXISTING_SCAN_LIMIT = Math.max(JOB_BATCH_THREADS, SCRAPE_MAX_THREADS);
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/label-job.test.ts`
Expected: PASS.

Then: `npm test` and both tsc projects.
Expected: PASS, exit 0. A label under 2,000 is untouched; a bigger one now pulls its first 2,000 and leaves a plan on disk that nothing yet advances.

- [x] **Step 7: Commit**

```bash
git add electron/mail/label-job.ts electron/mail/mail-drop-controller.ts tests/label-job.test.ts
git commit -m "feat(maildrop): plan a big label into batches and pull the first one

Listing happens before anything is fetched, so the size is known while it
is still cheap to know, and a label past one batch gets a plan on disk
before a single mail is pulled -- a plan written afterwards would not
exist at the one moment a crash needs it.

needsJob is the boundary the whole change rests on: at or under the batch
size there is no plan, no driver and no job progress, and the drag is
byte-for-byte the one this app already made.

Nothing advances the plan yet: a big label pulls its first batch and
stops there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The driver, batch after batch

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` — `copyToMailboxes`'s tail, and a new `advanceJob`

**Interfaces:**
- Consumes: `activeJob`, `nextBatch`, `recordJobChoices`, `recordJobBatchState`, `finishLabelJob`, `inheritedMode`, `readLabelJob` from Tasks 2 and 4.
- Produces: `async function advanceJob(): Promise<void>` — private to the controller. Pulls and copies every remaining batch, one at a time, and closes the plan.

**Why the driver hangs off the end of the copy rather than off a timer or the pull:** the user's confirmation is the gate. Batch zero is copied because a person pressed Kopieer; everything after it is copied because that press said so. Starting the driver anywhere else would mean copying before the choices existed.

- [x] **Step 1: Remember what batch zero was copied with**

At the point in `copyToMailboxes` where the copy has been accepted and the run is about to start — immediately after the `mode === 'check' && hits.length > 0` early return, before `const runId` is minted — record the choices, once per job:

```ts
  // Recorded the moment the copy is accepted rather than when it finishes: these are the
  // choices, and a crash between here and the end of batch zero must resume with them rather
  // than ask again. Only the first batch writes them; every later one is running because of
  // them.
  if (activeJob && !activeJob.job.choices) {
    const choices = { targets, mode: inheritedMode(mode === 'all' ? 'all' : mode === 'new' ? 'new' : null) };
    const failed = attemptWrite(() => recordJobChoices(activeJob!.root, activeJob!.job.jobId, choices));
    if (failed) notifyLog(`[maildrop] kon de keuzes van de klus niet vastleggen: ${failed}`);
    activeJob.job = { ...activeJob.job, choices };
  }
```

Note what is passed to `inheritedMode`: `'check'` maps to `null`, not to `'new'`. `'check'` reaching this line means the scan found nothing to confirm, so the user was never asked — which is exactly the case `inheritedMode` turns into `'new'`. Writing `'new'` directly here would work today and would be wrong the moment a fourth mode exists; the mapping belongs in the one function that owns the rule.

- [x] **Step 2: Record the batch, and hand over to the driver**

At the very end of `copyToMailboxes` the job's batch has finished. There is exactly one return path to widen — the function ends in `try { return await runCopy(); } finally { if (activeRun?.runId === runId) activeRun = null; }`, and every other `return` in the region belongs to `runCopy` itself or to a helper. Capture the result inside that `try`, do the bookkeeping, then return it, leaving the `finally` untouched:

```ts
  try {
    const result = await runCopy();
    // the block below
    return result;
  } finally {
    if (activeRun?.runId === runId) activeRun = null;
  }
```

and the block is:

```ts
  // The batch is only 'copied' once the copy answered, whatever it answered: a batch that
  // failed outright is recorded as failed and nextBatch then stops the job rather than trying
  // the next two thousand into a mailbox that just refused us.
  if (activeJob) {
    const at = nextBatch(activeJob.job);
    if (at) {
      const stopped = 'stopped' in result && result.stopped;
      const failedHard = !stopped && 'ok' in result && !result.ok;
      const failed = attemptWrite(() =>
        recordJobBatchState(activeJob!.root, activeJob!.job.jobId, {
          index: at.index,
          state: failedHard ? 'failed' : 'copied',
          runId,
          copied: 'copied' in result ? result.copied : undefined,
          skipped: 'skipped' in result ? result.skipped : undefined,
          error: failedHard ? (result as MailDropCopyResult).error : undefined,
        }),
      );
      if (failed) notifyLog(`[maildrop] kon de stand van batch ${at.index} niet vastleggen: ${failed}`);
      activeJob.job = readLabelJob(activeJob.root, activeJob.job.jobId) ?? activeJob.job;
      // A stop is the user's final word on the whole job, not just on this batch, so the driver
      // is not started. Task 6 decides what the stop rolls back.
      if (!stopped) void advanceJob();
    }
  }
  return result;
```

- [x] **Step 3: Write the driver**

Beside `advanceJob`'s callers:

```ts
/**
 * Pulls and copies every batch left in the running job, one at a time
 *
 * Not a loop over a list but a walk over the plan on disk: each turn asks it what is next, so a
 * batch recorded as failed or a job that was closed underneath this stops it, and nothing has to
 * be kept in memory that a crash would take with it.
 *
 * One batch at a time on purpose, never overlapping the next pull with this copy. The two would
 * spend different mailboxes' quota and overlapping would nearly halve the wall clock, but
 * `lastDropSaved`, `lastDropPreview`, `lastDropTree` and `dropSerial` are module-level and built
 * for one drag -- which is exactly what re-entering the ordinary pull per batch relies on.
 *
 * @private
 */
async function advanceJob(): Promise<void> {
  while (activeJob) {
    const { job, root } = activeJob;
    const at = nextBatch(job);
    if (!at) break;
    if (!job.choices) break; // nothing to copy with; batch zero never got its answer

    const token = dropLock.take(Date.now());
    if (token === null) {
      notifyLog('[maildrop] klus wacht: er wordt al mail opgehaald');
      return;
    }
    manager?.sendDropLock({ locked: true });
    try {
      const ts = new Date().toISOString();
      dropSerial += 1;
      lastDropSaved = [];
      const report: SaveProgress = (done, total) => manager?.sendDropProgress({ done, total });
      // No listing for a later batch: the plan already holds the conversations, and asking Gmail
      // again would both cost a hundred pages and risk a different answer than the one the
      // batches were cut from.
      const { items, saved, rows } = await saveLabel(
        ts, job.account, root, job.label, '', '', report, null, at.threads,
      );
      lastDropSaved = saved;
      recordJobBatchState(root, job.jobId, { index: at.index, state: 'pulled' });
      activeJob.job = readLabelJob(root, job.jobId) ?? job;
      openDropPreview(items);
      void rows;
    } finally {
      if (dropLock.release(token)) manager?.sendDropLock({ locked: false });
    }

    // The same call the picker's own Kopieer makes, with the choices batch zero was given. The
    // duplicate scan runs again inside it, per batch, against that batch's own mail -- which is
    // what keeps "which mail lands where" the live answer it has always been.
    const result = await copyToMailboxes({ targets: job.choices.targets, mode: job.choices.mode });
    if ('stopped' in result && result.stopped) return;
  }

  if (activeJob && !nextBatch(activeJob.job)) {
    const { job, root } = activeJob;
    const stuck = job.batches.some((b) => b.state === 'failed');
    // A job stopped by a failed batch is left open on purpose -- no closing line. The picker
    // already shows that batch's own failure now, and the missing line is what makes the next
    // start offer to continue, keep or undo it. Closing it here would swallow the one state the
    // user still has to answer for, which is the whole reason a failed batch stops the walk
    // instead of stepping over it.
    if (!stuck) {
      const failed = attemptWrite(() => finishLabelJob(root, job.jobId, 'completed'));
      if (failed) notifyLog(`[maildrop] kon de klus niet afsluiten: ${failed}`);
    }
    notifyLog(
      `[maildrop] klus voor "${job.label}" ${stuck ? 'gestopt op een mislukte batch, blijft open voor een keuze' : 'afgerond'}: ${job.batches.filter((b) => b.state === 'copied').length} van ${job.batches.length} batches`,
    );
    activeJob = null;
  }
}
```

`authuser` and `ik` are empty on that `saveLabel` call, which looks like an omission and is not: a job only ever exists on the API path — a scrape can never produce more than one batch — and those two arguments are the scrape's.

**The walk needs a re-entrancy guard, and it is not optional.** The loop above awaits `copyToMailboxes`, and that function's tail starts the driver. Without a guard the walk forks on every batch: the loop continues *and* the tail starts a second walk, and the two fight over the drop lock — one of them losing it and logging a wait nobody caused. So the exported entry point owns a flag and the walking is a separate function:

```ts
let jobDriving = false;

async function advanceJob(): Promise<void> {
  if (jobDriving) return;
  jobDriving = true;
  try {
    await walkJob();
  } finally {
    jobDriving = false;
  }
}
```

with everything above living in `walkJob`. The tail of `copyToMailboxes` then starts the driver for the batch the user pressed Kopieer on — where the flag is false — and never for the ones the driver is already pulling itself, where it is true.

- [x] **Step 4: Verify**

Run: `npm test`
Expected: PASS. No unit test reaches the driver — it is Electron-bound, `manager`-bound and network-bound. That is stated in the spec's Tests section and the live run is its gate.

Run both tsc projects.
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add electron/mail/mail-drop-controller.ts
git commit -m "feat(maildrop): drive a planned label batch after batch

The driver hangs off the end of the copy rather than off the pull or a
timer, because the user's confirmation is the gate: batch zero is copied
because a person pressed Kopieer, and every batch after it is copied
because that press said so.

Each turn asks the plan on disk what is next rather than looping over a
list in memory, so a failed batch or a job closed underneath it stops the
walk. One batch at a time, never overlapping the next pull with this
copy: the two spend different mailboxes' quota and overlapping would
nearly halve the wall clock, but the drag state this re-enters is
module-level and built for one drag.

The duplicate scan runs again per batch, against that batch's own mail,
so which mail lands where stays the live answer it has always been.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Stopping — this batch, or all of them

**Files:**
- Modify: `electron/core/ipc.ts` — `MailDropCopyControlAction`
- Modify: `electron/sidebar-preload.ts:149` — `controlMailDropCopy` spells the action union out literally
- Modify: `electron/mail/mail-drop-controller.ts` — `controlCopyRun`, and a job-wide sweep
- Modify: `renderer/app/maildrop/page.tsx` — the stop dialog

**Interfaces:**
- Consumes: `activeJob` from Task 4.
- Produces: `MailDropCopyControlAction` becomes `'pause' | 'resume' | 'stop-keep' | 'stop-rollback-batch' | 'stop-rollback-job'`. `'stop-rollback'` stops existing.

**Why:** inside a job `'stop-rollback'` is ambiguous, and the user asked to be given the choice at the moment of stopping rather than having it decided for them. A plain drag has one batch and therefore one meaning, so it keeps two buttons; a job shows three.

- [ ] **Step 1: Split the action**

In `electron/core/ipc.ts`:

```ts
/** What the paused dialog may ask the copy in flight to do. The two stop actions used to be
 * one: inside a batched job 'stop-rollback' is ambiguous, so it names its scope. A plain drag is
 * one batch, where the two scopes mean the same thing, and the picker offers only the batch one
 * there. */
export type MailDropCopyControlAction =
  | 'pause'
  | 'resume'
  | 'stop-keep'
  | 'stop-rollback-batch'
  | 'stop-rollback-job';
```

The preload writes the same union out by hand rather than importing it, so it has to move with it. `electron/sidebar-preload.ts:149`:

```ts
  controlMailDropCopy: (
    action: 'pause' | 'resume' | 'stop-keep' | 'stop-rollback-batch' | 'stop-rollback-job',
  ): Promise<unknown> => ipcRenderer.invoke(IPC.MAIL_DROP_COPY_CONTROL, { action }),
```

Miss this and the renderer's call typechecks against the old union while the main process no longer answers to it — a stop that silently does nothing.

- [ ] **Step 2: Act on the scope**

`controlCopyRun`'s two rollback cases:

```ts
    case 'stop-rollback-batch':
      control.stop('rollback');
      return { ok: true };
    case 'stop-rollback-job':
      // The running batch is rolled back by the run's own stop, exactly as a plain drag is. The
      // batches already finished are a separate sweep, started once this run has drained --
      // running both at once would have two sweeps trashing under two markers in one mailbox.
      rollbackWholeJob = true;
      control.stop('rollback');
      return { ok: true };
```

with, beside `activeJob`:

```ts
/** Set when the stop the user chose was job-wide. Read once the running batch's own rollback has
 * finished, which is the only moment the earlier batches may be swept: two sweeps trashing under
 * two markers in one mailbox at once is a race with nothing to gain. */
let rollbackWholeJob = false;
```

and in `advanceJob`'s closing block — reached because a stop returns before the loop continues — plus at the tail of `copyToMailboxes` where a stopped result is handled, call:

```ts
/**
 * Rolls back every batch of the running job that had already finished
 *
 * Newest first, so a mailbox the sweep cannot reach costs the most recent work rather than the
 * oldest. Each batch is swept from its own journal and its own recorded marker id -- nothing is
 * inferred, and a batch whose journal is gone is reported rather than guessed at.
 *
 * @param job
 * @param root the drop folder
 * @returns the batches it could not account for, for the message the picker shows
 * @private
 */
async function rollbackFinishedBatches(job: LabelJob, root: string): Promise<string[]> {
  const trouble: string[] = [];
  const finished = job.batches.filter((b) => b.state === 'copied' && b.runId).reverse();
  for (const batch of finished) {
    const journal = readCopyJournal(root, batch.runId!);
    if (!journal) {
      trouble.push(`batch ${batch.index + 1}: geen journaal meer`);
      continue;
    }
    const outcome = await sweepRunMarkers(journal.runId, journal.markers, 'trash', journal.created);
    if (!settled(outcome) || !outcome.complete) trouble.push(`batch ${batch.index + 1}`);
    finishCopyJournal(
      root,
      journal.runId,
      outcome.complete ? 'rolled-back' : 'rolled-back-partial',
    );
  }
  return trouble;
}
```

Then where a stopped result ends the job, close the plan with the honest outcome:

```ts
  if (activeJob && 'stopped' in result && result.stopped) {
    const { job, root } = activeJob;
    const trouble = rollbackWholeJob ? await rollbackFinishedBatches(job, root) : [];
    const outcome: JobOutcome =
      result.mode === 'keep'
        ? 'kept'
        : trouble.length === 0
          ? 'rolled-back'
          : 'rolled-back-partial';
    const failed = attemptWrite(() => finishLabelJob(root, job.jobId, outcome));
    if (failed) notifyLog(`[maildrop] kon de klus niet afsluiten: ${failed}`);
    if (trouble.length > 0) notifyLog(`[maildrop] niet alles teruggedraaid: ${trouble.join(', ')}`);
    rollbackWholeJob = false;
    activeJob = null;
  }
```

- [ ] **Step 3: Offer the choice in the picker**

`StopConfirm` gains one prop and one button. Its signature:

```ts
function StopConfirm({
  phase,
  job,
  onKeepCopying,
  onStopAndKeep,
  onStopAndTrashBatch,
  onStopAndTrashJob,
}: {
  phase: CopyProgress;
  /** Present only during a batched job, which is the only case where the two rollback scopes
   * mean different things. A plain drag is one batch and gets the two buttons it always had. */
  job?: { batch: number; batches: number; done: number; total: number };
  onKeepCopying: () => void;
  onStopAndKeep: () => void;
  onStopAndTrashBatch: () => void;
  onStopAndTrashJob: () => void;
}) {
```

The existing "Stoppen en naar de prullenbak verplaatsen" button becomes:

```tsx
        <button
          onClick={onStopAndTrashBatch}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          {job
            ? `Stoppen en alleen batch ${job.batch} naar de prullenbak`
            : 'Stoppen en naar de prullenbak verplaatsen'}
        </button>
        {job && job.batch > 1 && (
          <button
            onClick={onStopAndTrashJob}
            className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
          >
            Stoppen en alle {job.done} gekopieerde berichten naar de prullenbak
          </button>
        )}
```

The `job.batch > 1` guard is not cosmetic: during the first batch the two scopes are the same action, and offering both would ask the user to choose between identical outcomes.

Below the existing 30-days note, when `job` is present and `job.batch > 1`, add the expectation the spec asks for:

```tsx
      {job && job.batch > 1 && (
        <p className="text-xs text-neutral-500">
          Alles terugdraaien duurt even: {job.done} berichten uit de prullenbak halen is nog een
          paar minuten werk.
        </p>
      )}
```

Then `controlCopy`'s type and the two handlers at lines 249 and 253 follow the new action names, and a third handler is added for the job scope.

- [ ] **Step 4: Verify**

Run: `npm test`, then both tsc projects.
Expected: PASS and exit 0. `tests/*` do not reference `'stop-rollback'`; if any does, it must move to `'stop-rollback-batch'`, which is the same behaviour it asserted before.

- [ ] **Step 5: Commit**

```bash
git add electron/core/ipc.ts electron/mail/mail-drop-controller.ts renderer/app/maildrop/page.tsx
git commit -m "feat(maildrop): let a stop choose between this batch and the whole job

Inside a batched job 'stop-rollback' was ambiguous, so it names its
scope. The running batch is rolled back by the run's own stop exactly as
a plain drag is; the batches already finished are a separate sweep,
started only once that run has drained -- two sweeps trashing under two
markers in one mailbox at once is a race with nothing to gain.

Each finished batch is swept from its own journal and its own recorded
marker id, newest first, so a mailbox the sweep cannot reach costs the
most recent work rather than the oldest. A plain drag keeps the two
buttons it had, and during the first batch the job button is hidden:
there the two scopes are the same action.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Progress that does not restart five times

**Files:**
- Modify: `electron/core/ipc.ts` — `MailDropCopyProgress`
- Modify: `electron/mail/mail-drop-controller.ts` — the two places that send progress
- Modify: `renderer/app/maildrop/page.tsx` — `CopyProgress` and the status line

**Interfaces:**
- Consumes: `jobProgress` from Task 2, `activeJob` from Task 4.
- Produces: `MailDropCopyProgress` gains `job?: { batch: number; batches: number; done: number; total: number }`.

**Why:** the bar counts one batch. Without the job's own numbers beside it, a job of five batches draws a bar that fills and restarts five times, which reads as four failures.

- [ ] **Step 1: Widen the payload**

In `electron/core/ipc.ts`:

```ts
export interface MailDropCopyProgress {
  phase: 'check' | 'copy' | 'rollback';
  done: number;
  total: number;
  paused?: boolean;
  byMailbox?: { email: string; copied: number }[];
  /** Present only while a batched job is running. `done` and `total` above count the batch on
   * screen; these count the whole job, in conversations, so a bar that fills five times still
   * reads as one piece of work. */
  job?: { batch: number; batches: number; done: number; total: number };
}
```

- [ ] **Step 2: Send it**

Both senders — the `progress` closure inside `copyToMailboxes` and `sendPausedProgress` — gain the same one field. Add a helper beside `sendPausedProgress` so the shape is decided once:

```ts
/**
 * The running job's own numbers, for the strip that draws above one batch's bar
 *
 * @returns the job's progress, or undefined when this is a plain drag -- which is what makes the
 *   picker draw exactly the line it drew before jobs existed
 * @private
 */
function jobProgressForSend(): MailDropCopyProgress['job'] {
  return activeJob ? jobProgress(activeJob.job) : undefined;
}
```

and both senders add `job: jobProgressForSend(),`.

- [ ] **Step 3: Draw it**

In `renderer/app/maildrop/page.tsx`, `CopyProgress` gains the same optional field:

```ts
interface CopyProgress {
  phase: 'check' | 'copy' | 'rollback';
  done: number;
  total: number;
  paused?: boolean;
  byMailbox?: ByMailbox[];
  /** Present only during a batched job; absent for a plain drag, which draws the line it
   * always did. */
  job?: { batch: number; batches: number; done: number; total: number };
}
```

In the status line, the `phase.kind === 'copying'` branch. The paused case becomes:

```tsx
    if (phase.paused) {
      return (
        <span className="text-xs text-amber-700 dark:text-amber-500">
          Gepauzeerd — {phase.job ? phase.job.done : phase.done}{' '}
          {(phase.job ? phase.job.done : phase.done) === 1 ? 'bericht' : 'berichten'} al
          gekopieerd
        </span>
      );
    }
```

and the running case gains the batch clause ahead of the count:

```tsx
    const text =
      phase.total > 0 ? `${doing}: ${phase.done} van ${phase.total}` : `${doing}…`;
    return (
      <span className="text-xs text-neutral-500">
        {phase.job && `Batch ${phase.job.batch} van ${phase.job.batches} — `}
        {text}
        {phase.job && ` (${phase.job.done} van ${phase.job.total} in totaal)`}
      </span>
    );
```

Finally, `StopConfirm`'s `job` prop from Task 6 is fed from `phase.job` where it is rendered — the two tasks meet exactly there, and neither invents a second source for it.

- [ ] **Step 4: Verify**

Run: `npm test`, then both tsc projects.
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add electron/core/ipc.ts electron/mail/mail-drop-controller.ts renderer/app/maildrop/page.tsx
git commit -m "feat(maildrop): count the whole job beside the batch on screen

The bar counts one batch, so a job of five drew a bar that filled and
restarted five times -- which reads as four failures. The job's own
numbers ride along in the same payload, in conversations, and are absent
for a plain drag so the picker draws exactly the line it drew before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Offering to resume after a restart

**Files:**
- Modify: `electron/mail/label-job.ts` — nothing new; `findUnfinishedJobs` and `jobProgress` already carry this
- Modify: `electron/core/ipc.ts` — two channels
- Modify: `electron/core/ipc-handlers.ts` — their handlers
- Modify: `electron/mail/mail-drop-controller.ts` — the pending job, the offer, the answer
- Modify: `renderer/app/maildrop/page.tsx` — a phase and a panel
- Test: `tests/label-job.test.ts` (append)

**Interfaces:**
- Consumes: `findUnfinishedJobs`, `jobProgress`, `nextBatch`, `finishLabelJob`, `readLabelJob` from Task 2; `advanceJob`, `rollbackFinishedBatches` from Tasks 5 and 6.
- Produces:
  - `export function pendingJobDecision(): { jobId: string; label: string; batch: number; batches: number; done: number; total: number; mode: 'new' | 'all' } | null`
  - `export async function decideJobRun(jobId: string, choice: 'continue' | 'keep' | 'rollback'): Promise<{ ok: boolean }>`
  - `IPC.MAIL_DROP_JOB_GET = 'maildrop:job-get'` and `IPC.MAIL_DROP_JOB_DECIDE = 'maildrop:job-decide'`

**Why an offer and not an automatic resume:** an app that comes back from a crash and starts inserting thousands of mails unattended is not something the user can oversee, and at that moment the crash's cause is unknown. This mirrors the orphan-run decision the app already makes for a single run, one level up.

- [ ] **Step 1: Write the failing test**

Append to `tests/label-job.test.ts`:

```ts
describe('resuming', () => {
  // What the offer has to be able to say: which label, how far, and with which duplicate policy
  // -- because resuming an 'all' job re-copies the interrupted batch's mail and the user has to
  // be told that in those words.
  it('reads back everything the resume offer needs', () => {
    written(6, 2);
    recordJobChoices(root, 'job-1', {
      targets: [{ email: 'support@example.com', labelIds: ['Label_1'] }],
      mode: 'all',
    });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });

    const [job] = findUnfinishedJobs(root);
    expect(job.label).toBe('Klanten');
    expect(job.choices?.mode).toBe('all');
    expect(jobProgress(job)).toEqual({ batch: 2, batches: 3, done: 2, total: 6 });
    expect(nextBatch(job)?.index).toBe(1);
  });

  // A job whose batch zero never got an answer has nothing to resume with, and the offer must
  // not pretend otherwise.
  it('has no choices to resume with when batch zero was never answered', () => {
    written(6, 2);
    expect(findUnfinishedJobs(root)[0].choices).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/label-job.test.ts`
Expected: FAIL — the first case's `jobProgress` and `nextBatch` assertions hold, but `recordJobChoices` with a `labelIds` target and no `tree` must typecheck; if `CopyTarget` is imported as a type only this passes immediately, in which case the test is a regression guard rather than a red step. Say so in the commit rather than manufacturing a failure.

- [ ] **Step 3: Find the pending job at start**

In `mail-drop-controller.ts`, beside `pendingOrphans`:

```ts
/** A job this app never heard the end of, waiting for the same continue-or-undo answer the
 * orphan-run decision already asks for a single run. At most one is offered at a time: two
 * half-finished jobs is not a state this app can get into, since a job holds the drop lock for
 * every batch. */
let pendingJob: LabelJob | null = null;
```

`resumeOrphanedCopyRuns` gains a second half. The order matters and is worth a comment: the runs are swept first, because a job's own batches are runs, and a batch whose journal already recorded a decision must be finished before the job above it is offered.

```ts
  // After the runs, and deliberately: a job's batches are runs, so a batch that already recorded
  // its own decision is settled above before the job it belongs to is offered. A job whose batch
  // zero never got an answer has nothing to resume with and is closed rather than offered -- its
  // batches were never copied, so there is nothing to keep or undo either.
  const jobs = findUnfinishedJobs(root);
  pendingJob = null;
  for (const job of jobs) {
    // Two different reasons nextBatch answers null, and they must not be treated alike. Every
    // batch copied means there is nothing left to ask about. A batch recorded as failed also
    // stops it -- and that one is precisely the state the user still owes an answer for, so it
    // is offered rather than closed.
    const stuck = job.batches.some((b) => b.state === 'failed');
    if (!job.choices || (!nextBatch(job) && !stuck)) {
      const failed = attemptWrite(() => finishLabelJob(root, job.jobId, 'kept'));
      if (failed) notifyLog(`[maildrop] kon een onafgemaakte klus niet afsluiten: ${failed}`);
      continue;
    }
    if (!pendingJob) pendingJob = job;
  }
```

- [ ] **Step 4: Offer and answer**

```ts
/**
 * The job the user has to make a continue-or-undo decision about, if any
 *
 * Asked by the mail-drop window when it opens, the same moment it already asks for the orphan
 * decision and the existing-mail scan.
 *
 * @returns the job and how far it got, or null when nothing is waiting
 */
export function pendingJobDecision(): {
  jobId: string;
  label: string;
  batch: number;
  batches: number;
  done: number;
  total: number;
  mode: 'new' | 'all';
} | null {
  if (!pendingJob || !pendingJob.choices) return null;
  return {
    jobId: pendingJob.jobId,
    label: pendingJob.label,
    ...jobProgress(pendingJob),
    mode: pendingJob.choices.mode,
  };
}

/**
 * Answers a pending job decision
 *
 * 'continue' re-pulls the batch that was in flight. Its slice may be partly copied already, and
 * the inherited 'new' mode is what makes that safe: the scan finds what landed and skips it. An
 * 'all' job has no such protection, which is why the offer says so in those words rather than
 * leaving the user to find out.
 *
 * @param jobId must be the one pendingJobDecision last returned
 * @param choice
 * @returns whether the decision was taken -- false when this job is no longer pending, which a
 *   second click or a stale window can both cause harmlessly
 */
export async function decideJobRun(
  jobId: string,
  choice: 'continue' | 'keep' | 'rollback',
): Promise<{ ok: boolean }> {
  const job = pendingJob;
  if (!job || job.jobId !== jobId) return { ok: false };
  pendingJob = null;
  const root = mailDropFolder();

  if (choice === 'continue') {
    // A batch recorded as failed is what nextBatch stops at, so continuing has to clear it back
    // to pending first -- otherwise the driver is handed a job it will refuse to walk and the
    // offer would do nothing at all. Written as a new state line rather than by rewriting the
    // file: the failure stays in the record above it, which is what a later reader needs to see
    // that this batch was retried and not merely slow.
    const stuck = job.batches.find((b) => b.state === 'failed');
    if (stuck) {
      const failed = attemptWrite(() =>
        recordJobBatchState(root, jobId, { index: stuck.index, state: 'pending' }),
      );
      if (failed) return { ok: false };
    }
    activeJob = { job: readLabelJob(root, jobId) ?? job, root };
    void advanceJob();
    return { ok: true };
  }

  const trouble = choice === 'rollback' ? await rollbackFinishedBatches(job, root) : [];
  const outcome: JobOutcome =
    choice === 'keep' ? 'kept' : trouble.length === 0 ? 'rolled-back' : 'rolled-back-partial';
  const failed = attemptWrite(() => finishLabelJob(root, jobId, outcome));
  if (failed) notifyLog(`[maildrop] kon de klus niet afsluiten: ${failed}`);
  if (trouble.length > 0) notifyLog(`[maildrop] niet alles teruggedraaid: ${trouble.join(', ')}`);
  return { ok: true };
}
```

- [ ] **Step 5: Wire the two channels**

In `electron/core/ipc.ts`, beside `MAIL_DROP_ORPHAN_GET` and `MAIL_DROP_ORPHAN_DECIDE`:

```ts
  MAIL_DROP_JOB_GET: 'maildrop:job-get',
  MAIL_DROP_JOB_DECIDE: 'maildrop:job-decide',
```

In `electron/core/ipc-handlers.ts`, beside the two orphan handlers, following their exact shape:

```ts
  ipcMain.handle(IPC.MAIL_DROP_JOB_GET, () => pendingJobDecision());
  ipcMain.handle(
    IPC.MAIL_DROP_JOB_DECIDE,
    (_e, arg: { jobId: string; choice: 'continue' | 'keep' | 'rollback' }) =>
      decideJobRun(arg.jobId, arg.choice),
  );
```

and both names added to the existing import from `../mail/mail-drop-controller`.

The renderer reaches them through `electron/sidebar-preload.ts`, where the orphan pair sits at lines 151-156. Add the job pair beside it, in the same shape:

```ts
  getPendingJob: (): Promise<{
    jobId: string;
    label: string;
    batch: number;
    batches: number;
    done: number;
    total: number;
    mode: 'new' | 'all';
  } | null> => ipcRenderer.invoke(IPC.MAIL_DROP_JOB_GET),
  decideJobRun: (
    jobId: string,
    choice: 'continue' | 'keep' | 'rollback',
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.MAIL_DROP_JOB_DECIDE, { jobId, choice }),
```

- [ ] **Step 6: Draw the offer**

In `renderer/app/maildrop/page.tsx`, beside `PendingOrphan`:

```ts
/** A job this app never heard the end of, waiting for the same kind of answer PendingOrphan
 * asks for one run. */
interface PendingJob {
  jobId: string;
  label: string;
  batch: number;
  batches: number;
  done: number;
  total: number;
  mode: 'new' | 'all';
}
```

`Phase` gains `| { kind: 'job'; job: PendingJob }`, asked for next to the orphan fetch at line 214 and only when that one answered nothing — two offers stacked on one modal is a queue nobody asked for, and the run-level one is the more urgent since it holds mail under a marker.

The panel, beside `OrphanDecision`:

```tsx
/**
 * What a job this app never heard the end of asks the user to decide
 *
 * @param job
 * @param onDecide
 */
function JobDecision({
  job,
  onDecide,
}: {
  job: PendingJob;
  onDecide: (jobId: string, choice: 'continue' | 'keep' | 'rollback') => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Vorige keer afgebroken
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          Van label “{job.label}” zijn {job.done} van {job.total} berichten gekopieerd, tot batch{' '}
          {job.batch} van {job.batches}.
        </p>
      </div>
      {job.mode === 'all' && (
        <p className="text-sm text-amber-700 dark:text-amber-500">
          Deze klus kopieert ook berichten die er al staan, zoals je toen gekozen hebt. Verdergaan
          betekent dat batch {job.batch} deels dubbel komt te staan.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onDecide(job.jobId, 'continue')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Verdergaan met batch {job.batch}
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'keep')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          Laten staan, klus afsluiten
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'rollback')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          Alle {job.done} berichten naar de prullenbak
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Naar de prullenbak is niet definitief: Gmail bewaart het daar nog 30 dagen.
      </p>
    </div>
  );
}
```

Render it where `phase.kind === 'orphan'` is rendered (lines 440 and 508), and give the status line a `phase.kind === 'job'` case reading `Vorige keer afgebroken — nog een keuze nodig over "{label}"`.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/label-job.test.ts`, then `npm test`, then both tsc projects.
Expected: PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
git add electron/mail/label-job.ts electron/core/ipc.ts electron/core/ipc-handlers.ts electron/mail/mail-drop-controller.ts renderer/app/maildrop/page.tsx tests/label-job.test.ts
git commit -m "feat(maildrop): offer to pick a half-finished job back up

An offer and never an automatic resume: an app that comes back from a
crash and starts inserting thousands of mails unattended is not something
anyone can oversee, and at that moment the cause of the crash is unknown.
Mirrors the orphan-run decision one level up, and is asked only when that
one has nothing waiting.

Continuing re-pulls the batch that was in flight, which is safe under the
inherited 'new' mode because the scan finds what landed and skips it. An
'all' job has no such protection, so the offer says in those words that
the batch will come out partly double.

A job whose first batch never got an answer is closed rather than
offered: nothing was copied, so there is nothing to keep or undo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

Nothing here has run against a real mailbox, and most of it cannot be reached by the suite: the driver, the drop-lock handover per batch, the stop scopes and the resume offer are all Electron-bound and network-bound. The unit tests cover the plan file, the slicing, the state machine and the inheritance rule — which is the part where a wrong answer is silent.

The first live run should be a label of about 4,000 into one mailbox, which is two batches, and should be watched for:

- `[maildrop] label "X": N gesprekken, M batches van 2000` at the drop, before any mail is pulled.
- The veil over the Gmail views lifting and returning once per batch, rather than standing for the whole job.
- `Batch 1 van 2` then `Batch 2 van 2` in the strip, with the total climbing across both.
- Two `.rollback.jsonl` files and one `.job.jsonl` in the drop folder, and the job file ending in a `done` line.
- The `[quota]` lines from part 1, since a run this long is the first real test of the pacing as well.

Then: kill the app during batch 2 and check that the next start offers to resume rather than resuming, and that continuing does not duplicate what batch 2 had already copied.
