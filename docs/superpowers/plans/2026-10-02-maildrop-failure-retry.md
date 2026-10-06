# Naming failed mails and retrying them — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a mail drag or copy partly fails, the panel names every failed mail and offers one button that retries exactly those mails — re-fetching failed conversations, or re-copying failed files into the same mailboxes and labels — and a batched job ends with an honest failure count.

**Architecture:** The decisions live in small pure modules (`renderer/lib/failure-list.ts`, `electron/mail/copy-failures.ts`, additions to `label-drop.ts`, `label-job.ts`, `dropzone.ts`, `job-panel.ts`), each unit-tested. `mail-drop-controller.ts` keeps one in-memory failure record per side, keyed by a `retryId`; the renderer sends only that id back. A copy retry re-enters `copyToMailboxes` with a per-target file set, so journal, marker, pause/cancel/rollback, quota and the job guard all apply unchanged.

**Tech Stack:** Electron main (TypeScript), Next 16 / React 19 renderer, vitest, `tsc --noEmit` for both projects.

**Spec:** `docs/superpowers/specs/2026-10-02-maildrop-failure-retry-design.md`

## Global Constraints

- Nothing about which mail is saved, which labels it gets, or where files are written may change (speed-only rule for the mail drop).
- The renderer never sends file paths, label ids or targets for a retry — only `retryId` (and `mode` for a copy retry).
- A copy retry is refused while a job drives (`jobDriving`), and no retry is offered for a batched job (part 2).
- A copy retry always asks Gmail fresh for duplicates in mode `check`: never reuse `lastScan` or `lastExisting` from before the first copy.
- The offer lives in memory only; a new drag (`dropSerial` moves on) invalidates it.
- Failure counts in a job are in conversations, never messages × mailboxes.
- Failure list cut-off: 20 lines, then `+ n meer`.
- Comments follow the user's global convention: banner sections, one-line docblocks, rare one-line inline comments, all in English. UI strings are Dutch/English per string set.
- Every new UI string goes into all three sets in `renderer/app/strings.ts`: `STRINGS_NORMAL` (English), `STRINGS_RENE`, `STRINGS_NL`.

## Deviations from the spec, decided while planning

- `tallyOutcomes` stays exactly as it is (its tests compare the whole object); the failed-file list is built by `copy-failures.ts` next to it instead.
- The pull-side row rules live in `renderer/lib/failure-list.ts` rather than a separate `electron/mail/pull-failures.ts`, because `renderer/lib` is already the place main and the modal share one declaration.
- The UI texts go into `renderer/app/strings.ts` (all three sets), because that is where every panel string lives; `failure-list.ts` holds only the logic.
- `mail-drop-controller.ts` has no unit-test harness and gets none here; its new paths are covered by the pure modules it calls, by `tsc`, and by the live check in Task 9.

## Review Focus

- **Retry pressed twice, or while something else runs** — the second call is refused with a message, never a second copy. Pinned in Task 2 (`retryRefusal`).
- **A new drag between the failure and the retry** — the old id is stale and refused. Pinned in Task 2.
- **A whole mailbox failed (no token, no marker label, tree not plannable)** — every file of that mailbox is in the retry, not just per-file failures. Pinned in Task 2 (`wholeTargetFailed`).
- **The same conversation dragged as two rows, one failing** — retried rows are put back by index, not by threadId. Pinned in Task 1 (`replaceRows`).
- **A retry where everything now lands** — no list, no button, no stale id left behind. Pinned in Task 2 (`copyFailuresOf` returns null).

---

### Task 1: Row rules and list cut-off (`renderer/lib/failure-list.ts`)

**Files:**
- Create: `renderer/lib/failure-list.ts`
- Test: `tests/failure-list.test.ts`

**Interfaces:**
- Produces:
  - `interface PullRow { threadId: string; subject: string; saved: number; error?: string }`
  - `failedRowIndexes(items: PullRow[]): number[]`
  - `replaceRows<T>(items: T[], at: number[], next: T[]): T[]`
  - `const SHOWN_FAILURES = 20`
  - `cutList<T>(list: T[], max?: number): { shown: T[]; more: number }`

- [ ] **Step 1: Write the failing test**

```ts
// Which pulled rows count as failed, how retried rows are put back, and where a long list is cut.

import { describe, it, expect } from 'vitest';
import { cutList, failedRowIndexes, replaceRows, SHOWN_FAILURES } from '../renderer/lib/failure-list';

describe('failedRowIndexes', () => {
  it('names a conversation that saved nothing and said why', () => {
    expect(
      failedRowIndexes([
        { threadId: 't1', subject: 'a', saved: 1 },
        { threadId: 't2', subject: 'b', saved: 0, error: 'Ophalen mislukt (HTTP 500)' },
      ]),
    ).toEqual([1]);
  });

  // A saved row can carry a warning -- the log line that did not land -- and it is not a failure.
  it('leaves a saved row with a warning alone', () => {
    expect(
      failedRowIndexes([{ threadId: 't1', subject: 'a', saved: 1, error: 'Logboek niet bijgeschreven: x' }]),
    ).toEqual([]);
  });

  // Truncation, log and empty-label rows have no conversation behind them and cannot be fetched again.
  it('never offers a row without a conversation', () => {
    expect(
      failedRowIndexes([
        { threadId: '', subject: 'Afgekapt op 2000 gesprekken', saved: 0, error: 'Het label bevat meer' },
        { threadId: '', subject: 'Niet in het logboek gezet', saved: 0, error: 'Logboek niet bijgeschreven' },
      ]),
    ).toEqual([]);
  });

  it('needs a reason before it calls a row failed', () => {
    expect(failedRowIndexes([{ threadId: 't1', subject: 'a', saved: 0 }])).toEqual([]);
  });
});

describe('replaceRows', () => {
  // Two rows of one conversation: only the one that failed is replaced.
  it('replaces by position, not by conversation', () => {
    const items = [
      { threadId: 't1', subject: 'a', saved: 1 },
      { threadId: 't1', subject: 'a', saved: 0, error: 'x' },
    ];
    expect(replaceRows(items, [1], [{ threadId: 't1', subject: 'a', saved: 1 }])).toEqual([
      { threadId: 't1', subject: 'a', saved: 1 },
      { threadId: 't1', subject: 'a', saved: 1 },
    ]);
  });

  it('leaves the original untouched', () => {
    const items = [{ threadId: 't1', subject: 'a', saved: 0, error: 'x' }];
    replaceRows(items, [0], [{ threadId: 't1', subject: 'a', saved: 1 }]);
    expect(items[0].saved).toBe(0);
  });
});

describe('cutList', () => {
  it('shows everything up to the limit', () => {
    expect(cutList([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
  });

  it('counts what it leaves out', () => {
    const list = Array.from({ length: SHOWN_FAILURES + 13 }, (_, i) => i);
    const cut = cutList(list);
    expect(cut.shown).toHaveLength(SHOWN_FAILURES);
    expect(cut.more).toBe(13);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/failure-list.test.ts`
Expected: FAIL — cannot resolve `../renderer/lib/failure-list`.

- [ ] **Step 3: Write minimal implementation**

```ts
// Which rows of a pull failed, and how a list of failures is shortened for the panel. Shared by
// main, which keeps the rows to fetch again, and the modal, which draws them.


//===========================
// Types
//===========================

export interface PullRow {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}


//===========================
// Constants
//===========================

export const SHOWN_FAILURES = 20;


//===========================
// Exported functions
//===========================

/**
 * Which rows are conversations that could not be fetched
 *
 * @param items the preview rows, in drag order
 * @returns their positions; a row without a conversation behind it is never one
 */
export function failedRowIndexes(items: PullRow[]): number[] {
  const at: number[] = [];
  items.forEach((item, i) => {
    if (item.threadId && item.saved === 0 && (item.error ?? '').trim()) at.push(i);
  });
  return at;
}

/**
 * Puts retried rows back where they stood
 *
 * @param items
 * @param at positions, as failedRowIndexes answered them
 * @param next one row per position, in the same order
 * @returns a new list
 */
export function replaceRows<T>(items: T[], at: number[], next: T[]): T[] {
  const out = [...items];
  at.forEach((position, i) => {
    if (next[i] !== undefined) out[position] = next[i];
  });
  return out;
}

/**
 * Shortens a list for the panel
 *
 * @param list
 * @param max
 * @returns the lines to draw and how many were left out
 */
export function cutList<T>(list: T[], max = SHOWN_FAILURES): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/failure-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/failure-list.ts tests/failure-list.test.ts
git commit -m "feat(maildrop): rules for which pulled rows failed"
```

