// The picker's job panel: one continuous panel for a whole job instead of a result panel per
// batch. The rules that carry risk live in renderer/app/job-panel.ts rather than in the page,
// so they can be asserted without React -- the same split mailbox-rail.ts and drop-outcome.ts
// already use.

import { describe, it, expect } from 'vitest';
import {
  JOB_END_OUTCOMES,
  previewMayPick,
  panelBelongsToJob,
  phaseAfterJobEnd,
  panelTitle,
  panelBody,
  jobEndText,
  type JobEnd,
} from '../renderer/app/job-panel';

const line = (over: Partial<{ batch: number; batches: number; done: number; total: number }> = {}) => ({
  batch: 3,
  batches: 4,
  done: 62,
  total: 100,
  ...over,
});

const end = (over: Partial<JobEnd> = {}): JobEnd => ({
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
      expect(['done', 'stopped']).toContain(phaseAfterJobEnd(end({ outcome })).kind);
    }
  });

  it('reports a finished job as done', () => {
    expect(phaseAfterJobEnd(end())).toEqual({ kind: 'done' });
  });

  it('reports a job stopped with its mail left alone as stopped and kept', () => {
    expect(phaseAfterJobEnd(end({ outcome: 'kept', done: 50 }))).toEqual({
      kind: 'stopped',
      mode: 'keep',
      complete: true,
    });
  });

  it('reports an undone job as stopped and rolled back', () => {
    expect(phaseAfterJobEnd(end({ outcome: 'rolled-back', done: 50 }))).toEqual({
      kind: 'stopped',
      mode: 'rollback',
      complete: true,
    });
  });

  // The one that must not read as finished: some mail is still in a mailbox the sweep could not
  // account for.
  it('marks a partly undone job as not complete', () => {
    expect(phaseAfterJobEnd(end({ outcome: 'rolled-back-partial', done: 50 }))).toEqual({
      kind: 'stopped',
      mode: 'rollback',
      complete: false,
    });
  });

  // A job left open on a failed batch is not a stop the user asked for, so it ends as a report
  // carrying the batch's own error rather than as a rollback.
  it('carries the error of a job stuck on a failed batch', () => {
    expect(phaseAfterJobEnd(end({ outcome: 'stuck', done: 50, error: 'Geen rechten' }))).toEqual({
      kind: 'done',
      error: 'Geen rechten',
    });
  });
});

describe('panelTitle', () => {
  // The complaint this fixes: a four-batch job drew "Kopieer 25 conversaties" three times, each
  // panel describing a batch instead of the job.
  it('names the job while one is walking, not the batch on screen', () => {
    expect(panelTitle({ items: 25, job: line() })).toBe('Kopieer 100 conversaties');
  });

  it('names what was dragged when no job is walking', () => {
    expect(panelTitle({ items: 25, job: null })).toBe('Kopieer 25 conversaties');
    expect(panelTitle({ items: 1, job: null })).toBe('Kopieer 1 conversatie');
  });

  it('says a failed drag failed, whatever is walking', () => {
    expect(panelTitle({ items: 25, job: line(), failed: true })).toBe('Slepen mislukt');
  });

  it('counts a one-conversation job in the singular too', () => {
    expect(panelTitle({ items: 1, job: line({ total: 1, done: 0 }) })).toBe('Kopieer 1 conversatie');
  });
});

describe('panelBody', () => {
  it('says where the job is filing and how far it has got', () => {
    expect(panelBody({ job: line(), targets: ['support@example.com'] })).toEqual({
      into: 'Wordt gekopieerd naar support@example.com',
      progress: 'Batch 3 van 4 — 62 van 100 gekopieerd',
    });
  });

  it('names every mailbox a job files into', () => {
    expect(
      panelBody({ job: line(), targets: ['support@example.com', 'info@example.com'] }).into,
    ).toBe('Wordt gekopieerd naar support@example.com en info@example.com');
  });

  // Between the driver taking over and the first progress of the next batch there is a moment
  // with no numbers yet. The panel still has to say something.
  it('leaves the progress line out until there are numbers', () => {
    expect(panelBody({ job: null, targets: ['support@example.com'] })).toEqual({
      into: 'Wordt gekopieerd naar support@example.com',
      progress: '',
    });
  });

  it('says nothing about mailboxes it was not told about', () => {
    expect(panelBody({ job: line(), targets: [] }).into).toBe('');
  });
});

describe('jobEndText', () => {
  it('closes a finished job with what it copied', () => {
    expect(jobEndText(end())).toBe('Klus afgerond — 100 van 100 conversaties gekopieerd');
  });

  it('closes a stopped job with how far it got', () => {
    expect(jobEndText(end({ outcome: 'kept', done: 50, copiedBatches: 2 }))).toBe(
      'Klus gestopt — 50 van 100 conversaties blijven gekopieerd',
    );
  });

  it('closes an undone job by saying it was undone', () => {
    expect(jobEndText(end({ outcome: 'rolled-back', done: 50, copiedBatches: 2 }))).toBe(
      'Klus gestopt en ongedaan gemaakt',
    );
  });

  it('does not call a partly undone job undone', () => {
    expect(jobEndText(end({ outcome: 'rolled-back-partial', done: 50, copiedBatches: 2 }))).toBe(
      'Klus gestopt, ongedaan maken niet overal gelukt',
    );
  });

  it('closes a stuck job on its batch, since that is what has to be answered for', () => {
    expect(
      jobEndText(end({ outcome: 'stuck', done: 50, copiedBatches: 2, error: 'Geen rechten' })),
    ).toBe('Klus gestopt op batch 3 van 4 — Geen rechten');
  });
});
