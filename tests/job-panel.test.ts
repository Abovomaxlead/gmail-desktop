// The picker's job panel: one continuous panel for a whole job instead of a result panel per
// batch. The rules that carry risk live in renderer/app/job-panel.ts rather than in the page,
// so they can be asserted without React -- the same split mailbox-rail.ts and drop-outcome.ts
// already use.

import { describe, it, expect } from 'vitest';
import {
  JOB_END_OUTCOMES,
  previewMayPick,
  panelBelongsToJob,
  panelMayWalk,
  phaseAfterJobEnd,
  panelTitle,
  panelBody,
  jobEndText,
  controlFailureText,
  type EndPhase,
} from '../renderer/app/job-panel';
import { type JobEnd, type JobEndOutcome } from '../renderer/lib/maildrop-copy';
import { STRINGS_NL } from '../renderer/app/strings';

const line = (over: Partial<{ batch: number; batches: number; done: number; total: number }> = {}) => ({
  batch: 3,
  batches: 4,
  done: 62,
  total: 100,
  ...over,
});

const end = (over: Partial<JobEnd> = {}): JobEnd => ({
  jobId: 'job-1',
  outcome: 'completed',
  label: 'Klanten',
  done: 100,
  total: 100,
  batches: 4,
  copiedBatches: 4,
  targets: ['support@example.com'],
  ...over,
});

describe('previewMayPick', () => {
  // The 717-mail rule, as a test. On 2026-08-26 a driven batch returned the picker to its
  // picking phase, which cleared the chosen mailboxes and put Kopieer live for mail the driver
  // already had in flight; it was pressed and 717 of 719 mails landed twice.
  it('refuses a driven batch the picking phase', () => {
    expect(previewMayPick({ driven: true })).toBe(false);
  });

  it('lets a real drag pick, which is what every drag before jobs did', () => {
    expect(previewMayPick({})).toBe(true);
    expect(previewMayPick({ driven: false })).toBe(true);
  });
});

describe('panelBelongsToJob', () => {
  // Batch one's copy is the window's own, so its answer comes back here -- and by then the driver
  // may have taken the panel over. That answer describes 25 of 100 conversations and must not be
  // allowed to replace the job, which is the per-batch panel all over again.
  it('holds the panel while a job is walking', () => {
    expect(panelBelongsToJob({ kind: 'walking' })).toBe(true);
  });

  it('holds the panel on a report that is a job own end', () => {
    expect(panelBelongsToJob({ kind: 'done', result: { job: end() } })).toBe(true);
    expect(panelBelongsToJob({ kind: 'stopped', result: { job: end({ outcome: 'kept' }) } })).toBe(
      true,
    );
  });

  it('lets a plain drag report itself, which is every drag before jobs', () => {
    expect(panelBelongsToJob({ kind: 'picking' })).toBe(false);
    expect(panelBelongsToJob({ kind: 'copying' })).toBe(false);
    expect(panelBelongsToJob({ kind: 'done', result: {} })).toBe(false);
    expect(panelBelongsToJob({ kind: 'stopped', result: {} })).toBe(false);
  });
});

describe('phaseAfterJobEnd', () => {
  // The property the whole phase is judged on: a job that is over always leaves the panel in a
  // phase whose close button works. A phase with no exit is the bug this replaces.
  it('always leaves a phase that can be closed', () => {
    for (const outcome of JOB_END_OUTCOMES) {
      expect(['done', 'stopped']).toContain(phaseAfterJobEnd(end({ outcome }), STRINGS_NL).kind);
    }
  });

  // The list the loop above walks used to be a hand-written array, which a union is never
  // obliged to fill: an outcome added to the type and forgotten here left this suite green
  // while that outcome returned undefined. JOB_END_OUTCOMES is now the keys of a record the
  // compiler checks, so this asserts the list is the union rather than someone's memory of it.
  it('walks every outcome the type allows, not a list someone wrote out', () => {
    const covered: Record<JobEndOutcome, true> = {
      completed: true,
      kept: true,
      'rolled-back': true,
      'rolled-back-partial': true,
      stuck: true,
    };
    expect([...JOB_END_OUTCOMES].sort()).toEqual(Object.keys(covered).sort());
  });

  // The loop above is satisfied by the fallback too -- it answers 'done' like any other -- so on
  // its own it lets a forgotten case through while the panel tells the user the outcome is
  // unknown. This pins the phase each outcome must reach, and the table is a record the compiler
  // fills: a sixth outcome does not compile here until it is named, and then the assertion below
  // fails until it has a case of its own.
  it('gives every outcome a phase of its own, never the unknown-outcome fallback', () => {
    const expected: Record<JobEndOutcome, EndPhase> = {
      completed: { kind: 'done' },
      kept: { kind: 'stopped', mode: 'keep', complete: true },
      'rolled-back': { kind: 'stopped', mode: 'rollback', complete: true },
      'rolled-back-partial': { kind: 'stopped', mode: 'rollback', complete: false },
      stuck: { kind: 'done', error: 'Geen rechten' },
    };
    for (const outcome of JOB_END_OUTCOMES) {
      const at = phaseAfterJobEnd(end({ outcome, error: 'Geen rechten' }), STRINGS_NL);
      expect(at).toEqual(expected[outcome]);
      expect(at.error ?? '').not.toContain('onbekende uitkomst');
    }
  });

  // A switch with no default returns undefined, and the page reads .kind off it straight away.
  // Nothing sends this today; the moment a sixth outcome exists on one side of the IPC and not
  // the other, this is the difference between a closable panel and the stranded one 68f1981
  // was written to replace.
  it('still leaves a closable phase for an outcome it has never heard of', () => {
    const at = phaseAfterJobEnd(end({ outcome: 'abandoned' as JobEndOutcome }), STRINGS_NL);
    expect(at).toBeDefined();
    expect(['done', 'stopped']).toContain(at.kind);
    expect(at.error).toBeTruthy();
  });
});