---

### Task 2: Copy failures and the retry guard (`electron/mail/copy-failures.ts`)

**Files:**
- Create: `electron/mail/copy-failures.ts`
- Modify: `electron/gmail/gmail-api.ts:1496` (export the timeout class, add `insertMayHaveLanded`)
- Test: `tests/copy-failures.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `gmail-api.ts`: `export class GmailTimeoutError`, `export function insertMayHaveLanded(e: unknown): boolean`
  - `interface FailedFileRef { threadId: string; subject: string; messageId: string }`
  - `interface FailedFile<F extends FailedFileRef> { file: F; error: string; maybeLanded: boolean }`
  - `interface TargetFailures<T extends { email: string }, F extends FailedFileRef> { target: T; files: FailedFile<F>[] }`
  - `interface FailureLine { subject: string; error: string; maybeLanded: boolean }`
  - `interface RetryHeld { retryId: string; serial: number }`
  - `failedFiles<F>(files: F[], outcomes: Array<{ kind: string; error?: string; maybeLanded?: boolean } | undefined>): FailedFile<F>[]`
  - `wholeTargetFailed<F>(files: F[], error: string): FailedFile<F>[]`
  - `failureLines<F>(list: FailedFile<F>[]): FailureLine[]`
  - `copyFailuresOf<T, F>(targets: TargetFailures<T, F>[]): TargetFailures<T, F>[] | null`
  - `failedConversations(targets: TargetFailures<{ email: string }, FailedFileRef>[], pullFailedThreads: string[]): number`
  - `retryRefusal(s: { wanted: string; held: RetryHeld | null; serial: number; jobDriving: boolean; jobActive: boolean; pulling: boolean; copying: boolean }): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// What a copy remembers of its failures, and when a retry of them may run.

import { describe, it, expect } from 'vitest';
import {
  copyFailuresOf,
  failedConversations,
  failedFiles,
  failureLines,
  retryRefusal,
  wholeTargetFailed,
} from '../electron/mail/copy-failures';
import { GmailHttpError, GmailTimeoutError, insertMayHaveLanded } from '../electron/gmail/gmail-api';

const f = (threadId: string, subject = threadId) => ({ threadId, subject, messageId: `<${threadId}@x>` });

describe('failedFiles', () => {
  it('keeps only the failed files, with their own error', () => {
    expect(
      failedFiles(
        [f('t1'), f('t2'), f('t3')],
        [{ kind: 'copied' }, { kind: 'failed', error: 'quota', maybeLanded: false }, { kind: 'skipped' }],
      ),
    ).toEqual([{ file: f('t2'), error: 'quota', maybeLanded: false }]);
  });

  // A stopped file and a file the gate never started are not failures: a retry is not a resume.
  it('never counts a stopped or missing outcome', () => {
    expect(failedFiles([f('t1'), f('t2')], [{ kind: 'stopped' }, undefined])).toEqual([]);
  });

  it('carries the maybe-landed flag', () => {
    expect(failedFiles([f('t1')], [{ kind: 'failed', error: 'time-out', maybeLanded: true }])[0].maybeLanded).toBe(true);
  });

  it('names a failure that gave no reason', () => {
    expect(failedFiles([f('t1')], [{ kind: 'failed' }])[0].error).toBe('onbekende fout');
  });
});

describe('wholeTargetFailed', () => {
  it('puts every file of a mailbox that could not be opened in the retry', () => {
    expect(wholeTargetFailed([f('t1'), f('t2')], 'Geen toegang')).toEqual([
      { file: f('t1'), error: 'Geen toegang', maybeLanded: false },
      { file: f('t2'), error: 'Geen toegang', maybeLanded: false },
    ]);
  });
});

describe('failureLines', () => {
  it('is what the panel draws per mail', () => {
    expect(failureLines([{ file: f('t1', 'Offerte'), error: 'quota', maybeLanded: false }])).toEqual([
      { subject: 'Offerte', error: 'quota', maybeLanded: false },
    ]);
  });
});

describe('copyFailuresOf', () => {
  it('drops mailboxes where everything landed', () => {
    const a = { target: { email: 'a@x.nl' }, files: [] };
    const b = { target: { email: 'b@x.nl' }, files: [{ file: f('t1'), error: 'e', maybeLanded: false }] };
    expect(copyFailuresOf([a, b])).toEqual([b]);
  });

  // The review-focus case: a retry where everything lands must not leave an offer behind.
  it('answers null when nothing failed', () => {
    expect(copyFailuresOf([{ target: { email: 'a@x.nl' }, files: [] }])).toBeNull();
  });
});

describe('failedConversations', () => {
  it('counts a conversation once however many mailboxes it failed in', () => {
    const one = { file: f('t1'), error: 'e', maybeLanded: false };
    expect(
      failedConversations(
        [
          { target: { email: 'a@x.nl' }, files: [one] },
          { target: { email: 'b@x.nl' }, files: [one] },
        ],
        [],
      ),
    ).toBe(1);
  });

  it('adds conversations that were never fetched', () => {
    expect(
      failedConversations([{ target: { email: 'a@x.nl' }, files: [{ file: f('t1'), error: 'e', maybeLanded: false }] }], [
        't1',
        't2',
      ]),
    ).toBe(2);
  });
});

describe('retryRefusal', () => {
  const ok = {
    wanted: 'r1',
    held: { retryId: 'r1', serial: 4 },
    serial: 4,
    jobDriving: false,
    jobActive: false,
    pulling: false,
    copying: false,
  };

  it('lets a current retry run', () => {
    expect(retryRefusal(ok)).toBeNull();
  });

  it('refuses when there is nothing to retry', () => {
    expect(retryRefusal({ ...ok, held: null })).not.toBeNull();
  });

  it('refuses a stale id', () => {
    expect(retryRefusal({ ...ok, wanted: 'r0' })).not.toBeNull();
  });

  it('refuses after a new drag', () => {
    expect(retryRefusal({ ...ok, serial: 5 })).not.toBeNull();
  });

  it('refuses while a job drives or is held', () => {
    expect(retryRefusal({ ...ok, jobDriving: true })).not.toBeNull();
    expect(retryRefusal({ ...ok, jobActive: true })).not.toBeNull();
  });

  // The double-click case: the first retry is running, the second must not start beside it.
  it('refuses while a pull or a copy runs', () => {
    expect(retryRefusal({ ...ok, pulling: true })).not.toBeNull();
    expect(retryRefusal({ ...ok, copying: true })).not.toBeNull();
  });
});

describe('insertMayHaveLanded', () => {
  it('says yes for a timeout and a dropped connection', () => {
    expect(insertMayHaveLanded(new GmailTimeoutError('geen antwoord van Google (time-out)'))).toBe(true);
    expect(insertMayHaveLanded(new Error('net::ERR_CONNECTION_RESET'))).toBe(true);
  });

  it('says no for an answer Gmail actually gave', () => {
    expect(insertMayHaveLanded(new GmailHttpError('Quota exceeded', 429, null))).toBe(false);
    expect(insertMayHaveLanded(new Error('Verbinding verlopen'))).toBe(false);
  });
});
```

Check the `GmailHttpError` constructor at `electron/gmail/gmail-api.ts:102` before running; if it takes a different third argument, adjust the two `new GmailHttpError(...)` calls in this test to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/copy-failures.test.ts`
Expected: FAIL — cannot resolve `../electron/mail/copy-failures`.

- [ ] **Step 3: Write minimal implementation**

In `electron/gmail/gmail-api.ts`, change line 1496 from `class GmailTimeoutError extends Error {}` to `export class GmailTimeoutError extends Error {}`, and add directly below it:

```ts
/**
 * Whether a failed insert may still have reached the mailbox
 *
 * A timeout and a connection Electron reports as dropped both leave the upload's fate unknown;
 * any answer Gmail actually gave, and any error raised before the request went out, does not.
 *
 * @param e what the insert threw
 * @returns {boolean}
 */
export function insertMayHaveLanded(e: unknown): boolean {
  if (e instanceof GmailTimeoutError) return true;
  if (e instanceof GmailHttpError || e instanceof GmailCancelledError) return false;
  return e instanceof Error && e.message.startsWith('net::');
}
```

