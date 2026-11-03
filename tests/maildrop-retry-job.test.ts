// A batched label job, walked by the real mail-drop controller against a fake Gmail, and the
// retry its closing line offers. Batches are two conversations here instead of two thousand,
// so five conversations make a job of three batches. The rule every scenario comes back to is
// the one the drag tests hold too: per mailbox, per Message-ID, a mail that should land lands
// exactly once, under exactly the chosen labels, and nothing lands anywhere else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../electron/core/ipc';
import type { MailDropCopyResult } from '../electron/core/ipc';
import type * as LabelJobModule from '../electron/mail/job/label-job';
import { findUnfinishedJobs, readLabelJob, type LabelJob } from '../electron/mail/job/label-job';
import {
  SOURCE,
  TARGET_A,
  TARGET_B,
  startHarness,
  stopHarness,
  type Harness,
  type JobEndPayload,
} from './support/controller-harness';


//===========================
// Mocks
//===========================

// The controller reads the batch size through this export only: planJob, the existing-scan
// limit at module load, and the retry's pull slice
vi.mock('../electron/mail/job/label-job', async () => ({
  ...(await vi.importActual<typeof LabelJobModule>('../electron/mail/job/label-job')),
  JOB_BATCH_THREADS: 2,
}));


//===========================
// Setup
//===========================

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await stopHarness();
});


//===========================
// Scenarios
//===========================

describe('a job that lost one insert in its second batch', () => {
  it('ends with an offer and a toast, and the retry lands that mail once', async () => {
    const job = await dragJob();
    const [lost, kept] = job.batchIds[1];
    h.fake.failInsert(TARGET_A, lost, 'quota');

    const end = await copyAndWalk(job);
    expect(end).toEqual(
      expect.objectContaining({ outcome: 'completed', done: 4, total: 5, batches: 3, copiedBatches: 3, failed: 1 }),
    );
    expect(end.retryId).toEqual(expect.any(String));
    expect(h.state.toasts).toEqual([
      {
        id: 'toast-1',
        input: {
          kind: 'maildrop',
          title: 'Klus klaar — 4 van 5 gekopieerd, 1 mislukt',
          body: 'Klik om het opnieuw te proberen',
          persist: true,
        },
      },
    ]);
    expect(h.controller.dropPreviewItems().jobEnd?.retryId).toBe(end.retryId);
    expect(h.inserts(TARGET_A, lost)).toBe(0);
    expect(h.inserts(TARGET_A, kept)).toBe(1);
    expectLandedExcept(job, [lost]);

    const retried = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(retried.ok).toBe(true);
    expect(retried.copied).toBe(1);
    expect(retried.retryId).toBeUndefined();
    expect(h.fake.attempts(TARGET_A, lost)).toBe(2);
    expect(h.state.dismissed).toEqual(['toast-1']);
    expectLandedExcept(job, []);

    const again = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(again.ok).toBe(false);
    expect(again.error).toBe('Deze lijst is verlopen. Sleep de mail opnieuw.');
    expectLandedExcept(job, []);
  });
});

describe('a job that could not fetch one conversation of its second batch', () => {
  it('offers it, and the retry fetches it once more and lands it once', async () => {
    const job = await dragJob();
    const [unfetched, sibling] = job.batchThreads[1];
    const [lost] = job.batchIds[1];
    h.fake.failFetch(SOURCE, unfetched, 1);

    const end = await copyAndWalk(job);
    expect(end).toEqual(expect.objectContaining({ outcome: 'completed', done: 4, total: 5, failed: 1 }));
    expect(end.retryId).toEqual(expect.any(String));
    expect([h.fake.fetches(SOURCE, unfetched), h.fake.fetches(SOURCE, sibling)]).toEqual([1, 1]);
    expectLandedExcept(job, [lost]);

    const retried = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(retried.ok).toBe(true);
    expect(retried.copied).toBe(1);
    expect(retried.retryId).toBeUndefined();
    expect(retried.unfetched).toBeUndefined();
    expect([h.fake.fetches(SOURCE, unfetched), h.fake.fetches(SOURCE, sibling)]).toEqual([2, 1]);
    expect(h.fake.attempts(TARGET_A, lost)).toBe(1);
    expectLandedExcept(job, []);

    const again = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(again.ok).toBe(false);
    expect(again.error).toBe('Deze lijst is verlopen. Sleep de mail opnieuw.');
    expect(h.fake.fetches(SOURCE, unfetched)).toBe(2);
    expectLandedExcept(job, []);
  });

  it('renews the offer when the retry cannot fetch it either, and the next press lands it once', async () => {
    const job = await dragJob();
    const [unfetched] = job.batchThreads[1];
    const [lost] = job.batchIds[1];
    h.fake.failFetch(SOURCE, unfetched, 2);
    const end = await copyAndWalk(job);
    expect(end.retryId).toEqual(expect.any(String));

    const renewed = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(renewed.ok).toBe(false);
    expect(renewed.copied).toBe(0);
    expect(renewed.retryId).toEqual(expect.any(String));
    expect(renewed.retryId).not.toBe(end.retryId);
    expect(renewed.unfetched).toEqual([expect.objectContaining({ error: expect.stringContaining('Ophalen mislukt') })]);
    expect(h.fake.fetches(SOURCE, unfetched)).toBe(2);
    expect(h.fake.attempts(TARGET_A, lost)).toBe(0);
    expectLandedExcept(job, [lost]);

    const stale = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(stale.error).toBe('Deze lijst is verlopen. Sleep de mail opnieuw.');

    const landed = (await h.retryJob(renewed.retryId!, 'check')) as MailDropCopyResult;
    expect(landed.ok).toBe(true);
    expect(landed.copied).toBe(1);
    expect(landed.retryId).toBeUndefined();
    expect(landed.unfetched).toBeUndefined();
    expect(h.fake.fetches(SOURCE, unfetched)).toBe(3);
    expect(h.fake.attempts(TARGET_A, lost)).toBe(1);
    expectLandedExcept(job, []);
  });
});