// A panel message puts the panel into its walking phase, and one arriving after the job has
// already reported its end would take a finished report back into a phase whose only exit is an
// end that has already been sent.
describe('panelMayWalk', () => {
  it('lets a job take a panel that is picking', () => {
    expect(panelMayWalk({ kind: 'picking' })).toBe(true);
  });
  it('lets a job take the panel over from the window own copy', () => {
    expect(panelMayWalk({ kind: 'copying' })).toBe(true);
  });
  it('keeps refreshing a panel that is already walking', () => {
    expect(panelMayWalk({ kind: 'walking' })).toBe(true);
  });
  it('refuses to walk again once the job has reported its end', () => {
    expect(panelMayWalk({ kind: 'done', result: { job: end() } })).toBe(false);
    expect(panelMayWalk({ kind: 'stopped', result: { job: end({ outcome: 'kept' }) } })).toBe(false);
  });
  it('lets a job take a panel showing a plain drag report, which is no job', () => {
    expect(panelMayWalk({ kind: 'done' })).toBe(true);
  });
});

// Every control call used to be fired and forgotten, so a refused stop looked exactly like an
// honoured one -- which is what made a stranded panel silent instead of visible.
describe('controlFailureText', () => {
  it('says nothing when the gate took the action', () => {
    expect(controlFailureText('stop-keep', { ok: true }, STRINGS_NL)).toBeNull();
  });

  // The pause fired alongside the stop dialog is refused whenever there is no copy in flight,
  // which is every gap between two batches -- a normal moment, not a failure to report.
  it('says nothing about a pause or resume that had nothing to take it', () => {
    expect(controlFailureText('pause', { ok: false, error: 'Er wordt niet gekopieerd' }, STRINGS_NL)).toBeNull();
    expect(controlFailureText('resume', { ok: false, error: 'Er wordt niet gekopieerd' }, STRINGS_NL)).toBeNull();
  });

  it('reports a refused stop, with the reason the gate gave', () => {
    const text = controlFailureText('stop-keep', { ok: false, error: 'Er wordt niet gekopieerd' }, STRINGS_NL);
    expect(text).toContain('Er wordt niet gekopieerd');
  });

  it('reports a stop that never reached main at all', () => {
    expect(controlFailureText('stop-rollback-job', undefined, STRINGS_NL)).toBeTruthy();
  });

  it('names no reason it was not given', () => {
    expect(controlFailureText('stop-rollback-batch', { ok: false }, STRINGS_NL)).toBeTruthy();
  });

});

describe('panelTitle', () => {
  // The complaint this fixes: a four-batch job drew "Kopieer 25 conversaties" three times, each
  // panel describing a batch instead of the job.
  it('names the job while one is walking, not the batch on screen', () => {
    expect(panelTitle({ items: 25, job: line() }, STRINGS_NL)).toBe('Kopieer 100 conversaties');
  });

  it('names what was dragged when no job is walking', () => {
    expect(panelTitle({ items: 25, job: null }, STRINGS_NL)).toBe('Kopieer 25 conversaties');
    expect(panelTitle({ items: 1, job: null }, STRINGS_NL)).toBe('Kopieer 1 conversatie');
  });

  it('says a failed drag failed, whatever is walking', () => {
    expect(panelTitle({ items: 25, job: line(), failed: true }, STRINGS_NL)).toBe('Slepen mislukt');
  });

  it('counts a one-conversation job in the singular too', () => {
    expect(panelTitle({ items: 1, job: line({ total: 1, done: 0 }) }, STRINGS_NL)).toBe('Kopieer 1 conversatie');
  });
});

