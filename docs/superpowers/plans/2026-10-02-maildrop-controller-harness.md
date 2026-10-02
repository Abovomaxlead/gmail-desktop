# A test harness for the mail-drop controller — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drive the real `electron/mail/mail-drop-controller.ts` against an in-memory fake Gmail, so the retry paths of the failure-retry feature (parts 1 and 2) are tested end to end, above all the rule *every mail lands exactly once, and only where it was sent*.

**Architecture:** `tests/support/fake-gmail.ts` implements the Gmail functions the controller imports (`electron/gmail/gmail-api.ts` surface it uses) over per-mailbox stores, with injectable failures. `tests/support/controller-harness.ts` holds the `vi.mock` wiring for Electron, `core/runtime`, tokens, OAuth config, account domain, overlay, toasts, notify log, and the drop folder in a temp dir, plus helpers to drag, copy, retry and read what the overlay was sent. The controller, journals, log, label-job plan, copy-failures, job-failures and mail-archive all run for real. Test-only: no product code changes, except a fix for a real bug a scenario finds — then in its own commit, named in the report.

**Spec:** `docs/superpowers/specs/2026-10-02-maildrop-failure-retry-design.md` and `docs/superpowers/specs/2026-10-02-maildrop-job-retry-design.md`.

## Global Constraints