Create `electron/mail/copy-failures.ts`:

```ts
// What a copy keeps of the mail that did not land, so the panel can name it and one button can
// send exactly that mail again. Kept apart from mail-copy.ts's tally, which counts and does not
// remember.


//===========================
// Types
//===========================

export interface FailedFileRef {
  threadId: string;
  subject: string;
  messageId: string;
}

export interface FailedFile<F extends FailedFileRef> {
  file: F;
  error: string;
  maybeLanded: boolean;
}

export interface TargetFailures<T extends { email: string }, F extends FailedFileRef> {
  target: T;
  files: FailedFile<F>[];
}

export interface FailureLine {
  subject: string;
  error: string;
  maybeLanded: boolean;
}

export interface RetryHeld {
  retryId: string;
  serial: number;
}


//===========================
// Constants
//===========================

const UNKNOWN_ERROR = 'onbekende fout';


//===========================
// Exported functions
//===========================

/**
 * The files of one mailbox whose copy failed
 *
 * @param files in the order of the drag
 * @param outcomes one per file, in the same order; a missing one never started
 * @returns {FailedFile[]}
 */
export function failedFiles<F extends FailedFileRef>(
  files: F[],
  outcomes: Array<{ kind: string; error?: string; maybeLanded?: boolean } | undefined>,
): FailedFile<F>[] {
  const out: FailedFile<F>[] = [];
  files.forEach((file, i) => {
    const outcome = outcomes[i];
    if (outcome?.kind !== 'failed') return;
    out.push({ file, error: outcome.error || UNKNOWN_ERROR, maybeLanded: outcome.maybeLanded === true });
  });
  return out;
}

/**
 * Every file of a mailbox that could not be written to at all
 *
 * @param files
 * @param error why the mailbox could not be opened
 * @returns {FailedFile[]}
 */
export function wholeTargetFailed<F extends FailedFileRef>(files: F[], error: string): FailedFile<F>[] {
  return files.map((file) => ({ file, error, maybeLanded: false }));
}

export function failureLines<F extends FailedFileRef>(list: FailedFile<F>[]): FailureLine[] {
  return list.map((f) => ({ subject: f.file.subject, error: f.error, maybeLanded: f.maybeLanded }));
}

/**
 * What a copy leaves to retry
 *
 * @param targets one entry per mailbox written to
 * @returns the mailboxes that lost mail, or null when none did
 */
export function copyFailuresOf<T extends { email: string }, F extends FailedFileRef>(
  targets: TargetFailures<T, F>[],
): TargetFailures<T, F>[] | null {
  const left = targets.filter((t) => t.files.length > 0);
  return left.length > 0 ? left : null;
}

/**
 * How many conversations a batch lost, in the unit the job line speaks
 *
 * @param targets the copy's failures
 * @param pullFailedThreads conversations the batch could not fetch at all
 * @returns {number} distinct conversations
 */
export function failedConversations(
  targets: TargetFailures<{ email: string }, FailedFileRef>[],
  pullFailedThreads: string[],
): number {
  const threads = new Set(pullFailedThreads);
  for (const t of targets) for (const f of t.files) threads.add(f.file.threadId);
  return threads.size;
}

/**
 * Why a retry may not run now
 *
 * @param s what the controller knows at the moment the button was pressed
 * @returns the sentence for the panel, or null when the retry may run
 */
export function retryRefusal(s: {
  wanted: string;
  held: RetryHeld | null;
  serial: number;
  jobDriving: boolean;
  jobActive: boolean;
  pulling: boolean;
  copying: boolean;
}): string | null {
  if (s.jobDriving || s.jobActive) return 'Er loopt een klus. Wacht tot die klaar is.';
  if (s.pulling) return 'Er wordt al mail opgehaald.';
  if (s.copying) return 'Er wordt al gekopieerd.';
  if (!s.held || s.held.retryId !== s.wanted || s.held.serial !== s.serial) {
    return 'Deze lijst is verlopen. Sleep de mail opnieuw.';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/copy-failures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/mail/copy-failures.ts electron/gmail/gmail-api.ts tests/copy-failures.test.ts
git commit -m "feat(maildrop): remember which copied mails failed and when a retry may run"
```

---

### Task 3: Strip state and tree counts (`dropzone.ts`, `label-drop.ts`)

**Files:**
- Modify: `electron/mail/dropzone.ts` (add `resultState` after `resultText`, line ~492)
- Modify: `electron/preload.ts:656`
- Modify: `electron/mail/label-drop.ts` (add `addMemberCounts`)
- Test: `tests/dropzone.test.ts`, `tests/label-drop.test.ts`

**Interfaces:**
- Produces:
  - `resultState(r: { ok: boolean; count: number; total: number }): 'done' | 'failed'`
  - `addMemberCounts(members: Array<{ name: string; threads: number }>, added: Array<{ labels: string[] }>): Array<{ name: string; threads: number }>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dropzone.test.ts` (add `resultState` to its existing import from `../electron/mail/dropzone`):

```ts
describe('resultState', () => {
  it('is done when every conversation was saved', () => {
    expect(resultState({ ok: true, count: 3, total: 3 })).toBe('done');
  });

  // The defect: eight of ten was drawn in the success colour beside nothing that said two failed.
  it('is failed when only part of the drag was saved', () => {
    expect(resultState({ ok: true, count: 8, total: 10 })).toBe('failed');
  });

  it('is failed when nothing was saved', () => {
    expect(resultState({ ok: false, count: 0, total: 2 })).toBe('failed');
  });
});
```

Append to `tests/label-drop.test.ts` (add `addMemberCounts` to its import from `../electron/mail/label-drop`):

```ts
describe('addMemberCounts', () => {
  it('adds retried conversations to the labels they sit under', () => {
    expect(
      addMemberCounts(
        [
          { name: 'Klanten', threads: 3 },
          { name: 'Klanten/Acme', threads: 1 },
        ],
        [{ labels: ['Klanten', 'Klanten/Acme'] }, { labels: ['Klanten'] }],
      ),
    ).toEqual([
      { name: 'Klanten', threads: 5 },
      { name: 'Klanten/Acme', threads: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dropzone.test.ts tests/label-drop.test.ts`
Expected: FAIL — `resultState` and `addMemberCounts` are not exported.

- [ ] **Step 3: Implement**

In `electron/mail/dropzone.ts`, directly below `resultText`:

```ts
/**
 * Which colour the strip draws a finished drop in
 *
 * @param r what dropOutcome answered
 * @returns 'done' only when every dragged conversation was saved
 */
export function resultState(r: { ok: boolean; count: number; total: number }): 'done' | 'failed' {
  return r.ok && r.count >= r.total ? 'done' : 'failed';
}
```

In `electron/preload.ts`, add `resultState` to the import from the dropzone module (next to `resultText`, line ~44), and replace line 656:

```ts
      setState(resultState(r));
```

In `electron/mail/label-drop.ts`, in its exported-functions section:

```ts
/**
 * A tree's per-label counts with retried conversations added
 *
 * @param members as the drag first counted them
 * @param added the conversations a retry has now saved
 * @returns a new list in the members' own order
 */
export function addMemberCounts(
  members: Array<{ name: string; threads: number }>,
  added: Array<{ labels: string[] }>,
): Array<{ name: string; threads: number }> {
  return members.map((m) => ({
    name: m.name,
    threads: m.threads + added.filter((a) => a.labels.includes(m.name)).length,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dropzone.test.ts tests/label-drop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/mail/dropzone.ts electron/preload.ts electron/mail/label-drop.ts tests/dropzone.test.ts tests/label-drop.test.ts
git commit -m "fix(maildrop): a partly saved drag no longer shows in the success colour"
```

---

### Task 4: A job remembers and reports what it lost (`label-job.ts`, `job-panel.ts`, strings)

**Files:**
- Modify: `electron/mail/label-job.ts` (`JobBatch` ~line 42, `JobStateLine` ~line 115, the parse at ~line 317, `batchConversations` ~line 431, new `jobFailed`)
- Modify: `renderer/lib/maildrop-copy.ts` (`JobEnd`)
- Modify: `renderer/app/job-panel.ts:222` (`jobEndText`)
- Modify: `renderer/app/strings.ts` (interface ~line 398 and all three sets)
- Test: `tests/label-job.test.ts`, `tests/job-panel.test.ts`