describe('panelBody', () => {
  it('says where the job is filing and how far it has got', () => {
    expect(panelBody({ job: line(), targets: ['support@example.com'] }, STRINGS_NL)).toEqual({
      into: 'Wordt gekopieerd naar support@example.com',
      progress: 'Batch 3 van 4 — 62 van 100 gekopieerd',
    });
  });

  it('names every mailbox a job files into', () => {
    expect(
      panelBody({ job: line(), targets: ['support@example.com', 'info@example.com'] }, STRINGS_NL).into,
    ).toBe('Wordt gekopieerd naar support@example.com en info@example.com');
  });

  // Between the driver taking over and the first progress of the next batch there is a moment
  // with no numbers yet. The panel still has to say something.
  it('leaves the progress line out until there are numbers', () => {
    expect(panelBody({ job: null, targets: ['support@example.com'] }, STRINGS_NL)).toEqual({
      into: 'Wordt gekopieerd naar support@example.com',
      progress: '',
    });
  });

  it('says nothing about mailboxes it was not told about', () => {
    expect(panelBody({ job: line(), targets: [] }, STRINGS_NL).into).toBe('');
  });
});

describe('jobEndText', () => {
  it('closes a finished job with what it copied', () => {
    expect(jobEndText(end(), STRINGS_NL)).toBe('Klus afgerond — 100 van 100 conversaties gekopieerd');
  });

  it('closes a stopped job with how far it got', () => {
    expect(jobEndText(end({ outcome: 'kept', done: 50, copiedBatches: 2 }), STRINGS_NL)).toBe(
      'Klus gestopt — 50 van 100 conversaties blijven gekopieerd',
    );
  });

  it('closes an undone job by saying it was undone', () => {
    expect(jobEndText(end({ outcome: 'rolled-back', done: 50, copiedBatches: 2 }), STRINGS_NL)).toBe(
      'Klus gestopt en ongedaan gemaakt',
    );
  });

  it('does not call a partly undone job undone', () => {
    expect(jobEndText(end({ outcome: 'rolled-back-partial', done: 50, copiedBatches: 2 }), STRINGS_NL)).toBe(
      'Klus gestopt, ongedaan maken niet overal gelukt',
    );
  });

  it('closes a stuck job on its batch, since that is what has to be answered for', () => {
    expect(
      jobEndText(end({ outcome: 'stuck', done: 50, copiedBatches: 2, error: 'Geen rechten' }), STRINGS_NL),
    ).toBe('Klus gestopt op batch 3 van 4 — Geen rechten');
  });

  // Every outcome at once, off the record the compiler checks rather than off five separate
  // cases: a sixth outcome added to the union fails to compile here until this table names it,
  // so the suite cannot go green on a line nobody wrote.
  it('closes on a line of its own for every outcome the union names', () => {
    const expected: Record<JobEndOutcome, string> = {
      completed: 'Klus afgerond — 50 van 100 conversaties gekopieerd',
      kept: 'Klus gestopt — 50 van 100 conversaties blijven gekopieerd',
      'rolled-back': 'Klus gestopt en ongedaan gemaakt',
      'rolled-back-partial': 'Klus gestopt, ongedaan maken niet overal gelukt',
      stuck: 'Klus gestopt op batch 3 van 4 — Geen rechten',
    };
    for (const outcome of JOB_END_OUTCOMES) {
      const text = jobEndText(
        end({ outcome, done: 50, copiedBatches: 2, batches: 4, error: 'Geen rechten' }),
        STRINGS_NL,
      );
      expect(text).toBe(expected[outcome]);
      expect(text).not.toContain('onbekende uitkomst');
    }
  });

  // The switch had no default and no trailing return, so anything outside the union came back
  // undefined and the closing line rendered blank in all three places the page draws it. Main
  // and the renderer are separate builds, so an outcome this compiler never saw is exactly the
  // case that reaches here.
  it('still says something for an outcome it has never heard of', () => {
    const text = jobEndText(end({ outcome: 'abandoned' as JobEndOutcome }), STRINGS_NL);
    expect(typeof text).toBe('string');
    expect(text).toBeTruthy();
    expect(text).toContain('abandoned');
  });

  it('still says something when the outcome is missing altogether', () => {
    const text = jobEndText({ ...end(), outcome: undefined as unknown as JobEndOutcome }, STRINGS_NL);
    expect(typeof text).toBe('string');
    expect(text).toBeTruthy();
  });
});
