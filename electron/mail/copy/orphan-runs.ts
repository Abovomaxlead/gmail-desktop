// Copy runs and label jobs this app never heard the end of, found at start-up and either
// finished silently or offered to the user as a keep-or-rollback / continue-or-undo decision.
//
// A run whose journal already recorded a decision before it died is finished here without
// asking: sweepMarker is idempotent, so resuming one that had already half-finished only
// repeats whatever is still needed, never doubles it. A run whose journal never recorded a
// decision at all, and a job stopped on a failed batch, are the two cases this app must still
// ask the user about.
//
// A found job is handed to job/job-driver.ts's own pendingJob through a hook: that state
// belongs to the job driver, which this file must never import without opening a cycle.

import { notifyLog } from '../../notify/notify-log';
import type { PendingOrphan } from '../../../renderer/lib/maildrop-copy';
import {
  attemptWrite,
  finishCopyJournal,
  findOrphanedRuns,
  recordCopyJournalDecision,
  type CopyJournalOutcome,
  type CopyJournalRead,
  type CopyJournalRemainder,
} from './copy-journal';
import type { CopyRunId, CopyStopMode } from './copy-run-types';
import { findUnfinishedJobs, finishLabelJob, nextBatch, type LabelJob } from '../job/label-job';
import { insertsPerMailbox, settled, sweepRemainder, sweepRunMarkers } from './copy-run';
import { mailDropFolder } from '../pull/pull-controller';


//===========================
// Types
//===========================

/** What job/job-driver.ts answers to, for the one job a resumed start-up
 * may find still open on a batch. Wired once, for the same reason copy-run.ts's own
 * CopyJobHooks is. */
export interface OrphanJobHooks {
  /** Hands the driver the one unfinished job still awaiting a continue-or-undo decision, or
   * null when start-up found none that need one */
  setPendingJob(job: LabelJob | null): void;
}


//===========================
// Module state
//===========================

/** A run that crashed before ever deciding what to do with its markers, waiting for the
 * mail-drop window to ask the same keep-or-rollback question a live run's stop dialog already
 * asks. A run whose journal already recorded a decision needs none of this -- it is finished
 * silently by resumeOrphanedCopyRuns instead. */
let pendingOrphans: CopyJournalRead[] = [];

let jobHooks: OrphanJobHooks = { setPendingJob: () => {} };


//===========================
// Exported functions
//===========================

export function setOrphanJobHooks(h: OrphanJobHooks): void {
  jobHooks = h;
}

/**
 * Resumes every copy run this app never heard the end of
 *
 * Meant to be called once, at app start. sweepMarker is idempotent -- listing an
 * already-empty label costs one call and changes nothing -- so resuming a run that had
 * already half-finished only repeats whatever is still needed, never doubles it. A run whose
 * journal never recorded a decision at all is left pending rather than guessed at: that is
 * the one case this app must still ask the user about.
 */
export async function resumeOrphanedCopyRuns(): Promise<void> {
  const root = mailDropFolder();
  const orphans = findOrphanedRuns(root);
  const stillPending: CopyJournalRead[] = [];
  for (const journal of orphans) {
    if (journal.decidedMode) await finishOrphanRun(root, journal, journal.decidedMode);
    else stillPending.push(journal);
  }
  pendingOrphans = stillPending;

  // After the runs, and deliberately: a job's batches are runs, so a batch that already recorded
  // its own decision is settled above before the job it belongs to is offered. A job whose batch
  // zero never got an answer has nothing to resume with and is closed rather than offered -- its
  // batches were never copied, so there is nothing to keep or undo either.
  const jobs = findUnfinishedJobs(root);
  let pendingJob: LabelJob | null = null;
  for (const job of jobs) {
    // Two different reasons nextBatch answers null, and they must not be treated alike. Every
    // batch copied means there is nothing left to ask about. A batch recorded as failed also
    // stops it -- and that one is precisely the state the user still owes an answer for, so it
    // is offered rather than closed.
    const stuck = job.batches.some((b) => b.state === 'failed');
    if (!job.choices || (!nextBatch(job) && !stuck)) {
      const failed = attemptWrite(() => finishLabelJob(root, job.jobId, 'kept'));
      if (failed) notifyLog(`[maildrop] could not close an unfinished job: ${failed}`);
      continue;
    }
    if (!pendingJob) pendingJob = job;
  }
  jobHooks.setPendingJob(pendingJob);
}