**Interfaces:**
- Produces:
  - `JobBatch.failed?: number`, `JobStateLine.failed?: number`
  - `jobFailed(job: LabelJob): number`
  - `JobEnd.failed?: number`
  - `UiStrings.mdJobDoneWithFailures: (done: number, total: number, failed: number) => string`

- [ ] **Step 1: Write the failing tests**

In `tests/label-job.test.ts`, add `jobFailed` to the import from `../electron/mail/label-job` and add (the file's own `written(count, batchSize)` helper writes plan `job-1` into the temp `root`):

```ts
describe('failed conversations per batch', () => {
  it('reads a batch failed count back from the plan', () => {
    written(8, 4);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2, failed: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'copied', runId: 'run-b', copied: 3, failed: 1 });
    const job = readLabelJob(root, 'job-1')!;
    expect(job.batches[0].failed).toBe(2);
    expect(jobFailed(job)).toBe(3);
  });

  it('reads a plan written before the count existed as nothing lost', () => {
    written(8, 4);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 4 });
    expect(jobFailed(readLabelJob(root, 'job-1')!)).toBe(0);
  });

  // The job line must not claim a lost conversation as done.
  it('leaves failed conversations out of a copied batch', () => {
    written(8, 4);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2, failed: 2 });
    expect(jobProgress(readLabelJob(root, 'job-1')!).done).toBe(2);
  });

  it('never counts a batch below nothing', () => {
    written(8, 4);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 0, failed: 9 });
    expect(jobProgress(readLabelJob(root, 'job-1')!).done).toBe(0);
  });
});
```

In `tests/job-panel.test.ts`, inside `describe('jobEndText', ...)`:

```ts
  it('says how many conversations a finished job lost', () => {
    expect(jobEndText(end({ done: 98, failed: 2 }), STRINGS_NL)).toBe(
      'Klus afgerond — 98 van 100 conversaties gekopieerd, 2 mislukt (zie log.jsonl)',
    );
  });

  it('keeps the plain line when nothing was lost', () => {
    expect(jobEndText(end({ failed: 0 }), STRINGS_NL)).toBe('Klus afgerond — 100 van 100 conversaties gekopieerd');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/label-job.test.ts tests/job-panel.test.ts`
Expected: FAIL — `jobFailed` not exported, `failed` not read, string not present.

- [ ] **Step 3: Implement**

`electron/mail/label-job.ts`:

- Add to `interface JobBatch`, below `skipped?: number;`:

```ts
  /** Conversations this batch lost, fetched or copied; absent on a plan written before it was counted */
  failed?: number;
```

- Add `failed?: number;` to `interface JobStateLine` below `skipped?: number;`.
- In the batch mapping of the parse (the object with `copied: state?.copied, skipped: state?.skipped,`), add `failed: state?.failed,`.
- In `batchConversations`, replace `if (batch.state === 'copied') return batch.threads.length;` with:

```ts
  if (batch.state === 'copied') {
    return batch.threads.length - Math.min(batch.failed ?? 0, batch.threads.length);
  }
```

- In the exported-functions section, below `jobProgress`:

```ts
/**
 * How many conversations a job lost across every batch
 *
 * @param job
 * @returns {number}
 */
export function jobFailed(job: LabelJob): number {
  return job.batches.reduce((sum, b) => sum + (b.failed ?? 0), 0);
}
```

`renderer/lib/maildrop-copy.ts`, in `interface JobEnd` below `total: number;`:

```ts
  /** Conversations lost across every batch; absent or 0 when none were */
  failed?: number;
```

`renderer/app/strings.ts`: add to `UiStrings` below `mdJobDone`:

```ts
  mdJobDoneWithFailures: (done: number, total: number, failed: number) => string;
```

and in each set, below its own `mdJobDone`:

```ts
// STRINGS_NORMAL
  mdJobDoneWithFailures: (done, total, failed) =>
    `Job finished — ${done} of ${total} conversations copied, ${failed} failed (see log.jsonl)`,
// STRINGS_RENE
  mdJobDoneWithFailures: (done, total, failed) =>
    `Klaar — ${done} van ${total} mailtjes gekopieerd, ${failed} niet gelukt (kijk in log.jsonl)`,
// STRINGS_NL
  mdJobDoneWithFailures: (done, total, failed) =>
    `Klus afgerond — ${done} van ${total} conversaties gekopieerd, ${failed} mislukt (zie log.jsonl)`,
```

`renderer/app/job-panel.ts`, in `jobEndText`:

```ts
    case 'completed':
      return (end.failed ?? 0) > 0
        ? S.mdJobDoneWithFailures(end.done, end.total, end.failed!)
        : S.mdJobDone(end.done, end.total);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/label-job.test.ts tests/job-panel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/mail/label-job.ts renderer/lib/maildrop-copy.ts renderer/app/job-panel.ts renderer/app/strings.ts tests/label-job.test.ts tests/job-panel.test.ts
git commit -m "feat(maildrop): a job counts the conversations it lost and says so at the end"
```

---

### Task 5: Copy side in the controller — per-target files, failures, retry entry

**Files:**
- Modify: `electron/mail/mail-copy.ts:38-58` (`CopyResult.retryId`, `CopyAccountResult.failures`)
- Modify: `electron/mail/mail-drop-controller.ts` (module state, `findDuplicates`, `copyOneFile`, `copyToMailboxes`, new `retryFailedCopy`, job tail, `sendJobEnd`)
- Modify: `electron/core/ipc.ts`, `electron/core/ipc-handlers.ts:379`, `electron/sidebar-preload.ts:195`, `renderer/app/page.tsx:274`, `renderer/app/MailDropModal.tsx:38-66`

**Interfaces:**
- Consumes: Task 2 (`failedFiles`, `wholeTargetFailed`, `failureLines`, `copyFailuresOf`, `failedConversations`, `retryRefusal`, `insertMayHaveLanded`, `TargetFailures`), Task 4 (`jobFailed`, `JobStateLine.failed`).
- Produces:
  - `CopyAccountResult.failures?: FailureLine[]`, `CopyResult.retryId?: string`
  - `IPC.MAIL_DROP_COPY_RETRY = 'maildrop:copy-retry'`
  - `export async function retryFailedCopy(arg: { retryId: string; mode?: CopyMode })` with the same return type as `copyToMailboxes`
  - bridge: `retryMailDropCopy(retryId: string, mode?: MailDropCopyMode): Promise<MailDropCopyResult>`
  - module state: `let batchPullFailedThreads: string[] = []` (set by Task 6, read here)

- [ ] **Step 1: Result shapes**

`electron/mail/mail-copy.ts` — import the type and extend:

```ts
import type { FailureLine } from './copy-failures';
```

```ts
export interface CopyResult {
  // ...existing fields...
  /** Set when some mail did not land and may be tried again from the panel */
  retryId?: string;
}

export interface CopyAccountResult {
  // ...existing fields...
  failures?: FailureLine[];
}
```

Mirror both in `renderer/app/MailDropModal.tsx`: add `failures?: { subject: string; error: string; maybeLanded: boolean }[];` to `MailDropCopyAccountResult` and `retryId?: string;` to `MailDropCopyResult`.

- [ ] **Step 2: Module state**

In `mail-drop-controller.ts`, beside `lastScan` (~line 263):

```ts
/** What the last copy could not land, held for the panel's retry button. Only for a copy the
 * picker ran itself: a job's batches are part 2. */
let lastCopyFailures:
  | { retryId: string; serial: number; targets: TargetFailures<MailDropCopyTarget, SavedRef>[] }
  | null = null;

/** Conversations the last pull could not fetch, which a job's batch counts as lost */
let batchPullFailedThreads: string[] = [];
```

Add imports: `randomUUID` is already imported; add the Task 2 functions and types from `./copy-failures` and `insertMayHaveLanded` from `../gmail/gmail-api`, `jobFailed` from `./label-job`.

- [ ] **Step 3: `copyOneFile` marks an ambiguous failure**

In `CopyOutcome` (~line 1698) add `maybeLanded?: boolean;`. In the last `catch (e)` of `copyOneFile` (the one that builds `kind: 'failed'` with `copy: { ... ok: false, error }`), add `maybeLanded: insertMayHaveLanded(e),` to the `outcome` object. The file-read failure above it stays without the flag.

- [ ] **Step 4: `findDuplicates` can be told to ask fresh and narrow its questions**

Add two optional parameters at the end of `findDuplicates`:

```ts
  /** False on a retry: the picker's scan predates the first copy and cannot answer for it */
  useScan = true,
  /** Narrows the questions to the pairs a retry is about to send */
  only?: (email: string, messageId: string) => boolean,
```

and change its first lines to:

```ts
  const checks = duplicateChecks(targets, saved, resolved).filter(
    (c) => !only || only(c.email, c.messageId),
  );
  // ...
  const scan = useScan && lastExisting?.serial === dropSerial ? lastExisting.byEmail : null;
```

- [ ] **Step 5: `copyToMailboxes` takes a per-target file set**

Extend the argument:

```ts
  /** Set only by retryFailedCopy: the mailboxes and, per mailbox, the files that failed there */
  retry?: { targets: MailDropCopyTarget[]; files: Map<string, SavedRef[]> };
```

Right after `const files = lastDropSaved;` and its empty check, change to:

```ts
  const retry = arg?.retry;
  const filesFor = (email: string): SavedRef[] => (retry ? retry.files.get(email) ?? [] : lastDropSaved);
  const files = retry ? [...new Set([...retry.files.values()].flat())] : lastDropSaved;
  if (files.length === 0) return fail('Geen opgeslagen berichten om te kopiëren');
```

and replace `const requested = normalizeTargets(arg?.targets ?? []);` with `const requested = normalizeTargets(retry ? retry.targets : arg?.targets ?? []);`.

Then, inside `copyToMailboxes` only, replace every per-mailbox use of `files`:

| Where | Before | After |
|---|---|---|
| total | `copyTotal(targets, files.length)` | `retry ? targets.reduce((n, t) => n + filesFor(t.email).length, 0) : copyTotal(targets, files.length)` |
| marker failure branch | `total: files.length` / `done += files.length` | `filesFor(a.email).length` (both) |
| tree error branch | `total: files.length` / `done += files.length` | `filesFor(email).length` (both) |
| no-token branch in `runCopy` | `done += files.length` / `total: files.length` | `filesFor(target.email).length` (both) |
| `copyToMailbox({ ... files, ... })` | `files,` | `files: filesFor(target.email),` |
| per-target return | `total: files.length,` | `total: filesFor(target.email).length,` |
| `newCount` in the confirm return | `newMessageCount(index, targets, files.map((f) => f.messageId), planned)` | `targets.reduce((n, t) => n + newMessageCount(index, [t], filesFor(t.email).map((f) => f.messageId), planned), 0)` |

`planTrees(targets, files, lastDropTree)` and `perMessageLabels(files, …)` keep the union `files`: they plan labels, they do not send.

For the duplicate scan, before `const reusedWholeScan = lastScan?.key === key;`:

```ts
    // A retry's check always asks again: the stored scan was taken before the first copy landed
    if (retry && mode === 'check') lastScan = null;
```

and pass the two new `findDuplicates` arguments:

```ts
          treeResolved,
          !retry,
          retry ? (email, messageId) => filesFor(email).some((f) => f.messageId === messageId) : undefined,
```

- [ ] **Step 6: Collect the failures**

Before `const runCopy = async () => {`, declare:

```ts
  const failuresByTarget: TargetFailures<MailDropCopyTarget, SavedRef>[] = [];
```

In the marker-failure branch and the tree-error branch, after the `accounts.push(...)`, push the whole mailbox and put its lines on the account:

```ts
      const lost = wholeTargetFailed(filesFor(a.email), a.error);
      failuresByTarget.push({ target: targets.find((t) => t.email === a.email)!, files: lost });
```

and add `failures: failureLines(lost)` to the pushed account object (use `email` / `error` in the tree branch). In the no-token branch inside `runCopy`, do the same with `got.error` and `target`.

After `const { copied: ok, skipped: over, failed, stopped, lastError } = tallyOutcomes(outcomes);`:

```ts
        const lost = failedFiles(filesFor(target.email), outcomes);
        failuresByTarget.push({ target, files: lost });
```

and add `...(lost.length > 0 ? { failures: failureLines(lost) } : {}),` to the returned `account`.

- [ ] **Step 7: Hold the retry offer**

In the never-stopped branch, replace the `return withWarnings({ ok: …, accounts } satisfies MailDropCopyResult, warnings);` with:

```ts
      const left = !arg?.fromJob && !activeJob ? copyFailuresOf(failuresByTarget) : null;
      lastCopyFailures = left ? { retryId: randomUUID(), serial: dropSerial, targets: left } : null;
      return withWarnings(
        {
          ok: copied > 0 || skipped > 0,
          copied,
          skipped,
          total,
          accounts,
          ...(lastCopyFailures ? { retryId: lastCopyFailures.retryId } : {}),
        } satisfies MailDropCopyResult,
        warnings,
      );
```

At the very top of the stopped branch (`const byMailbox = accounts.map(...)`), add `lastCopyFailures = null;` — a stopped run offers no retry.

- [ ] **Step 8: Record a batch's losses**

In the job tail (`recordJobBatchState(ours.root, ours.job.jobId, { index: at.index, state: failedHard ? 'failed' : 'copied', ... })`, ~line 3160), add:

```ts
            failed: failedConversations(failuresByTarget, batchPullFailedThreads),
```

`failuresByTarget` must be in scope there; if the tail sits outside the block where it was declared, move the declaration up to just after `const runId: CopyRunId = randomUUID();`.

In `sendJobEnd`, add `failed: jobFailed(job),` to the `jobEnd` object, and add `failed?: number;` to `interface JobEndInfo` (~line 229).

- [ ] **Step 9: The retry entry point**

Below `copyToMailboxes`:

```ts
/**
 * Copies the mail the last copy could not land, to exactly where it was going
 *
 * @param arg the id the panel was given, and the mode the duplicate screen answered with
 * @returns what copyToMailboxes answers
 */
export async function retryFailedCopy(arg: {
  retryId: string;
  mode?: CopyMode;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastCopyFailures,
    serial: dropSerial,
    jobDriving,
    jobActive: activeJob !== null,
    pulling: activePull !== null,
    copying: activeRun !== null,
  });
  if (refused || !lastCopyFailures) {
    return { ok: false, copied: 0, skipped: 0, total: 0, accounts: [], error: refused ?? 'Niets om opnieuw te proberen' };
  }
  const held = lastCopyFailures;
  notifyLog(`[maildrop] retry of ${held.targets.reduce((n, t) => n + t.files.length, 0)} failed copies`);
  return copyToMailboxes({
    targets: [],
    mode: arg.mode ?? 'check',
    retry: {
      targets: held.targets.map((t) => t.target),
      files: new Map(held.targets.map((t) => [t.target.email, t.files.map((f) => f.file)])),
    },
  });
}
```

Check what `activeRun` is between runs (its declaration at ~line 278); if it stays set after a run ends, use the same "a copy is running" test the existing stop path uses instead of `activeRun !== null`.

- [ ] **Step 10: IPC and bridge**

`electron/core/ipc.ts`, beside `MAIL_DROP_COPY`: `MAIL_DROP_COPY_RETRY: 'maildrop:copy-retry',`.

`electron/core/ipc-handlers.ts:379` — pass only what the renderer may choose, so it can never set `fromJob` or `retry`:

```ts
  ipcMain.handle(IPC.MAIL_DROP_COPY, (_e, arg: { targets: MailDropCopyTarget[]; mode?: CopyMode }) =>
    copyToMailboxes({ targets: arg?.targets ?? [], mode: arg?.mode }),
  );
  ipcMain.handle(IPC.MAIL_DROP_COPY_RETRY, (_e, arg: { retryId: string; mode?: CopyMode }) =>
    retryFailedCopy({ retryId: String(arg?.retryId ?? ''), mode: arg?.mode }),
  );
```

`electron/sidebar-preload.ts`, below `copyMailDrop`:

```ts
  retryMailDropCopy: (retryId: string, mode?: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_COPY_RETRY, { retryId, mode }),
```

`renderer/app/page.tsx`, below `copyMailDrop(...)` in the bridge type:

```ts
  retryMailDropCopy(retryId: string, mode?: MailDropCopyMode): Promise<MailDropCopyResult>;
```

- [ ] **Step 11: Typecheck and full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run`
Expected: both typechecks clean, every test green.

- [ ] **Step 12: Commit**

```bash
git add electron/mail/mail-copy.ts electron/mail/mail-drop-controller.ts electron/core/ipc.ts electron/core/ipc-handlers.ts electron/sidebar-preload.ts renderer/app/page.tsx renderer/app/MailDropModal.tsx
git commit -m "feat(maildrop): a copy names the mail it lost and can send exactly that again"
```

---

### Task 6: Pull side in the controller — remember failed rows, fetch them again

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts` (`fetchThreadSlice`, `saveLabel`, `handleMailDrop`, `pullMailDrop`, `walkJob`, `openDropPreview`, `dropPreviewItems`, new `retryFailedPull`)
- Modify: `electron/core/ipc.ts`, `electron/core/ipc-handlers.ts`, `electron/sidebar-preload.ts`, `renderer/app/page.tsx`, `renderer/app/MailDropModal.tsx:26`

**Interfaces:**
- Consumes: Task 1 (`failedRowIndexes`, `replaceRows`), Task 2 (`retryRefusal`), Task 3 (`addMemberCounts`), Task 5 (`batchPullFailedThreads`).
- Produces:
  - `IPC.MAIL_DROP_PULL_RETRY = 'maildrop:pull-retry'`
  - `export async function retryFailedPull(arg: { retryId: string }): Promise<{ ok: true; items: MailDropPreviewItem[]; pullRetryId?: string } | { ok: false; error: string }>`
  - `MailDropPreview.pullRetryId?: string`
  - bridge: `retryMailDropPull(retryId: string): Promise<{ ok: true; items: MailDropItem[]; pullRetryId?: string } | { ok: false; error: string }>`

- [ ] **Step 1: Keep the subject of a conversation that failed**

In `fetchThreadSlice`'s `catch`, change `thread: { ...thread, subject: '' },` to `thread,` so the panel can name it. This only affects the preview row of a failed conversation.

- [ ] **Step 2: Split the writing tail out of `saveLabel`**

Move the block from `// Per conversation the last message, for the reason newestMessage carries` down to (and including) the `for (const c of collected) { saved.push(...savedRefs(...)) }` loop into:

```ts
/**
 * Writes collected conversations to disk and the log, one mail per conversation
 *
 * @param ts
 * @param account
 * @param root
 * @param label
 * @param collected
 * @returns the rows and saved files, or the write error when nothing could be written
 * @private
 */
async function writeCollected(
  ts: string,
  account: string,
  root: string,
  label: string,
  collected: CollectedThread[],
): Promise<{ items: MailDropPreviewItem[]; saved: SavedRef[]; logError: string | null }> {
  // the moved block, unchanged, except:
  // - the writeLabel catch returns { items: <the same per-conversation error rows>, saved: [], logError: null }
  // - the `if (capped) records.push(...)` stays in saveLabel, appended after this call
  // - it returns { items, saved, logError } instead of pushing the capped and log rows
}
```

`saveLabel` then calls it, pushes the `capped` record to the log and the `capped` / `logError` rows to `items` exactly as before, sets `lastDropTree`, and returns `{ items, saved, rows: collected.map((c) => c.messages.length), threads: collected.map((c) => c.thread) }`. Add `threads: TreeThread[]` to its return type; every early return (`empty()`, the batch-token failure) returns `threads: []`.

The capped record used to be written in the same `appendLog` call as the conversation records; writing it in a second call is the one behavioural difference, and it changes only the order of lines inside `log.jsonl`, not their content. If that is not acceptable, pass `extra: LogRecord[]` into `writeCollected` instead and append it there.

- [ ] **Step 3: Remember what failed**

Module state beside `lastCopyFailures`:

```ts
/** What the last pull could not fetch, held for the panel's retry button */
let lastPullFailures:
  | {
      retryId: string;
      serial: number;
      acctKey: string;
      account: string;
      authuser: string;
      ik: string;
      /** Rows of the preview that are conversations, which the strip counts */
      rowCount: number;
      at: number[];
      from: { kind: 'drag'; rows: MailDropPayload['items'] } | { kind: 'label'; label: string; threads: TreeThread[] };
    }
  | null = null;
```

Helper:

```ts
/**
 * Holds the failed rows of a pull for a retry, and tells a job's batch what it lost
 *
 * @param items the preview rows
 * @param ctx everything a second fetch of those rows needs
 * @returns the id the panel is given, or undefined when nothing failed
 * @private
 */
function rememberPullFailures(
  items: MailDropPreviewItem[],
  ctx: Omit<NonNullable<typeof lastPullFailures>, 'retryId' | 'serial' | 'at' | 'from'> & {
    from: (at: number[]) => NonNullable<typeof lastPullFailures>['from'];
  },
): string | undefined {
  const at = failedRowIndexes(items);
  batchPullFailedThreads = at.map((i) => items[i].threadId);
  if (at.length === 0 || activeJob) {
    lastPullFailures = null;
    return undefined;
  }
  const { from, ...rest } = ctx;
  lastPullFailures = { ...rest, retryId: randomUUID(), serial: dropSerial, at, from: from(at) };
  return lastPullFailures.retryId;
}
```

Call it:
- in `pullMailDrop`'s drag path, just before `manager?.sendDropResult(acctKey, dropOutcome(saved, lastError));`, with `rowCount: items.length` and `from: (at) => ({ kind: 'drag', rows: at.map((i) => items[i]) })`;
- in `pullMailDrop`'s label path, just before its `sendDropResult`, with `rowCount: rows.length` and `from: (at) => ({ kind: 'label', label: payload.label!, threads: at.map((i) => threads[i]) })` (destructure `threads` from `saveLabel`);
- in `walkJob`, right after its `saveLabel(...)` call, so `batchPullFailedThreads` speaks for the batch (`activeJob` is set there, so no offer is held).

At the start of `pullMailDrop` (beside `lastDropSaved = [];`) clear both: `lastPullFailures = null; lastCopyFailures = null;`.

- [ ] **Step 4: The preview carries the id**

Add `pullRetryId?: string` to `MailDropPreview` in `renderer/app/MailDropModal.tsx`. In `openDropPreview`, add `pullRetryId: lastPullFailures?.retryId` to the non-driven `overlay.open({ ... })` payload; in `dropPreviewItems`, add the same field to the returned object (include it in its return type).

- [ ] **Step 5: Share the pull lock**

Move the lock body of `handleMailDrop` — from `const token = dropLock.take(Date.now());` to the end of its `finally` — into:

```ts
/**
 * Runs a pull with every Gmail view veiled, and refuses when one is already running
 *
 * @param acctKey the view the strip answers in
 * @param run the pull itself
 * @returns false when the lock was taken
 * @private
 */
async function withPullLock(acctKey: string, run: () => Promise<void>): Promise<boolean> {
  // the moved body, with `await pullMailDrop(acctKey, payload, profile);` replaced by `await run();`
  // and `return false` where it answered BUSY_TEXT, `return true` after the finally
}
```

`handleMailDrop` then ends with `await withPullLock(acctKey, () => pullMailDrop(acctKey, payload, profile));`.

- [ ] **Step 6: The retry entry point**

```ts
/**
 * Fetches the conversations the last pull could not, and adds them to the drag
 *
 * @param arg the id the panel was given
 * @returns the preview rows with the retried ones in place, and a new id for what still failed
 */
export async function retryFailedPull(arg: {
  retryId: string;
}): Promise<{ ok: true; items: MailDropPreviewItem[]; pullRetryId?: string } | { ok: false; error: string }> {
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastPullFailures,
    serial: dropSerial,
    jobDriving,
    jobActive: activeJob !== null,
    pulling: activePull !== null,
    copying: activeRun !== null,
  });
  if (refused || !lastPullFailures) return { ok: false, error: refused ?? 'Niets om opnieuw op te halen' };
  const held = lastPullFailures;
  const ts = new Date().toISOString();
  const root = mailDropFolder();
  let next: MailDropPreviewItem[] = [];
  let added: SavedRef[] = [];

  const ran = await withPullLock(held.acctKey, async () => {
    const report = pullReporter();
    if (held.from.kind === 'drag') {
      const cache: ThreadReadCache = new Map();
      const rows = held.from.rows;
      report(0, rows.length);
      const results = await mapLimit(rows, DRAG_THREAD_LIMIT, (row) =>
        saveOneThread(ts, held.account, root, row.threadId, held.authuser, held.ik, row.message ?? null, row.messageUnknown ?? false, cache),
      );
      next = rows.map((row, i) => ({
        threadId: row.threadId,
        subject: row.subject ?? '',
        saved: results[i]?.count ?? 0,
        error: results[i]?.error,
      }));
      added = results.flatMap((r) => r?.saved ?? []);
      return;
    }
    const fetched = await fetchThreadSlice(held.account, held.from.threads, report);
    if (fetched === null) {
      next = held.from.threads.map((t) => ({ threadId: t.threadId, subject: t.subject, saved: 0, error: 'Geen toegang tot dit postvak' }));
      return;
    }
    const written = await writeCollected(ts, held.account, root, held.from.label, fetched);
    next = written.items;
    added = written.saved;
    if (lastDropTree) {
      const savedThreads = fetched.filter((c) => c.messages.length > 0).map((c) => c.thread);
      lastDropTree = { ...lastDropTree, members: addMemberCounts(lastDropTree.members, savedThreads) };
    }
  });
  if (!ran) return { ok: false, error: BUSY_TEXT };

  lastDropSaved = [...lastDropSaved, ...added];
  const items = replaceRows(lastDropPreview, held.at, next);
  lastDropPreview = items;
  lastScan = null;
  startExistingScan();
  const rows = items.slice(0, held.rowCount).map((i) => i.saved);
  manager?.sendDropResult(held.acctKey, dropOutcome(rows, items.find((i) => i.error)?.error));
  const pullRetryId = rememberPullFailures(items, {
    acctKey: held.acctKey,
    account: held.account,
    authuser: held.authuser,
    ik: held.ik,
    rowCount: held.rowCount,
    from: (at) => stillFailing(held.from, held.at, at),
  });
  notifyLog(`[maildrop] retry fetched ${added.length} of ${held.at.length} failed conversation(s)`);
  return { ok: true, items, ...(pullRetryId ? { pullRetryId } : {}) };
}

/**
 * The part of a held retry that failed again
 *
 * Every position still failing is one of the positions retried, since the other rows already
 * had mail, so each maps back to its own entry in the held list.
 *
 * @param from what the retry fetched, one entry per position in `tried`
 * @param tried the positions the retry fetched
 * @param still the positions that failed again
 * @returns the same kind of source, narrowed to `still`
 * @private
 */
function stillFailing(
  from: NonNullable<typeof lastPullFailures>['from'],
  tried: number[],
  still: number[],
): NonNullable<typeof lastPullFailures>['from'] {
  const slots = still.map((i) => tried.indexOf(i)).filter((slot) => slot >= 0);
  if (from.kind === 'drag') return { kind: 'drag', rows: slots.map((slot) => from.rows[slot]) };
  return { kind: 'label', label: from.label, threads: slots.map((slot) => from.threads[slot]) };
}
```

Check `startExistingScan` (~line 1604): if it keys its result on `dropSerial` and skips work when the serial is unchanged, clear `lastExisting = null` and whatever guard it uses before calling it, so the scan covers the added files.

- [ ] **Step 7: IPC and bridge**

`electron/core/ipc.ts`: `MAIL_DROP_PULL_RETRY: 'maildrop:pull-retry',`.

`electron/core/ipc-handlers.ts`:

```ts
  ipcMain.handle(IPC.MAIL_DROP_PULL_RETRY, (_e, arg: { retryId: string }) =>
    retryFailedPull({ retryId: String(arg?.retryId ?? '') }),
  );
```

`electron/sidebar-preload.ts`:

```ts
  retryMailDropPull: (retryId: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_PULL_RETRY, { retryId }),
```

`renderer/app/page.tsx` bridge type:

```ts
  retryMailDropPull(
    retryId: string,
  ): Promise<{ ok: true; items: MailDropItem[]; pullRetryId?: string } | { ok: false; error: string }>;
```

- [ ] **Step 8: Typecheck and full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run`
Expected: clean and green.

- [ ] **Step 9: Commit**

```bash
git add electron/mail/mail-drop-controller.ts electron/core/ipc.ts electron/core/ipc-handlers.ts electron/sidebar-preload.ts renderer/app/page.tsx renderer/app/MailDropModal.tsx
git commit -m "feat(maildrop): conversations a pull could not fetch can be fetched again"
```

---

### Task 7: Panel strings

**Files:**
- Modify: `renderer/app/strings.ts` (interface and all three sets)

**Interfaces:**
- Produces on `UiStrings`: `mdPullMissed(failed, total)`, `mdRetryPull`, `mdRetryCopy`, `mdRetrying`, `mdMaybeLanded`, `mdMoreFailures(n)`, `mdNoSubject`.

- [ ] **Step 1: Add the keys**

Interface, below `mdDropFailedTitle`:

```ts
  mdPullMissed: (failed: number, total: number) => string;
  mdRetryPull: string;
  mdRetryCopy: string;
  mdRetrying: string;
  mdMaybeLanded: string;
  mdMoreFailures: (n: number) => string;
  mdNoSubject: string;
```

`STRINGS_NORMAL`:

```ts
  mdPullMissed: (failed, total) => `${failed} of ${total} conversations not fetched`,
  mdRetryPull: 'Fetch the failed ones again',
  mdRetryCopy: 'Try the failed ones again',
  mdRetrying: 'Working…',
  mdMaybeLanded: 'may have arrived anyway',
  mdMoreFailures: (n) => `+ ${n} more`,
  mdNoSubject: '(no subject)',
```

`STRINGS_RENE`:

```ts
  mdPullMissed: (failed, total) => `${failed} van ${total} mailtjes niet opgehaald`,
  mdRetryPull: 'Mislukte nog een keer ophalen',
  mdRetryCopy: 'Mislukte nog een keer proberen',
  mdRetrying: 'Even bezig…',
  mdMaybeLanded: 'misschien toch aangekomen',
  mdMoreFailures: (n) => `+ ${n} meer`,
  mdNoSubject: '(geen onderwerp)',
```

`STRINGS_NL`:

```ts
  mdPullMissed: (failed, total) => `${failed} van ${total} gesprekken niet opgehaald`,
  mdRetryPull: 'Mislukte opnieuw ophalen',
  mdRetryCopy: 'Mislukte opnieuw proberen',
  mdRetrying: 'Bezig…',
  mdMaybeLanded: 'mogelijk toch aangekomen',
  mdMoreFailures: (n) => `+ ${n} meer`,
  mdNoSubject: '(geen onderwerp)',
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p renderer/tsconfig.json`
Expected: clean (a set missing a key fails here).

- [ ] **Step 3: Commit**

```bash
git add renderer/app/strings.ts
git commit -m "feat(maildrop): panel texts for failed mail and retrying it"
```

---

### Task 8: The panel draws the failures and the buttons

**Files:**
- Modify: `renderer/app/maildrop/page.tsx`

**Interfaces:**
- Consumes: Task 1 (`failedRowIndexes`, `cutList`), Task 5 (`retryMailDropCopy`, `MailDropCopyResult.retryId`, `accounts[].failures`), Task 6 (`retryMailDropPull`, `MailDropPreview.pullRetryId`), Task 7 strings, Task 4 (`JobEnd.failed`).

- [ ] **Step 1: State**

Beside `const [items, setItems] = ...`:

```tsx
  const [pullRetryId, setPullRetryId] = useState<string | null>(null);
  const [pullRetrying, setPullRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  /** Set while a copy retry is the copy on screen, so the duplicate screen's buttons answer it */
  const [copyRetryFrom, setCopyRetryFrom] = useState<string | null>(null);
```

In both preview handlers (`getMailDropPreview().then(...)` and `onMailDropPreview(...)`), read `pullRetryId` from the payload and `setPullRetryId(p.pullRetryId ?? null)`; in `onMailDropPreview`'s fresh-drag branch also `setCopyRetryFrom(null); setRetryError(null);`.

- [ ] **Step 2: One copy runner for both paths**

Rename the body of `copy` into `runCopy(call: () => Promise<CopyOrStoppedResult>, initial: 'check' | 'copy')`, keeping every line of the existing result handling, and define:

```tsx
  const copy = async (mode: MailDropCopyMode = 'check') => {
    const bridge = window.desktop;
    if (!bridge) return;
    // The duplicate screen's buttons answer whichever copy raised it
    if (copyRetryFrom) {
      const id = copyRetryFrom;
      await runCopy(() => bridge.retryMailDropCopy(id, mode) as Promise<CopyOrStoppedResult>, mode === 'all' ? 'copy' : 'check');
      return;
    }
    if (targets.length === 0) return;
    await runCopy(() => bridge.copyMailDrop(targets, mode) as Promise<CopyOrStoppedResult>, mode === 'all' ? 'copy' : 'check');
  };

  const retryCopy = async (retryId: string) => {
    setCopyRetryFrom(retryId);
    const bridge = window.desktop;
    if (!bridge) return;
    await runCopy(() => bridge.retryMailDropCopy(retryId, 'check') as Promise<CopyOrStoppedResult>, 'check');
  };
```

In `runCopy`, when the result lands in `done` and carries no `retryId`, or lands in `stopped`, call `setCopyRetryFrom(null)`. When it carries a `retryId`, leave `copyRetryFrom` as it is: the next press passes the new id explicitly.

The ordinary Kopieer button in the picking footer must start a fresh copy whatever `copyRetryFrom` holds. `setState` does not apply before the call that follows it, so it gets its own function instead of clearing the state and calling `copy`:

```tsx
  const copyFresh = () => {
    const bridge = window.desktop;
    if (!bridge || targets.length === 0) return;
    setCopyRetryFrom(null);
    return runCopy(() => bridge.copyMailDrop(targets, 'check') as Promise<CopyOrStoppedResult>, 'check');
  };
```

and the picking footer's Kopieer button becomes `onClick={() => void copyFresh()}`. The duplicate screen's Annuleren (`setPhase({ kind: 'picking' })`) also calls `setCopyRetryFrom(null)`.

- [ ] **Step 3: Pull retry**

```tsx
  const retryPull = async () => {
    const bridge = window.desktop;
    if (!bridge || !pullRetryId || pullRetrying) return;
    setPullRetrying(true);
    setRetryError(null);
    try {
      const r = await bridge.retryMailDropPull(pullRetryId);
      if (!r.ok) {
        setRetryError(r.error);
        return;
      }
      // The labels already picked stay picked: this is the same drag with more of it saved
      setItems(r.items);
      setPullRetryId(r.pullRetryId ?? null);
      loadExisting();
    } catch (e) {
      setRetryError((e as Error).message);
    } finally {
      setPullRetrying(false);
    }
  };
```

`loadExisting` is declared inside the mount effect; lift it to a `useCallback` at component level so `retryPull` can call it, and keep the effect calling the lifted one.

- [ ] **Step 4: Draw the pull misses**

Compute beside `failures`:

```tsx
  const misses = failedRowIndexes(items).map((i) => items[i]);
```

Add a component in the helper-components section:

```tsx
/**
 * The conversations a pull could not fetch, above the label choice
 *
 * @param misses
 * @param total conversations in the drag
 * @param busy
 * @param error why the last retry was refused
 * @param onRetry absent when there is nothing to retry
 * @param S
 */
function PullMisses({
  misses,
  total,
  busy,
  error,
  onRetry,
  S,
}: {
  misses: MailDropItem[];
  total: number;
  busy: boolean;
  error: string | null;
  onRetry?: () => void;
  S: UiStrings;
}) {
  const { shown, more } = cutList(misses);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2.5 dark:bg-red-500/10">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{S.mdPullMissed(misses.length, total)}</p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((m, i) => (
          <li key={`${m.threadId}-${i}`} className="truncate text-xs text-red-700 dark:text-red-400">
            ✕ {m.subject || S.mdNoSubject} — {m.error}
          </li>
        ))}
        {more > 0 && <li className="text-xs text-red-700 dark:text-red-400">{S.mdMoreFailures(more)}</li>}
      </ul>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="self-start rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? S.mdRetrying : S.mdRetryPull}
        </button>
      )}
    </div>
  );
}
```

Draw it in two places:

- In picking with a partial failure, a new block directly above the `LabelSearch` block:

```tsx
          {phase.kind === 'picking' && failures.length === 0 && misses.length > 0 && (
            <div className="shrink-0 border-b border-black/5 px-5 pb-3 pt-3 dark:border-white/10">
              <PullMisses
                misses={misses}
                total={items.filter((i) => i.threadId).length}
                busy={pullRetrying}
                error={retryError}
                onRetry={pullRetryId ? () => void retryPull() : undefined}
                S={S}
              />
            </div>
          )}
