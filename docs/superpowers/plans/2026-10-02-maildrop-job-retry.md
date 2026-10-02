# Retrying the mail a batched job lost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A batched label job that ends completed with losses offers one button (in the panel, and through a toast when the panel is closed) that fetches the conversations no batch could fetch and copies everything that did not land into the job's own mailboxes and labels.

**Architecture:** A pure module `electron/mail/job-failures.ts` owns the merge rules. `mail-drop-controller.ts` gathers per batch, holds one `lastJobFailures` offer at a completed end, raises a toast, and runs `retryFailedJob` (fetch under the pull lock, then the part-1 retry copy path). The panel routes the button and the confirm screen by a `retryKind`.

**Tech Stack:** Electron main (TypeScript), Next 16 / React 19 renderer, vitest, `tsc --noEmit` for both projects.

**Spec:** `docs/superpowers/specs/2026-10-02-maildrop-job-retry-design.md` (part 1: `docs/superpowers/specs/2026-10-02-maildrop-failure-retry-design.md`)

## Global Constraints

- Nothing about which mail is saved, which labels it gets, file and folder names, or log content may change.
- The renderer sends only `retryId` and `mode`; the IPC handler narrows `mode` to `check | new | all`.
- Never return the picker to `picking` for a job end, a job report or a toast click; never touch `previewMayPick`, `panelMayWalk`, `panelBelongsToJob` or the `walking` phase handling.
- Offer only on a `completed` job end with losses; any other ending discards the gathered losses.
- `JOB_BATCH_THREADS` (2000) caps the conversations fetched per press.
- Every refusal goes through `retryRefusal` with `copying: activeRun !== null || retryInFlight`.
- Comments: banner sections, one-line third-person docblocks without trailing period, rare one-line inline comments above the line, English. UI strings in all three sets of `renderer/app/strings.ts`; toast texts in `electron/menus/native-labels.ts` (both languages and René mode if that file has it).

## Review Focus

- **A toast click while the panel shows a fresh drag's picker** — the panel switches to the job report only if the offer is still held; a stale toast must not throw the user out of a picker they are using. Pinned in Task 3 (payload carries the offer id; panel ignores a `jobEnd` whose `retryId` main no longer holds — main sends `jobEnd` only while held).
- **Confirm-screen follow-up after a job retry** — `new`/`all` must call the job retry again and skip step A. Pinned in Task 2 (step A only in mode `check`).
- **Everything lands on retry** — no button, no stale offer. Pinned in Task 1 (`isEmpty`).
- **More than 2000 unfetched** — only 2000 fetched per press; the rest stays. Pinned in Task 1 (`takePullSlice`).
- **A file that failed in mailbox A only** — retried into A only, never into B. Pinned in Task 1 (`retryFiles` per email).

---

### Task 1: Merge rules (`electron/mail/job-failures.ts`)

**Files:**
- Create: `electron/mail/job-failures.ts`
- Test: `tests/job-failures.test.ts`

**Interfaces:**
- Produces:
  - `interface JobFailures<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }> { copy: TargetFailures<T, F>[]; pull: P[] }`
  - `emptyJobFailures<T, F, P>(): JobFailures<T, F, P>`
  - `addCopyFailures(acc, batch: TargetFailures<T, F>[]): JobFailures` — merge per `target.email`; a file (by `file` identity or `file.messageId` + `threadId`) once per mailbox
  - `addPullFailures(acc, threads: P[]): JobFailures` — merge by `threadId`
  - `takePullSlice(acc, max): { slice: P[]; rest: P[] }`
  - `addFetchedToAllTargets(acc, targets: T[], files: F[]): JobFailures` — every target gets every file (once)
  - `retryFiles(acc): Map<string, F[]>` — email → files
  - `isEmpty(acc): boolean`
  - `lostConversations(acc): number` — distinct threadIds across copy and pull
  (`FailedFileRef`, `TargetFailures`, `FailedFile` come from `./copy-failures`.)

- [ ] **Step 1: Write the failing test**

