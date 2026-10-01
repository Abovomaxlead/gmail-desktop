// The per-insert record a copy run leaves behind, and whether it says how it ended.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  journalPath,
  startCopyJournal,
  appendCopyJournalEntry,
  finishCopyJournal,
  readCopyJournal,
  parseCopyJournal,
  findOrphanedRuns,
  attemptWrite,
  recordCopyJournalEntry,
  recordCopyJournalLabel,
  recordCopyJournalDecision,
  withWarnings,
} from '../electron/mail/copy-journal';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copy-journal-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('startCopyJournal and appendCopyJournalEntry', () => {
  it('reads back entries in the order they were written', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 1000);
    appendCopyJournalEntry(dir, { runId: 'run-1', email: 'a@x.nl', gmailId: 'g1', labelIds: ['L1'] });
    appendCopyJournalEntry(dir, { runId: 'run-1', email: 'a@x.nl', gmailId: 'g2', labelIds: ['L1'] });
    expect(readCopyJournal(dir, 'run-1')?.entries.map((e) => e.gmailId)).toEqual(['g1', 'g2']);
  });

  it('keeps the thread id and label ids an entry was given', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    appendCopyJournalEntry(dir, {
      runId: 'run-1',
      email: 'a@x.nl',
      gmailId: 'g1',
      threadId: 't1',
      labelIds: ['INBOX', 'L1'],
    });
    expect(readCopyJournal(dir, 'run-1')?.entries[0]).toEqual({
      runId: 'run-1',
      email: 'a@x.nl',
      gmailId: 'g1',
      threadId: 't1',
      labelIds: ['INBOX', 'L1'],
    });
  });

  it('writes one line per call rather than batching them', () => {
    startCopyJournal(dir, 'run-1', [], 0);
    appendCopyJournalEntry(dir, { runId: 'run-1', email: 'a@x.nl', gmailId: 'g1', labelIds: [] });
    appendCopyJournalEntry(dir, { runId: 'run-1', email: 'a@x.nl', gmailId: 'g2', labelIds: [] });
    const raw = readFileSync(journalPath(dir, 'run-1'), 'utf8');
    // header + two inserts, and each already durable before the next call is made
    expect(raw.trim().split('\n')).toHaveLength(3);
  });
});

describe('startCopyJournal, markers', () => {
  it('records each mailbox\'s own marker label, for a resumed sweep to act on', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl', 'b@x.nl'], 0, [
      { email: 'a@x.nl', markerLabelId: 'M1' },
      { email: 'b@x.nl', markerLabelId: 'M2' },
    ]);
    expect(readCopyJournal(dir, 'run-1')?.markers).toEqual([
      { email: 'a@x.nl', markerLabelId: 'M1' },
      { email: 'b@x.nl', markerLabelId: 'M2' },
    ]);
  });

  it('defaults to no markers when a caller records none', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    expect(readCopyJournal(dir, 'run-1')?.markers).toEqual([]);
  });
});

describe('recordCopyJournalDecision', () => {
  it('is read back as decidedMode', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    recordCopyJournalDecision(dir, 'run-1', 'rollback');
    expect(readCopyJournal(dir, 'run-1')?.decidedMode).toBe('rollback');
  });

  it('is null before any decision is recorded -- the case a resume must still ask about', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    expect(readCopyJournal(dir, 'run-1')?.decidedMode).toBeNull();
  });

  // A run resumed after a crash mid-sweep still has this line even though it never got a
  // closing 'done' line -- that is exactly what tells resumeOrphanedCopyRuns not to ask again.
  it('survives on an orphaned run that never reached its closing line', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    recordCopyJournalDecision(dir, 'run-1', 'keep');
    const [orphan] = findOrphanedRuns(dir);
    expect(orphan.decidedMode).toBe('keep');
    expect(orphan.done).toBeNull();
  });
});

describe('readCopyJournal', () => {
  it('answers null for a run that never started a journal', () => {
    expect(readCopyJournal(dir, 'nope')).toBeNull();
  });

  it('reports no closing line for a run that has not finished', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    expect(readCopyJournal(dir, 'run-1')?.done).toBeNull();
  });

  it('reports the outcome once the run closes', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    finishCopyJournal(dir, 'run-1', 'kept');
    expect(readCopyJournal(dir, 'run-1')?.done?.outcome).toBe('kept');
  });

  it('carries the remainder of a partial rollback, for whoever reads it later', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    finishCopyJournal(dir, 'run-1', 'rolled-back-partial', [
      { email: 'a@x.nl', reason: 'permission' },
    ]);
    expect(readCopyJournal(dir, 'run-1')?.done?.remainder).toEqual([
      { email: 'a@x.nl', reason: 'permission' },
    ]);
  });

  it('leaves the remainder out when a rollback needed none', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    finishCopyJournal(dir, 'run-1', 'rolled-back');
    expect(readCopyJournal(dir, 'run-1')?.done?.remainder).toBeUndefined();
  });

  it('skips a line that will not parse rather than losing the rest of the journal', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    appendFileSync(journalPath(dir, 'run-1'), 'this is not json\n', 'utf8');
    appendCopyJournalEntry(dir, { runId: 'run-1', email: 'a@x.nl', gmailId: 'g1', labelIds: [] });
    expect(readCopyJournal(dir, 'run-1')?.entries).toHaveLength(1);
  });
});