/**
 * The next orphaned run the user has to make a keep-or-rollback decision about, if any
 *
 * Asked by the mail-drop window when it opens, the same moment it already asks for an
 * existing-mail scan -- nothing else in this app surfaces on its own.
 *
 * @returns the run and how far it got per mailbox, or null when nothing is waiting
 */
export function pendingOrphanDecision(): PendingOrphan | null {
  const journal = pendingOrphans[0];
  if (!journal) return null;
  const byMailbox = insertsPerMailbox(journal.entries);
  return {
    runId: journal.runId,
    byMailbox: journal.markers.map((m) => ({ email: m.email, inserted: byMailbox.get(m.email) ?? 0 })),
  };
}

/**
 * Answers a pending orphan decision, sweeping that run's markers with the chosen mode
 *
 * @param runId must be the one pendingOrphanDecision last returned
 * @param mode
 * @returns whether the decision was taken -- false when this run is no longer pending, which a
 *   second click or a stale window can both cause harmlessly
 */
export async function decideOrphanRun(
  runId: CopyRunId,
  mode: CopyStopMode,
): Promise<{ ok: boolean }> {
  const at = pendingOrphans.findIndex((j) => j.runId === runId);
  if (at === -1) return { ok: false };
  const journal = pendingOrphans[at];
  const root = mailDropFolder();
  const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, mode));
  if (decisionError) notifyLog(`[maildrop] could not record the sweep decision: ${decisionError}`);
  try {
    await finishOrphanRun(root, journal, mode);
  } catch (e) {
    // Left on the pending list on purpose: the decision itself is on disk, so the next start
    // resumes it, and taking it off here would lose the offer while the run is still unclosed.
    notifyLog(`[maildrop] sweep of run ${runId} failed: ${(e as Error).message}`);
    return { ok: false };
  }
  pendingOrphans.splice(at, 1);
  return { ok: true };
}


//===========================
// Helper functions
//===========================

/**
 * Finishes one orphaned run's sweep, closing its journal once every mailbox has settled
 *
 * @param root the drop folder
 * @param journal
 * @param mode already decided, either by the run itself before it died or by the user just now
 * @private
 */
async function finishOrphanRun(
  root: string,
  journal: CopyJournalRead,
  mode: CopyStopMode,
): Promise<void> {
  const close = (outcome: CopyJournalOutcome, remainder?: CopyJournalRemainder[]): void => {
    const failed = attemptWrite(() => finishCopyJournal(root, journal.runId, outcome, remainder));
    if (failed) {
      notifyLog(`[maildrop] journal of run ${journal.runId} not closed: ${failed}`);
    }
  };

  // Closed rather than left open, even though there is nothing here to sweep by label: a run
  // that died before recording a marker cannot be swept at all, and an unclosed journal is
  // what makes the next start read it again -- every start, for good.
  if (journal.markers.length === 0) {
    notifyLog(`[maildrop] run ${journal.runId} had no internal label; nothing to sweep`);
    close(mode === 'keep' ? 'kept' : 'rolled-back-partial');
    return;
  }

  const outcome = await sweepRunMarkers(
    journal.runId,
    journal.markers,
    mode === 'keep' ? 'strip' : 'trash',
    journal.created,
  );
  if (!settled(outcome)) {
    notifyLog(
      `[maildrop] resumed sweep of run ${journal.runId} not complete yet, will be tried again at the next start`,
    );
    return;
  }
  close(
    mode === 'keep' ? 'kept' : outcome.complete ? 'rolled-back' : 'rolled-back-partial',
    mode === 'rollback' ? sweepRemainder(outcome) : undefined,
  );
}