```

- In the all-failed branch, below `<DropFailure reasons={failures} S={S} />`, the same component with the same props when `misses.length > 0`.

- [ ] **Step 5: Draw the copy failures**

Give `CopyReport` two more props, `onRetry?: () => void` and `busy: boolean`, and inside each account's `<li>`, below its count line:

```tsx
            {a.failures && a.failures.length > 0 && (
              <FailureList lines={a.failures} S={S} />
            )}
```

with:

```tsx
/**
 * The mails one mailbox did not receive
 *
 * @param lines
 * @param S
 */
function FailureList({ lines, S }: { lines: { subject: string; error: string; maybeLanded: boolean }[]; S: UiStrings }) {
  const { shown, more } = cutList(lines);
  return (
    <ul className="flex flex-col gap-0.5 pl-1">
      {shown.map((l, i) => (
        <li key={i} className="truncate text-xs text-red-700 dark:text-red-400">
          ✕ {l.subject || S.mdNoSubject} — {l.error}
          {l.maybeLanded && <span className="text-amber-700 dark:text-amber-500"> · {S.mdMaybeLanded}</span>}
        </li>
      ))}
      {more > 0 && <li className="text-xs text-red-700 dark:text-red-400">{S.mdMoreFailures(more)}</li>}
    </ul>
  );
}
```

Below the `<ul>` of accounts in `CopyReport`:

```tsx
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {S.mdRetryCopy}
        </button>
      )}