```ts
// How a job's losses are gathered across batches and handed to one retry.

import { describe, it, expect } from 'vitest';
import {
  addCopyFailures,
  addFetchedToAllTargets,
  addPullFailures,
  emptyJobFailures,
  isEmpty,
  lostConversations,
  retryFiles,
  takePullSlice,
} from '../electron/mail/job-failures';

type T = { email: string; labelIds: string[] };
type F = { threadId: string; subject: string; messageId: string };
type P = { threadId: string; subject: string; labels: string[] };

const a: T = { email: 'a@x.nl', labelIds: ['L1'] };
const b: T = { email: 'b@x.nl', labelIds: ['L2'] };
const f = (id: string): F => ({ threadId: id, subject: id, messageId: `<${id}@x>` });
const p = (id: string): P => ({ threadId: id, subject: '', labels: ['Klanten'] });
const lost = (file: F) => ({ file, error: 'quota', maybeLanded: false });

describe('addCopyFailures', () => {
  it('merges batches per mailbox', () => {
    let acc = emptyJobFailures<T, F, P>();
    acc = addCopyFailures(acc, [{ target: a, files: [lost(f('t1'))] }]);
    acc = addCopyFailures(acc, [{ target: a, files: [lost(f('t2'))] }, { target: b, files: [lost(f('t3'))] }]);
    expect(retryFiles(acc).get('a@x.nl')?.map((x) => x.threadId)).toEqual(['t1', 't2']);
    expect(retryFiles(acc).get('b@x.nl')?.map((x) => x.threadId)).toEqual(['t3']);
  });

  it('keeps a file once per mailbox', () => {
    let acc = emptyJobFailures<T, F, P>();
    acc = addCopyFailures(acc, [{ target: a, files: [lost(f('t1'))] }]);
    acc = addCopyFailures(acc, [{ target: a, files: [lost(f('t1'))] }]);
    expect(retryFiles(acc).get('a@x.nl')).toHaveLength(1);
  });

  // Review focus: a file that failed in one mailbox is never retried into another
  it('never puts a file in a mailbox it did not fail in', () => {
    const acc = addCopyFailures(emptyJobFailures<T, F, P>(), [{ target: a, files: [lost(f('t1'))] }]);
    expect(retryFiles(acc).has('b@x.nl')).toBe(false);
  });

  it('drops a mailbox entry that lost nothing', () => {
    const acc = addCopyFailures(emptyJobFailures<T, F, P>(), [{ target: a, files: [] }]);
    expect(isEmpty(acc)).toBe(true);
  });
});

describe('addPullFailures and takePullSlice', () => {
  it('merges by conversation', () => {
    let acc = addPullFailures(emptyJobFailures<T, F, P>(), [p('t1'), p('t2')]);
    acc = addPullFailures(acc, [p('t2'), p('t3')]);
    expect(acc.pull.map((x) => x.threadId)).toEqual(['t1', 't2', 't3']);
  });

  // Review focus: more than a batch is fetched a batch at a time
  it('takes at most max per press and keeps the rest', () => {
    const acc = addPullFailures(emptyJobFailures<T, F, P>(), [p('t1'), p('t2'), p('t3')]);
    const { slice, rest } = takePullSlice(acc, 2);
    expect(slice.map((x) => x.threadId)).toEqual(['t1', 't2']);
    expect(rest.map((x) => x.threadId)).toEqual(['t3']);
  });
});

describe('addFetchedToAllTargets', () => {
  it('sends a newly fetched mail to every mailbox of the job', () => {
    const acc = addFetchedToAllTargets(emptyJobFailures<T, F, P>(), [a, b], [f('t9')]);
    expect(retryFiles(acc).get('a@x.nl')?.[0].threadId).toBe('t9');
    expect(retryFiles(acc).get('b@x.nl')?.[0].threadId).toBe('t9');
  });

  it('does not double a file a mailbox already holds', () => {
    let acc = addCopyFailures(emptyJobFailures<T, F, P>(), [{ target: a, files: [lost(f('t9'))] }]);
    acc = addFetchedToAllTargets(acc, [a], [f('t9')]);
    expect(retryFiles(acc).get('a@x.nl')).toHaveLength(1);
  });
});

describe('isEmpty and lostConversations', () => {
  // Review focus: everything landed means no offer
  it('is empty when nothing was lost', () => {
    expect(isEmpty(emptyJobFailures<T, F, P>())).toBe(true);
  });

  it('counts a conversation once across mailboxes and the pull', () => {
    let acc = addCopyFailures(emptyJobFailures<T, F, P>(), [
      { target: a, files: [lost(f('t1'))] },
      { target: b, files: [lost(f('t1'))] },
    ]);
    acc = addPullFailures(acc, [p('t2')]);
    expect(lostConversations(acc)).toBe(2);
    expect(isEmpty(acc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/job-failures.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement**

```ts
// What a batched job lost across all its batches, gathered so one retry at the end can send
// exactly that mail again. Pure: the controller owns when, this owns how they merge.

