// Who may act while a label job is walking: a second drag, a stop that arrives late, and the
// plan a finished batch may be written into.

import { describe, it, expect } from 'vitest';
import {
  JOB_PULL_BUSY_TEXT,
  STOP_TOO_LATE_TEXT,
  pullRefusal,
  sameJobPlan,
  stopReachesRun,
  jobStopFromAction,
} from '../electron/mail/job-guard';

// A second drag landing while a job copies used to replace the walking job: the batch in flight
// then had its result written into the new job's plan, and the panel left its walking phase while
// the copy was still uploading -- which took Annuleren away from mail that was still going out.
describe('pullRefusal', () => {
  it('refuses a drag while a job is walking, with something to show the user', () => {
    expect(pullRefusal(true)).toBe(JOB_PULL_BUSY_TEXT);
    expect(JOB_PULL_BUSY_TEXT.length).toBeGreaterThan(0);
  });
  it('allows a drag when no job is walking', () => {
    expect(pullRefusal(false)).toBeNull();
  });
});

// The tail of a copy runs minutes after its head and used to read the walking job afresh, so a
// plan swapped underneath it took that batch's insert count into its own file -- marking two
// thousand conversations copied that nobody had copied.
describe('sameJobPlan', () => {
  it('accepts the plan the copy was started for', () => {
    expect(sameJobPlan({ jobId: 'job-a' }, { jobId: 'job-a' })).toBe(true);
  });
  it('refuses a plan that replaced it midway', () => {
    expect(sameJobPlan({ jobId: 'job-a' }, { jobId: 'job-b' })).toBe(false);
  });
  it('refuses when the job is gone by the time the copy answers', () => {
    expect(sameJobPlan({ jobId: 'job-a' }, null)).toBe(false);
  });
  it('refuses when the copy was never started for a job at all', () => {
    expect(sameJobPlan(null, { jobId: 'job-b' })).toBe(false);
    expect(sameJobPlan(null, null)).toBe(false);
  });
});

// A run reads its stop mode once, after every upload has drained, and then sweeps its marker
// labels -- seconds of network per batch. A stop arriving in that window called a gate that no
// longer decides anything and was answered as if it had been taken.
describe('stopReachesRun', () => {
  it('reaches a run that has not settled its outcome yet', () => {
    expect(stopReachesRun({ decided: false, stopping: false })).toBe(true);
  });
  it('reaches a run that is already stopping, whose own stop answers for it', () => {
    expect(stopReachesRun({ decided: true, stopping: true })).toBe(true);
  });
  it('does not reach a run that has settled on finishing', () => {
    expect(stopReachesRun({ decided: true, stopping: false })).toBe(false);
  });
  it('has something to tell the user when it cannot be reached', () => {
    expect(STOP_TOO_LATE_TEXT.length).toBeGreaterThan(0);
  });
});

// Only the job-wide choice reaches the batches that already finished. A batch the run can no
// longer sweep is left where it is, exactly as a stop between two batches leaves it.
describe('jobStopFromAction', () => {
  it('carries the job-wide rollback through', () => {
    expect(jobStopFromAction('stop-rollback-job')).toBe('rollback');
  });
  it('leaves what landed alone for every other stop', () => {
    expect(jobStopFromAction('stop-keep')).toBe('keep');
    expect(jobStopFromAction('stop-rollback-batch')).toBe('keep');
  });
});