```

At the call site: `<CopyReport result={phase.result} busy={false} onRetry={phase.result.retryId ? () => void retryCopy(phase.result.retryId!) : undefined} S={S} />`. The button disappears by itself once the phase leaves `done`.

- [ ] **Step 6: Honest colours for a finished job**

In `JobReport`, the line colour: `end.outcome === 'completed' && !(end.failed ?? 0)` → green; `end.outcome === 'completed'` with failures → `text-amber-700 dark:text-amber-500`; `stuck` stays red. In `Status`'s `done` branch with `r.job`, use the same rule instead of `r.ok`. In its non-job `done` branch, `bad` already turns red when an account has an error, which every account with failures has.

- [ ] **Step 7: Typecheck, suite, and a look**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run`
Expected: clean and green.

Check `electron.exe` is not running before any build (see memory: never build while the dev server runs). Start the dev app with `npm run dev`, drag a conversation, and confirm the panel still opens and copies as before.

- [ ] **Step 8: Commit**

```bash
git add renderer/app/maildrop/page.tsx
git commit -m "feat(maildrop): the panel lists failed mail and offers to try it again"
```

---

### Task 9: Live check against the scratch label

No code. The owner, or the agent with the owner watching, runs these against the scratch test label (confirm **which mailbox** before starting, not whether the mail matters).

- [ ] **Pull failure:** drag three conversations; cut the network the moment the strip says `0 van 3 opgehaald`; restore it. Expect the strip in red, the panel's red block naming the failed conversations, and `Mislukte opnieuw ophalen` fetching them. Then pick a label, copy, and check in Gmail that each mail is there once.
- [ ] **Copy failure:** drag three conversations; pick a label; press Kopieer and cut the network during `Kopiëren`; restore it. Expect per-mail lines under the mailbox, `mogelijk toch aangekomen` beside any time-out, and `Mislukte opnieuw proberen` landing them in the same label. Check in Gmail: no mail twice. If a `mogelijk toch aangekomen` mail shows the duplicate screen, that is the guard working.
- [ ] **Stale offer:** cause a copy failure, then drag something new, then go back — the old panel is gone; a retry from a stale id (if it can still be pressed) is refused with `Deze lijst is verlopen`.
- [ ] **notify.log:** the lines `retry of N failed copies` and `retry fetched X of Y failed conversation(s)` appear; `copy … failed` counts go down after a retry.

Record the outcome in memory (`label-tree-copy`-style project note) with the date; the batched-job retry (part 2) is still open.