import type { FailedFile, FailedFileRef, TargetFailures } from './copy-failures';


//===========================
// Types
//===========================

export interface JobFailures<
  T extends { email: string },
  F extends FailedFileRef,
  P extends { threadId: string },
> {
  copy: TargetFailures<T, F>[];
  pull: P[];
}


//===========================
// Exported functions
//===========================

export function emptyJobFailures<
  T extends { email: string },
  F extends FailedFileRef,
  P extends { threadId: string },
>(): JobFailures<T, F, P> {
  return { copy: [], pull: [] };
}

/**
 * Adds one batch's copy failures, per mailbox
 *
 * @param acc
 * @param batch the copy's failures, one entry per mailbox written to
 * @returns a new record; a mailbox holds each file once
 */
export function addCopyFailures<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  batch: TargetFailures<T, F>[],
): JobFailures<T, F, P> {
  const copy = acc.copy.map((t) => ({ target: t.target, files: [...t.files] }));
  for (const entry of batch) {
    if (entry.files.length === 0) continue;
    let held = copy.find((t) => t.target.email === entry.target.email);
    if (!held) {
      held = { target: entry.target, files: [] };
      copy.push(held);
    }
    for (const lost of entry.files) {
      if (!held.files.some((h) => sameFile(h.file, lost.file))) held.files.push(lost);
    }
  }
  return { copy, pull: acc.pull };
}

/**
 * Adds conversations a batch could not fetch
 *
 * @param acc
 * @param threads
 * @returns a new record; a conversation appears once
 */
export function addPullFailures<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  threads: P[],
): JobFailures<T, F, P> {
  const pull = [...acc.pull];
  for (const t of threads) if (!pull.some((h) => h.threadId === t.threadId)) pull.push(t);
  return { copy: acc.copy, pull };
}

/**
 * Splits off the conversations one retry press fetches
 *
 * @param acc
 * @param max conversations per press
 * @returns the slice to fetch now and what stays for the next press
 */
export function takePullSlice<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  max: number,
): { slice: P[]; rest: P[] } {
  return { slice: acc.pull.slice(0, max), rest: acc.pull.slice(max) };
}

/**
 * Hands mail a retry has just fetched to every mailbox of the job
 *
 * @param acc
 * @param targets the job's mailboxes
 * @param files the newly saved mail, which landed nowhere yet
 * @returns a new record
 */
export function addFetchedToAllTargets<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  targets: T[],
  files: F[],
): JobFailures<T, F, P> {
  const fresh: FailedFile<F>[] = files.map((file) => ({ file, error: '', maybeLanded: false }));
  return addCopyFailures(acc, targets.map((target) => ({ target, files: fresh })));
}

export function retryFiles<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): Map<string, F[]> {
  return new Map(acc.copy.map((t) => [t.target.email, t.files.map((f) => f.file)]));
}

export function isEmpty<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): boolean {
  return acc.pull.length === 0 && acc.copy.every((t) => t.files.length === 0);
}

/**
 * How many conversations the job still owes, in the unit the job line speaks
 *
 * @param acc
 * @returns distinct conversations across mailboxes and the pull
 */
export function lostConversations<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): number {
  const ids = new Set(acc.pull.map((p) => p.threadId));
  for (const t of acc.copy) for (const f of t.files) ids.add(f.file.threadId);
  return ids.size;
}


//===========================
// Helper functions
//===========================

