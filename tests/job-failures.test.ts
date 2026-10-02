// How a job's losses are gathered across batches and handed to one retry.

import { describe, it, expect } from 'vitest';
import {
  addCopyFailures,
  addFetchedToAllTargets,
  addPullFailures,
  emptyJobFailures,
  isEmpty,
  lostConversations,
  replaceBatchPull,
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

describe('replaceBatchPull', () => {
  // Review focus: a batch pulled again must not keep its earlier attempt's losses
  it('clears a batch the later attempt fetched in full', () => {
    let acc = replaceBatchPull(emptyJobFailures<T, F, P>(), ['t1', 't2'], [p('t1'), p('t2')]);
    acc = replaceBatchPull(acc, ['t1', 't2'], []);
    expect(acc.pull).toEqual([]);
  });

  it('keeps only what the later attempt still lost', () => {
    let acc = replaceBatchPull(emptyJobFailures<T, F, P>(), ['t1', 't2'], [p('t1'), p('t2')]);
    acc = replaceBatchPull(acc, ['t1', 't2'], [p('t2')]);
    expect(acc.pull.map((x) => x.threadId)).toEqual(['t2']);
  });

  it('leaves other batches untouched', () => {
    let acc = replaceBatchPull(emptyJobFailures<T, F, P>(), ['t1'], [p('t1')]);
    acc = replaceBatchPull(acc, ['t5', 't6'], [p('t6')]);
    acc = replaceBatchPull(acc, ['t5', 't6'], []);
    expect(acc.pull.map((x) => x.threadId)).toEqual(['t1']);
  });

  it('does not mutate its input', () => {
    const before = replaceBatchPull(emptyJobFailures<T, F, P>(), ['t1'], [p('t1')]);
    const after = replaceBatchPull(before, ['t1'], []);
    expect(before.pull.map((x) => x.threadId)).toEqual(['t1']);
    expect(after).not.toBe(before);
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
