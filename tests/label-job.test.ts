// The plan behind a label too big for one run: how it is sliced, what it remembers, and what a
// half-written file reads back as. The file itself is the unit under test alongside the pure
// parts, the same way tests/copy-journal.test.ts treats its own journal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
import { chunk } from '../electron/mail/chunk';
// A batch's own run says which mailboxes it opened, and the plan points at that run by id --
// the link the note at the top of label-job.ts describes. Written here the way the copy writes
// it, so the reading side is proved against the real record and not against a fixture.
import { startCopyJournal } from '../electron/mail/copy-journal';

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
  const slices = chunk(all, batchSize);
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

  // What the live figures fix: without them the line froze on the finished-batch sum for the
  // whole of a batch -- "2000 van 3535" for twenty minutes, seen on 2026-08-26.
  it('adds what the running batch has copied so far', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 1, targets: 1 }).done).toBe(3);
  });

  // The trap this whole change is about: the closure counts inserts, one per message per
  // mailbox, and the line counts conversations. Three mailboxes must not run the line to
  // three times the total.
  it('does not multiply the running batch by the number of mailboxes', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 3, targets: 3 }).done).toBe(3);
    expect(jobProgress(job, { phase: 'copy', done: 6, targets: 3 }).done).toBe(4);
  });

  // A conversation of five mails is five inserts per mailbox, so the normalised figure runs
  // past the batch's own conversation count. It stops at the batch.
  it('never credits the running batch beyond its own conversations', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 40, targets: 1 }).done).toBe(4);
  });

  // During 'check' that same counter is the duplicate scan's, and folding it in would move the
  // line before a single mail had gone out.
  it('ignores the running batch while it is still scanning for duplicates', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'check', done: 2, targets: 1 }).done).toBe(2);
  });

  it('never reports less than the batches already finished', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: -5, targets: 1 }).done).toBe(2);
    expect(jobProgress(job, { phase: 'copy', done: 0, targets: 0 }).done).toBe(2);
  });

  // The last batch is short: two finished batches plus a running one of two must not report
  // more conversations than the job was planned with.
  it('never reports more than the job total', () => {
    written(5, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'copied', runId: 'run-b', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 2, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 99, targets: 1 })).toEqual({
      batch: 3,
      batches: 3,
      done: 5,
      total: 5,
    });
  });

  // A job whose batches are all copied has nothing running to fold in, whatever is passed.
  it('folds in nothing once every batch is copied', () => {
    written(4, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'copied', runId: 'run-b', copied: 2 });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 2, targets: 1 }).done).toBe(4);
  });

  // A copy into no mailbox at all cannot be turned into conversations, and reading the raw
  // insert count as one credited a whole batch to a run where every mailbox had failed its
  // marker and nothing had gone out.
  it('credits the running batch nothing when there is no mailbox to divide by', () => {
    written(6, 2);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 2 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;
    expect(jobProgress(job, { phase: 'copy', done: 900, targets: 0 }).done).toBe(2);
  });
});

describe('jobProgress.batch', () => {
  // The line said "Batch 4 van 4 loopt" over a job that never got past its second: nextBatch
  // answers null for a stuck job exactly as it does for a finished one, and the fallback took
  // the last batch for both. The panel's own closing line already named the failed batch, so
  // the two contradicted each other.
  it('names the batch that stopped the job, not the last one', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'failed', error: 'Geen rechten' });
    const at = jobProgress(readLabelJob(root, 'job-1')!);
    expect(at.batch).toBe(2);
    expect(at.batches).toBe(4);
  });

  it('names the batch being worked on while the job is walking', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    expect(jobProgress(readLabelJob(root, 'job-1')!).batch).toBe(2);
  });

  // Pinned rather than changed: a finished job has no batch under way, and the last one is the
  // one it finished on.
  it('names the last batch once every batch is copied', () => {
    written(100, 25);
    for (const index of [0, 1, 2, 3]) {
      recordJobBatchState(root, 'job-1', { index, state: 'copied', runId: `run-${index}`, copied: 25 });
    }
    expect(jobProgress(readLabelJob(root, 'job-1')!).batch).toBe(4);
  });

  // Zero, because there is no batch one to point at. Reachable only defensively -- needsJob
  // keeps a label that fits out of a plan entirely -- but "batch 1 van 0" would be a claim and
  // this is not.
  it('names no batch at all for a plan with no batches', () => {
    expect(jobProgress(written(0, 25))).toEqual({ batch: 0, batches: 0, done: 0, total: 0 });
  });
});