function sameFile(a: FailedFileRef, b: FailedFileRef): boolean {
  return a === b || (a.threadId === b.threadId && a.messageId === b.messageId);
}
```

- [ ] **Step 4: Run it to see it pass**, then `npx vitest run` and `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(maildrop): rules for gathering what a job lost across batches`.

---

### Task 2: Main side — gather, offer, toast, retry

**Files:**
- Modify: `electron/mail/mail-drop-controller.ts`, `electron/mail/mail-copy.ts` (`CopyResult.unfetched?`), `electron/core/ipc.ts`, `electron/core/ipc-handlers.ts`, `electron/sidebar-preload.ts`, `renderer/app/page.tsx` (bridge type), `renderer/app/MailDropModal.tsx` (`MailDropCopyResult.unfetched?`, `MailDropPreview.jobEnd?`), `renderer/lib/maildrop-copy.ts` (`JobEnd.retryId?`), `renderer/lib/toast.ts` (`ToastKind` gains `'maildrop'`), `electron/toast/toast-activation.ts`, `electron/menus/native-labels.ts`, and whatever wires `ToastActivationHooks` (find `setToastActivationHooks`).

**Interfaces:**
- Consumes Task 1 (`job-failures.ts`), part 1 (`copy-failures.ts`, `retryRefusal`, `failureLines`, `withPullLock`, `fetchThreadSlice`, `writeCollected`, `rememberPullFailures`, `retryInFlight`, `copiedSerial`, the `retry` argument of `copyToMailboxes`).
- Produces:
  - `IPC.MAIL_DROP_JOB_RETRY = 'maildrop:job-retry'`; `export async function retryFailedJob(arg: { retryId: string; mode?: CopyMode })` returning the `copyToMailboxes` union, with `retryId?` meaning the **job** offer and `unfetched?: FailureLine[]`
  - `export function showJobReport(): void` — opens the overlay on the held job report
  - bridge `retryMailDropJob(retryId: string, mode?: MailDropCopyMode): Promise<MailDropCopyResult>`
  - preview payload / `dropPreviewItems()` carry `jobEnd?: JobEndInfo` (with `retryId`) **only while `lastJobFailures` is held**

Steps (read the spec's "Design" section first; line numbers drift — find by name):

- [ ] **Step 1: Gather.** Module state `jobFailures` (typed with `MailDropCopyTarget`, `SavedRef`, `TreeThread`) and `jobFailuresFor: string | null` (the jobId). Reset both when `planJob` writes a new plan and when a job is resumed. In `copyToMailboxes`' completed (never-stopped) tail, when `activeJob` is set (batch 0 from the picker and every driven batch), `jobFailures = addCopyFailures(jobFailures, failuresByTarget)`. In `rememberPullFailures`, when `activeJob` is set, add the failed rows' threads: change its `from` callers so `walkJob` passes the batch's real threads (`saveLabel` already returns `threads`; map the failed positions to them) and `pullMailDrop`'s label path does the same for batch 0. Do not change what is shown or recorded per batch.
- [ ] **Step 2: Offer at the end.** In `walkJob`'s ending, only when it ends `completed` (not stuck), and `!isEmpty(jobFailures)`: `lastJobFailures = { retryId: randomUUID(), serial: dropSerial, jobId, account: job.account, label: job.label, targets: job.choices.targets, acc: jobFailures }`. Every other ending (stuck, stopped, rolled back, `endWalkedJob` from any path) sets `jobFailures` empty and leaves no offer. Add `retryId?` to `JobEndInfo` and pass it through `sendJobEnd`/`endWalkedJob` (only for the completed-with-offer case). Keep `lastJobEnd` (the `JobEndInfo` just sent) in module state while the offer is held. `pullMailDrop`'s start clears `lastJobFailures` and `lastJobEnd` along with the part-1 offers.
- [ ] **Step 3: Toast.** With an offer, call `showToast({ kind: 'maildrop', title: <closing line>, body: <click hint>, persist: true })`. Add `'maildrop'` to `ToastKind`; check the toast renderer (`renderer/app/toast*` or wherever `kind` is switched on for an icon) handles an unknown kind or add a case. Add `jobRetryToastTitle(done, total, failed)` and `jobRetryToastBody` to `native-labels.ts` (NL `Klus klaar — ${done} van ${total} gekopieerd, ${failed} mislukt` / `Klik om het opnieuw te proberen`; EN `Job finished — ${done} of ${total} copied, ${failed} failed` / `Click to try them again`; René variant if the file has one). In `activateToast`, `if (toast.kind === 'maildrop') { hooks.openJobReport(); return; }`; add `openJobReport` to `ToastActivationHooks` and wire it to `showJobReport` where the hooks are set.
- [ ] **Step 4: `showJobReport`.** If no offer is held: just focus the main window. Otherwise open the overlay the way `openDropPreview` does (create it if needed), with payload `{ items: [], tree: null, jobEnd: lastJobEnd, locale, reneMode, dark }` — never `driven`. `dropPreviewItems()` adds `jobEnd: lastJobEnd` while the offer is held.
- [ ] **Step 5: `retryFailedJob`.** Refuse via `retryRefusal({ wanted, held: lastJobFailures, serial: dropSerial, jobDriving, jobActive: activeJob !== null, pulling: activePull !== null, copying: activeRun !== null || retryInFlight })`. Set `retryInFlight` for the whole call (try/finally) right after the refusal passes. Step A only in mode `check` and when `acc.pull` is non-empty: `takePullSlice(acc, JOB_BATCH_THREADS)`; `withPullLock(<the job's account view key, or the active view's key if none — read how acctKey is used by sendDropResult and choose one that exists>, async () => { fetched = await fetchThreadSlice(account, slice, pullReporter()); written = await writeCollected(ts, account, root, label, fetched ?? [], []) })`; stale check after the lock exactly as `retryFailedPull` does; new refs → `addFetchedToAllTargets(acc, targets, written.saved)`; threads in `slice` whose row still failed plus `rest` become the new `acc.pull`. Write the updated `acc` back to `lastJobFailures` before step B, so a confirm follow-up sees the fetched files and skips step A. Step B: `copyToMailboxes({ targets: [], mode, retry: { targets: targets.filter(t => retryFiles(acc).has(t.email)), files: retryFiles(acc), retryId: lastJobFailures.retryId }, jobRetry: true })` (when no target has files and pull is empty, return a plain ok result). Add `jobRetry?: boolean` to `copyToMailboxes`' argument: when set, the completed tail does **not** hold `lastCopyFailures`; `retryFailedJob` instead rebuilds `lastJobFailures.acc = { copy: <the run's failuresByTarget>, pull: <remaining pull> }` — expose the run's failures to the caller (e.g. a module-level `lastRunFailures` the tail sets, or a field on the result stripped before it reaches IPC; choose the smaller change and say which). Fresh `retryId` when not empty, else `lastJobFailures = null`. On a stopped result, `lastJobFailures = null`. The returned result carries `retryId` = the new job offer id (or none) and `unfetched: failureLines`-style lines for `acc.pull` (`subject` may be empty).
- [ ] **Step 6: IPC.** `MAIL_DROP_JOB_RETRY` handler with `mode` narrowed exactly like the other two; preload `retryMailDropJob`; bridge type; result and preview type fields.
- [ ] **Step 7:** `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p renderer/tsconfig.json && npx vitest run`; commit `feat(maildrop): a finished job offers to send what it lost, from the panel or a toast`.

---

### Task 3: The panel

**Files:** `renderer/app/maildrop/page.tsx`, `renderer/app/strings.ts`

- [ ] **Step 1: Strings** (all three sets, below `mdRetryCopy`): `mdStillUnfetched: (n) => …` — NL `${n} gesprek${n === 1 ? '' : 'ken'} nog steeds niet opgehaald`, EN `${n} conversation${n === 1 ? '' : 's'} still not fetched`, René `${n} mailtje${n === 1 ? '' : 's'} nog steeds niet opgehaald`.
- [ ] **Step 2: Payload with `jobEnd`.** In both preview handlers (`getMailDropPreview().then` and `onMailDropPreview`), when the payload carries `jobEnd`: `setPhase(phaseFromJobEnd(jobEnd, S))`, clear the job line, and return before any picking reset. This branch sits before `previewMayPick` so it never reaches `setPhase({ kind: 'picking' })`. `phaseFromJobEnd` must carry `end.retryId` into the result's `job`.
- [ ] **Step 3: Routing.** Replace `copyRetryFrom`'s meaning with `{ report, kind: 'copy' | 'job', retryId }` (or add `retryKind` beside it — smallest change). `copy(mode)` on the confirm screen calls `retryMailDropJob` for `kind: 'job'`, `retryMailDropCopy` for `'copy'`. Annuleren returns to the stored report in both cases.
- [ ] **Step 4: Button on the job report.** `JobReport` gets `onRetry?`; shown when `end.retryId` is set and the outcome is `completed`. It runs `runCopy(() => bridge.retryMailDropJob(retryId, 'check'), 'check')` after storing `{ report: current done result, kind: 'job', retryId }`. In `runCopy`, a result whose `retryId` came from a job retry keeps `kind: 'job'` for the next press; `CopyReport`'s retry button calls the job retry when the stored kind is `'job'`.
- [ ] **Step 5: Unfetched block.** `CopyReport` shows, above the accounts, a red block with `S.mdStillUnfetched(result.unfetched.length)` and the lines through `FailureList` (subject falls back to `S.mdNoSubject`).
- [ ] **Step 6:** both typechecks and the full suite; commit `feat(maildrop): the job report offers the retry and shows what is still missing`.

---

### Task 4: Live check (owner)

Scratch label of more than 2000 conversations into one mailbox; cut the network briefly during batch 2.
- [ ] Closing line amber with `N mislukt` and the button.
- [ ] Close the panel before the end: the toast appears; clicking it opens the panel on the report, never the picker.
- [ ] The button fetches and copies; in Gmail each mail is there once, in the job's labels.
- [ ] Retry → duplicate screen → Annuleren returns to the job report.