describe('a job whose second batch was refused its whole pull once', () => {
  it('ends the walk stuck, and a continue pulls that batch again and nothing else', async () => {
    const job = await dragJob();
    for (const t of job.batchThreads[1]) h.fake.failFetch(SOURCE, t);

    const stuck = await copyAndWalk(job);
    expect(stuck.outcome).toBe('stuck');
    expect(stuck.retryId).toBeUndefined();
    expect(job.batchThreads[1].map((t) => h.fake.fetches(SOURCE, t))).toEqual([1, 1]);
    expect(h.state.toasts).toEqual([]);
    expectLandedOnly(job, job.batchIds[0]);

    const end = await restartAndContinue(job);
    expect(end).toEqual(expect.objectContaining({ outcome: 'completed', done: 5, total: 5, failed: 0 }));
    expect(end.retryId).toBeUndefined();
    expect(job.batchThreads.map((ts) => ts.map((t) => h.fake.fetches(SOURCE, t)))).toEqual([[1, 1], [2, 2], [1]]);
    expect(h.state.toasts).toEqual([]);
    expect(h.controller.dropPreviewItems().jobEnd).toBeUndefined();
    expectLandedExcept(job, []);
  });
});

describe('a job whose second batch keeps refusing', () => {
  it('ends stuck after one pull of that batch, with the batch failed on disk and no offer', async () => {
    const job = await dragJob();
    for (const t of job.batchThreads[1]) h.fake.failFetch(SOURCE, t, 1000);

    // A walk that re-pulls a refused batch would end only after 1000 pulls; the fetch count is the guard
    const end = await copyAndWalk(job, 200);
    expect(end.outcome).toBe('stuck');
    expect(end.retryId).toBeUndefined();
    expect(job.batchThreads[1].map((t) => h.fake.fetches(SOURCE, t))).toEqual([1, 1]);
    expect(job.batchThreads[2].map((t) => h.fake.fetches(SOURCE, t))).toEqual([0]);
    expect(h.sent(IPC.MAIL_DROP_PREVIEW).filter((p) => (p as { driven?: boolean }).driven)).toHaveLength(1);
    const plan = readLabelJob(h.root, job.plan.jobId)!;
    expect(plan.outcome).toBeNull();
    expect(plan.batches.map((b) => b.state)).toEqual(['copied', 'failed', 'pending']);
    expect(h.state.toasts).toEqual([]);
    expect(h.controller.dropPreviewItems().jobEnd).toBeUndefined();
    expectLandedOnly(job, job.batchIds[0]);
  });
});

describe('a stuck job continued after a restart', () => {
  it('completes with its loss counted once, and holds no offer and raises no toast', async () => {
    const job = await dragJob();
    const [lost, other] = job.batchIds[1];
    h.fake.failInsert(TARGET_A, lost, 'quota', 2);
    h.fake.failInsert(TARGET_A, other, 'quota');

    const stuck = await copyAndWalk(job);
    expect(stuck).toEqual(expect.objectContaining({ outcome: 'stuck', failed: 2 }));
    expect(stuck.retryId).toBeUndefined();
    expectLandedOnly(job, job.batchIds[0]);

    const end = await restartAndContinue(job);
    expect(end).toEqual(expect.objectContaining({ outcome: 'completed', done: 4, total: 5, failed: 1 }));
    expect(end.retryId).toBeUndefined();
    expect(h.state.toasts).toEqual([]);
    expect(h.controller.dropPreviewItems().jobEnd).toBeUndefined();
    expect(h.fake.attempts(TARGET_A, lost)).toBe(2);
    expect(h.fake.attempts(TARGET_A, other)).toBe(2);
    expectLandedExcept(job, [lost]);
  });
});

