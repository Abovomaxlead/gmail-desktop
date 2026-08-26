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
  needsJob,
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