describe('parseCopyJournal', () => {
  it('answers null for text with no header line', () => {
    expect(parseCopyJournal('{"type":"insert","runId":"r","email":"a","gmailId":"g","labelIds":[]}\n')).toBeNull();
  });

  it('ignores a second header rather than letting it replace the first', () => {
    const raw =
      '{"type":"header","runId":"run-1","startedAt":1,"targets":["a@x.nl"]}\n' +
      '{"type":"header","runId":"run-1","startedAt":2,"targets":["b@x.nl"]}\n';
    expect(parseCopyJournal(raw)?.startedAt).toBe(1);
  });
});

describe('findOrphanedRuns', () => {
  it('finds nothing in an empty folder', () => {
    expect(findOrphanedRuns(dir)).toEqual([]);
  });

  it('finds nothing in a folder that does not exist yet', () => {
    expect(findOrphanedRuns(join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('reports a run with no closing line', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    expect(findOrphanedRuns(dir).map((o) => o.runId)).toEqual(['run-1']);
  });

  it('leaves out a run that closed, whatever outcome it closed with', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    finishCopyJournal(dir, 'run-1', 'completed');
    startCopyJournal(dir, 'run-2', ['a@x.nl'], 0);
    finishCopyJournal(dir, 'run-2', 'rolled-back-partial');
    expect(findOrphanedRuns(dir)).toEqual([]);
  });

  it('finds more than one orphan and ignores files that are not a journal', () => {
    startCopyJournal(dir, 'run-1', ['a@x.nl'], 0);
    startCopyJournal(dir, 'run-2', ['b@x.nl'], 0);
    writeFileSync(join(dir, 'log.jsonl'), '{}\n', 'utf8');
    expect(findOrphanedRuns(dir).map((o) => o.runId).sort()).toEqual(['run-1', 'run-2']);
  });
});

// A write this app must not lose in silence: what an unclosed journal or a lost log line
// used to look like -- an empty catch, nothing to show for it -- and what they answer with
// instead.
describe('attemptWrite', () => {
  it('answers null once the write has happened', () => {
    let ran = false;
    expect(attemptWrite(() => { ran = true; })).toBeNull();
    expect(ran).toBe(true);
  });

  it('hands back what the write threw, rather than losing it', () => {
    expect(
      attemptWrite(() => {
        throw new Error('share is weg');
      }),
    ).toBe('share is weg');
  });
});

describe('recordCopyJournalEntry', () => {
  const entry = { runId: 'run-1', email: 'a@x.nl', gmailId: 'g1', labelIds: [] };

  it('writes the entry and answers null when the append succeeds', () => {
    expect(recordCopyJournalEntry(dir, entry)).toBeNull();
    expect(readCopyJournal(dir, 'run-1')).toBeNull(); // no header was ever opened -- append alone does not create one
  });

  // The deliberate decision for a journal line that cannot be written mid-copy: the insert
  // itself already landed and is still reported as copied, so this must not throw and must
  // not stop the copy -- only hand back a message for the caller to log.
  it('does not throw when the append fails, and hands back the failure instead', () => {
    const failingAppend = (): void => {
      throw new Error('netwerkschijf niet bereikbaar');
    };
    expect(() => recordCopyJournalEntry(dir, entry, failingAppend)).not.toThrow();
    expect(recordCopyJournalEntry(dir, entry, failingAppend)).toBe('netwerkschijf niet bereikbaar');
  });

  it('leaves nothing behind on disk when the append fails', () => {
    const failingAppend = (): void => {
      throw new Error('boom');
    };
    recordCopyJournalEntry(dir, entry, failingAppend);
    expect(readCopyJournal(dir, 'run-1')).toBeNull();
  });
});

describe('withWarnings', () => {
  it('answers the base value unchanged when there is nothing to warn about', () => {
    const base = { ok: true, copied: 3 };
    expect(withWarnings(base, [])).toBe(base);
  });

  // This is the fix for the defect: a completed run whose closing write failed must still
  // report success -- not `ok: false`, not silently plain success either -- with the
  // failure carried alongside it instead of lost to a console nobody was watching.
  it('folds a failure into the result rather than turning success into failure', () => {
    const base = { ok: true, copied: 3 };
    const result = withWarnings(base, ['afronding niet vastgelegd: boom']);
    expect(result).toEqual({ ok: true, copied: 3, warnings: ['afronding niet vastgelegd: boom'] });
  });

  it('folds every warning collected, not just the first', () => {
    const result = withWarnings({ ok: true }, ['een', 'twee']);
    expect(result).toEqual({ ok: true, warnings: ['een', 'twee'] });
  });
});

describe('created labels in the journal', () => {
  it('reads a label line back off disk', () => {
    const raw = [
      JSON.stringify({ type: 'header', runId: 'r1', startedAt: 1, targets: ['a@b.nl'], markers: [] }),
      JSON.stringify({ type: 'label', runId: 'r1', email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' }),
    ].join('\n');
    expect(parseCopyJournal(raw)?.created).toEqual([
      { email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' },
    ]);
  });

  it('reads a run that created nothing back as an empty list', () => {
    const raw = JSON.stringify({ type: 'header', runId: 'r1', startedAt: 1, targets: [], markers: [] });
    expect(parseCopyJournal(raw)?.created).toEqual([]);
  });

  it('hands a failed write back instead of throwing it away', () => {
    const boom = () => {
      throw new Error('share weg');
    };
    expect(
      recordCopyJournalLabel('/root', 'r1', { email: 'a@b.nl', labelId: 'L', name: 'X' }, boom),
    ).toBe('share weg');
  });
});