describe('a job retry whose copy throws after its mail landed', () => {
  it('drops the offer, so the same retry is refused and nothing lands twice', async () => {
    const job = await dragJob();
    const [lost] = job.batchIds[1];
    h.fake.failInsert(TARGET_A, lost, 'quota');
    const end = await copyAndWalk(job);
    expect(end.retryId).toEqual(expect.any(String));

    // The insert lands; the token lookup of the marker sweep right after it throws
    const hold = h.fake.holdNext('insertMessage');
    const pressed = h.retryJob(end.retryId!, 'check');
    await hold.entered;
    h.state.onToken = () => {
      throw new Error('token store unreadable');
    };
    hold.release();
    await expect(pressed).rejects.toThrow('token store unreadable');
    h.state.onToken = null;
    expect(h.inserts(TARGET_A, lost)).toBe(1);
    expect(h.state.dismissed).toEqual(['toast-1']);
    expect(h.controller.dropPreviewItems().jobEnd).toBeUndefined();

    const again = (await h.retryJob(end.retryId!, 'check')) as MailDropCopyResult;
    expect(again.ok).toBe(false);
    expect(again.error).toBe('Deze lijst is verlopen. Sleep de mail opnieuw.');
    expect(h.fake.attempts(TARGET_A, lost)).toBe(2);

    // The unswept marker is the next start's to strip, from the decision the run recorded
    await h.fresh();
    await h.controller.resumeOrphanedCopyRuns();
    expectLandedExcept(job, []);
  });
});


//===========================
// Helper functions
//===========================

interface DraggedJob {
  plan: LabelJob;
  label: string;
  ids: string[];
  /** Per batch its conversations, in plan order */
  batchThreads: string[][];
  /** Per batch the Message-IDs of its conversations, in plan order */
  batchIds: string[][];
}

/**
 * Drags a source label of five conversations, which plans a job of three batches
 *
 * @returns the plan as written, the target label and the mail per batch
 */
async function dragJob(): Promise<DraggedJob> {
  const source = h.fake.addLabel(SOURCE, 'Groot');
  const { ids, threadIds } = h.seedConversations(5, [source]);
  const label = h.fake.addLabel(TARGET_A, 'Doel');
  const preview = await h.dragLabel('Groot');
  const plans = findUnfinishedJobs(h.root);
  expect(plans).toHaveLength(1);
  const plan = plans[0];
  expect(plan.batches.map((b) => b.threads.length)).toEqual([2, 2, 1]);
  const batchThreads = plan.batches.map((b) => b.threads.map((t) => t.threadId));
  expect(preview?.items.map((i) => i.threadId)).toEqual(batchThreads[0]);
  expect(preview?.items.map((i) => i.saved)).toEqual([1, 1]);
  const batchIds = batchThreads.map((ts) => ts.map((t) => ids[threadIds.indexOf(t)]));
  return { plan, label, ids, batchThreads, batchIds };
}

/**
 * Copies batch zero from the picker into TARGET_A's label and waits for the walk to end
 *
 * @param job
 * @param maxTurns the cap on the wait
 * @returns the job end the panel was sent
 */
async function copyAndWalk(job: DraggedJob, maxTurns?: number): Promise<JobEndPayload> {
  const first = (await h.copy([{ email: TARGET_A, labelIds: [job.label] }], 'check')) as MailDropCopyResult;
  expect(first.ok).toBe(true);
  expect(first.copied).toBe(2);
  return await h.waitForJobEnd(maxTurns);
}

/**
 * Restarts the controller over the same disk, and continues the job its start offers
 *
 * The offer is only ever shown by the drop panel, which asks for it when it opens, and only a
 * drag opens that panel -- so an unrelated mail is dragged first, as the user would have to.
 *
 * @param job
 * @returns the job end of the resumed walk
 */
async function restartAndContinue(job: DraggedJob): Promise<JobEndPayload> {
  const seen = jobEnds().length;
  await h.fresh();
  await h.controller.resumeOrphanedCopyRuns();
  h.fake.seedThread(SOURCE, 'thread-panel', [{ messageId: '<panel@harness.test>', subject: 'Paneel' }]);
  await h.drag([{ threadId: 'thread-panel', subject: 'Paneel' }]);
  expect(h.controller.pendingJobDecision()?.jobId).toBe(job.plan.jobId);
  expect(await h.decideJob(job.plan.jobId, 'continue')).toEqual({ ok: true });
  await h.waitFor(() => jobEnds().length > seen, 'the resumed job end');
  return jobEnds()[jobEnds().length - 1];
}

/** Every job end the controller delivered to a panel that was showing */
function jobEnds(): JobEndPayload[] {
  return h
    .sent(IPC.MAIL_DROP_COPY_PROGRESS)
    .map((p) => (p as { jobEnd?: JobEndPayload }).jobEnd)
    .filter((e): e is JobEndPayload => e !== undefined);
}

/**
 * Holds the central rule with every mail of the job landed in TARGET_A except the lost ones
 *
 * @param job
 * @param lost the Message-IDs that must not have landed
 */
function expectLandedExcept(job: DraggedJob, lost: string[]): void {
  expectLandedOnly(job, job.ids.filter((id) => !lost.includes(id)));
}

/**
 * Holds the central rule with exactly these mails landed in TARGET_A, under the chosen label
 *
 * @param job
 * @param landed
 */
function expectLandedOnly(job: DraggedJob, landed: string[]): void {
  h.expectLanded(TARGET_A, Object.fromEntries(landed.map((id) => [id, [job.label]])));
  h.expectLanded(TARGET_B, {});
  h.expectLanded(SOURCE, {});
}