- The central assertion in every scenario: per mailbox, per Message-ID, the number of successful inserts is exactly 1 for mail that should land and 0 elsewhere; labels on the stored message are exactly the chosen ones (plus the run's hidden marker until it is swept).
- Gmail's index lag is modelled: the fake's duplicate lookup (`labelsHoldingMany`) only sees messages inserted more than a configurable number of "ticks" ago, default 0; scenarios about lag set it explicitly.
- Real files in a temp dir per test; cleaned in `afterEach`. No network, no Electron, no real timers longer than the test needs (use the code's own injectable waits, or `vi.useFakeTimers` only where a scenario needs it).
- Existing mocking pattern: see `tests/crash-send.test.ts` (`vi.mock('electron')`, `vi.mock('../electron/core/runtime', getters)`). Module state in the controller is per import: use `vi.resetModules()` + dynamic `import()` per test so each test gets a fresh controller.
- Comments: banner sections, one-line third-person docblocks without trailing period, rare one-line inline comments, English. Test names in English.
- Commits in English; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` in the body.

---

### Task 1: The fake Gmail, the harness, and the first scenario

**Files:** create `tests/support/fake-gmail.ts`, `tests/support/controller-harness.ts`, `tests/maildrop-retry-drag.test.ts`.

- [ ] Read `electron/mail/mail-drop-controller.ts` imports (lines ~15-230) and every call site of the Gmail functions it imports (`insertMessage`, `labelsHoldingMany`, `mailboxCanary`, `createHiddenLabel`, `createVisibleLabel`, `deleteLabel`, `fetchLabels`, `fetchUserLabelMap`, `fetchMessageListPage`, `fetchThreadMessages`, `fetchThreadRaw`, `listLabelThreadIds`, `batchModifyMessages`, `markerLabelName`, `isSystemLabelId`, `insertMayHaveLanded`, plus whatever `copy-marker-run-sweep.ts` / `copy-marker-sweep.ts` / `mailbox-token.ts` reach). Implement each in the fake with the same signature and answer shape. Re-export the real `GmailHttpError`, `GmailTimeoutError`, `GmailCancelledError`, `GmailUnreadableSuccessError`, `insertMayHaveLanded`, `markerLabelName`, `isSystemLabelId`, `BATCH_MODIFY_LIMIT` from the real module (`vi.importActual`) so error classification stays real.
- [ ] Fake state: `mailboxes: Map<email, { messages: { id, threadId, raw, messageId, labelIds, insertedAt }[], labels: { id, name, type }[] }>`, source threads for fetching (`threadId → raw messages`), an insert counter per (email, Message-ID), and a failure queue: `failInsert(email, messageId, kind, times)` with kind `'quota'` (GmailHttpError 429, not stored), `'timeout-landed'` (store, then throw GmailTimeoutError), `'timeout'` (not stored, GmailTimeoutError), `'net'` (Error 'net::ERR_CONNECTION_RESET', not stored); `failFetch(threadId, times)`.
- [ ] Harness: mocks for `electron` (`app.getPath` → temp dir, `session.fromPartition` stub), `../electron/core/runtime` (profiles for a source and target mailboxes, `oauthTokens`, `prefs`, `manager` with `sendDropResult`/`sendDropLock`/`activeKey`, `dropOverlay` capturing `send`/`open`, `setDropOverlay`, `messageIndex` real or null, `recentLabels` stub), `../electron/auth/mailbox-token` (tokens for every mailbox), `../electron/auth/oauth-config`, `../electron/auth/account-domain` (`isAllowedAccount` true for the domain), `../electron/windows/overlay-view` (class capturing sends), `../electron/toast/toast-presenter`, `../electron/notify/notify-log`, `../electron/mail/mail-folder` (temp dir), `../electron/gmail/gmail-api` → the fake. Helpers: `fresh()` (resetModules + import controller), `drag(items)` (calls `handleMailDrop` with a payload carrying `ik`), `copy(targets, mode)`, `retryCopy(id, mode)`, `retryPull(id)`, `lastPreview()`, `inserts(email, messageId)`.
- [ ] Scenario 1 in `tests/maildrop-retry-drag.test.ts`: drag 3 conversations, target one mailbox with label L; mail 2 fails once with `'quota'`. Assert: result `accounts[0].failures` names mail 2, `retryId` set, inserts 1/0/1. Then `retryCopy(retryId, 'check')`: mail 2 inserted once, others still once, no `retryId` left.
- [ ] `npx vitest run tests/maildrop-retry-drag.test.ts`, full suite, `npx tsc --noEmit -p tsconfig.json`. Commit.

### Task 2: Drag and copy scenarios

**Files:** extend `tests/maildrop-retry-drag.test.ts` (and the support files when a scenario needs a new fake capability).

- [ ] **Timeout that landed:** mail 2 `'timeout-landed'`. Result lists it with `maybeLanded: true`. `retryCopy(id,'check')` with lag 0 → `needsConfirm` with mail 2 as duplicate; then `retryCopy(id,'new')` → mail 2 inserts stays 1.
- [ ] **Double press:** start `retryCopy` twice without awaiting the first; the second answers a refusal; inserts stay exactly 1.
- [ ] **Whole-drag Kopieer after a copy:** after scenario 1's first copy, `copy(targets,'check')` is refused with the already-copied text; no inserts change. Also after the retry.
- [ ] **Pull failure:** conversation 2 `failFetch` once. The preview has `pullRetryId`; `retryPull(id)` fetches it; `copy` lands all three once.
- [ ] **Stale offer:** copy with a failure, then a new `drag`, then `retryCopy(oldId)` → refused as expired; no inserts.
- [ ] **Two mailboxes, failure in one:** targets A and B; mail 2 fails in B only. Retry inserts mail 2 into B once and never into A again (A stays 1).
- [ ] Each scenario asserts the central rule for every mailbox. Run, full suite, tsc, commit.

### Task 3: Job scenarios

**Files:** create `tests/maildrop-retry-job.test.ts`.

- [ ] Make jobs small: mock `../electron/mail/label-job` with `vi.importActual` and override `JOB_BATCH_THREADS` to 2 (check every place the controller reads the batch size; if it is not read through the module export, mock whatever it is read through and say so).
- [ ] Drive a label drag over the fake's label listing (5 conversations → 3 batches), choose the job targets from the first batch's preview (`copy`), let the driver walk (await until the overlay is sent a `jobEnd`).
- [ ] **Losses in batch 2:** one insert in batch 2 fails `'quota'`. `jobEnd.retryId` set, `failed` 1, toast raised. `retryFailedJob` lands it once; all other mail once.
- [ ] **Batch pull fails, then succeeds on re-pull:** batch 2's fetch fails for every conversation once. No stale pull losses in the end offer (`failed` counts only what is really missing); retry inserts nothing twice.
- [ ] **Batch keeps refusing:** make batch 2's copy refuse without recording state (e.g. the fetch keeps failing so no file is saved). The job ends `stuck` within a bounded number of driver turns (assert the turn count / fetch count is bounded), no offer.
- [ ] **Resumed job:** end a job stuck, then resume via `decideJobRun(jobId,'continue')` in a fresh controller import; the job completes with a loss; `jobEnd.retryId` absent, no toast.
- [ ] **Throw during job retry:** make `insertMessage` throw a non-Gmail error mid-retry once; after the throw the offer is gone (a second `retryFailedJob` with the same id is refused).
- [ ] Central rule asserted throughout. Run, full suite, tsc, commit.

### Task 4: Report

- [ ] Any scenario that exposed a real controller bug: fixed in its own commit, before the test that pins it is committed green; listed in the report with the scenario that found it.