describe('jobProgress on a failed batch', () => {
  /** A four-batch plan of 25 whose first batch is copied and whose second failed after
   * managing `copied` inserts into `targets` mailboxes. */
  const stuckAfter = (copied: number, targets: number): LabelJob => {
    written(100, 25);
    recordJobChoices(root, 'job-1', {
      targets: Array.from({ length: targets }, (_, i) => ({
        email: `box${i}@example.com`,
        labelIds: ['Label_1'],
      })),
      mode: 'new',
    });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', {
      index: 1,
      state: 'failed',
      runId: 'run-b',
      copied,
      error: 'Geen rechten',
    });
    return readLabelJob(root, 'job-1')!;
  };

  // Mail that really moved. A batch that failed after copying twenty of its twenty-five had
  // those twenty in the mailbox, and reporting the job as 25 of 100 understated it by every one
  // of them -- in that run and in every resume after it.
  it('counts what the failed batch managed before it failed', () => {
    expect(jobProgress(stuckAfter(20, 1)).done).toBe(45);
  });

  // Its count is in the copy's own unit, one per message per mailbox, exactly like the running
  // batch's -- and the mailbox count is on disk in the choices, so a resume can divide too.
  it('divides a failed batch by the mailboxes it was copying into', () => {
    expect(jobProgress(stuckAfter(60, 3)).done).toBe(45);
  });

  it('never credits a failed batch beyond its own slice', () => {
    expect(jobProgress(stuckAfter(999, 1)).done).toBe(50);
  });

  it('credits a failed batch nothing when it recorded no count', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'failed', error: 'Geen rechten' });
    expect(jobProgress(readLabelJob(root, 'job-1')!).done).toBe(25);
  });

  // No choices means no mailbox count to divide by, so there is nothing to convert its inserts
  // with. Zero rather than a guess.
  it('credits a failed batch nothing when the job never recorded its choices', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'failed', copied: 20, error: 'Nee' });
    expect(jobProgress(readLabelJob(root, 'job-1')!).done).toBe(25);
  });

  // A stuck job has no batch under way, so a running figure handed in anyway must not be added
  // on top of the failed batch's own count.
  it('adds no running figure on top of a stuck batch', () => {
    expect(jobProgress(stuckAfter(20, 1), { phase: 'copy', done: 25, targets: 1 }).done).toBe(45);
  });

  // The seam. A mailbox that cannot be given a marker label is never inserted into, so the
  // copy's count is spread over the mailboxes that were ready and not over the mailboxes that
  // were chosen. Dividing by the chosen ones understated a failed batch by exactly the share of
  // every mailbox that dropped out -- the understatement this whole function exists to stop, and
  // a disagreement with the live line, which divides by the ready ones.
  describe('when a mailbox dropped out before the copy', () => {
    /** Batch 0 copied; batch 1 failed after `copied` inserts into a run whose journal names
     * `ready` mailboxes, while the job's choices name three. */
    const droppedOut = (copied: number, ready: number): LabelJob => {
      written(100, 25);
      recordJobChoices(root, 'job-1', {
        targets: [
          { email: 'a@example.com', labelIds: ['L'] },
          { email: 'b@example.com', labelIds: ['L'] },
          { email: 'c@example.com', labelIds: ['L'] },
        ],
        mode: 'new',
      });
      recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 75 });
      // The run's own record of which mailboxes it opened, written by the copy before its first
      // insert. This is where the ready count comes from.
      startCopyJournal(
        root,
        'run-b',
        Array.from({ length: ready }, (_, i) => `box${i}@example.com`),
        2_000,
      );
      recordJobBatchState(root, 'job-1', {
        index: 1,
        state: 'failed',
        runId: 'run-b',
        copied,
        error: 'Geen rechten',
      });
      return readLabelJob(root, 'job-1')!;
    };

    it('remembers how many mailboxes the batch was really writing to', () => {
      expect(droppedOut(40, 2).batches[1].mailboxes).toBe(2);
    });

    // 40 inserts across the two mailboxes that were ready is 20 conversations. Divided by the
    // three that were chosen it reads 13, and the line would drop by seven the moment the batch
    // was recorded.
    it('divides by the mailboxes it wrote to, not by the ones that were chosen', () => {
      expect(jobProgress(droppedOut(40, 2)).done).toBe(45);
    });

    it('still divides by the chosen mailboxes when no run recorded its own', () => {
      expect(jobProgress(stuckAfter(60, 3)).done).toBe(45);
    });
  });
});

// Continuing a stuck job appends a bare 'pending' line for the failed batch, which carries no
// count of its own. Folded in wholesale that erased what the batch had managed, and the line the
// user was reading dropped by a batch the moment they accepted the offer -- while the mail it
// counted was still sitting in the mailbox.
describe('jobProgress when a stuck batch is taken up again', () => {
  const retried = (): LabelJob => {
    written(100, 25);
    recordJobChoices(root, 'job-1', {
      targets: [{ email: 'a@example.com', labelIds: ['L'] }],
      mode: 'new',
    });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    startCopyJournal(root, 'run-b', ['a@example.com'], 2_000);
    recordJobBatchState(root, 'job-1', {
      index: 1,
      state: 'failed',
      runId: 'run-b',
      copied: 20,
      error: 'Geen rechten',
    });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pending' });
    return readLabelJob(root, 'job-1')!;
  };

  it('keeps what the batch managed when a later line does not mention it', () => {
    const batch = retried().batches[1];
    expect(batch.state).toBe('pending');
    expect(batch.copied).toBe(20);
    expect(batch.mailboxes).toBe(1);
  });

  it('goes on counting that mail, which never left the mailbox', () => {
    expect(jobProgress(retried()).done).toBe(45);
  });

  // The batch is being copied again, so its own count and the running figure describe the same
  // conversations. The larger of the two, never the sum.
  it('does not count the retried batch twice while it copies again', () => {
    expect(jobProgress(retried(), { phase: 'copy', done: 5, targets: 1 }).done).toBe(45);
    expect(jobProgress(retried(), { phase: 'copy', done: 22, targets: 1 }).done).toBe(47);
  });
});

// The gap the contract has to own up to. `running` counts every message the copy attempted,
// duplicates it skipped included; `copied` counts only the inserts that landed. A batch that
// skipped most of its mail and then failed is recorded well below what the line was showing, so
// the line steps back without any restart.
describe('jobProgress when a batch fails below what it was showing', () => {
  const failedAfterRunning = (copied: number): LabelJob => {
    written(100, 25);
    recordJobChoices(root, 'job-1', {
      targets: [{ email: 'a@example.com', labelIds: ['L'] }],
      mode: 'new',
    });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    startCopyJournal(root, 'run-b', ['a@example.com'], 2_000);
    recordJobBatchState(root, 'job-1', { index: 1, state: 'failed', runId: 'run-b', copied });
    return readLabelJob(root, 'job-1')!;
  };

  it('steps back to what the batch actually inserted', () => {
    written(100, 25);
    recordJobChoices(root, 'job-1', {
      targets: [{ email: 'a@example.com', labelIds: ['L'] }],
      mode: 'new',
    });
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    const mid = readLabelJob(root, 'job-1')!;
    expect(jobProgress(mid, { phase: 'copy', done: 25, targets: 1 }).done).toBe(50);
    expect(jobProgress(failedAfterRunning(0)).done).toBe(25);
  });

  it('never steps back below what the plan file accounts for', () => {
    expect(jobProgress(failedAfterRunning(0)).done).toBe(25);
    expect(jobProgress(failedAfterRunning(20)).done).toBe(45);
  });
});

describe('jobProgress across a restart', () => {
  // The half of the docblock's claim that is true: everything the plan file accounts for reads
  // back identically, so a resumed job never starts lower than the last run's finished batches.
  it('reads the same numbers back off the plan file', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'copied', runId: 'run-b', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 2, state: 'pulled' });
    const before = jobProgress(readLabelJob(root, 'job-1')!);
    const after = jobProgress(readLabelJob(root, 'job-1')!);
    expect(after).toEqual(before);
    expect(after.done).toBe(50);
  });

  // The half that is not, held to the bound the docblock now states instead of the equivalence
  // it used to claim: the running batch is nowhere on disk, so a restart falls back to the
  // on-disk figure -- never below it, and never by more than that batch's own slice.
  it('falls back to the plan file by at most the running batch, never below it', () => {
    written(100, 25);
    recordJobBatchState(root, 'job-1', { index: 0, state: 'copied', runId: 'run-a', copied: 25 });
    recordJobBatchState(root, 'job-1', { index: 1, state: 'pulled' });
    const job = readLabelJob(root, 'job-1')!;

    const beforeCrash = jobProgress(job, { phase: 'copy', done: 60, targets: 3 });
    const afterResume = jobProgress(readLabelJob(root, 'job-1')!);

    expect(beforeCrash.done).toBe(45);
    expect(afterResume.done).toBe(25);
    expect(afterResume.done).toBeLessThanOrEqual(beforeCrash.done);
    expect(beforeCrash.done - afterResume.done).toBeLessThanOrEqual(25);
    // And the batch it names does not move: that part is on disk.
    expect(afterResume.batch).toBe(beforeCrash.batch);
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
