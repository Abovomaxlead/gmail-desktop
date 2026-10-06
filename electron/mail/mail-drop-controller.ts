// Dragging mail out of Gmail and onto the desktop, and copying what that saved into another
// mailbox.
//
// Two routes reach the same list and do not find the same messages. The API lists every
// message in a thread; the page route can only save what Gmail's "show original" page links
// to, and a long conversation arrives there collapsed. The API goes first for that reason,
// and the page is what is left when a mailbox has no token.
//
// A mailbox reached by delegation has no second route at all -- its page needs the
// /d/<token>/ a drag does not carry -- so there an API failure is the answer.
//
// One mail leaves per drag: the last message quotes the ones before it, which is the whole
// reason a thread gets dragged. Fetching them all is how the newest is known to be newest.

import { randomUUID } from 'node:crypto';
import { IPC } from '../core/ipc';
import type {
  MailDropCopyControlAction,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
} from '../core/ipc';
import { currentLocale, dropOverlay, keyOf, manager, prefs, profiles } from '../core/runtime';
import type { JobPanel, PendingJob, PendingOrphan } from '../../renderer/lib/maildrop-copy';
import { type CopyMode } from './copy/mail-copy';
import { type TreeThread } from './drag/label-drop';
import {
  JOB_BATCH_THREADS,
  finishLabelJob,
  findUnfinishedJobs,
  inheritedMode,
  jobFailed,
  jobProgress,
  nextBatch,
  readLabelJob,
  recordJobBatchState,
  recordJobChoices,
  type JobOutcome,
  type LabelJob,
  type RunningBatchProgress,
} from './job/label-job';
import { sameJobPlan, type JobEndInfo, type JobPlanRef } from './job/job-guard';
import { BUSY_TEXT, cancelledText } from './drag/dropzone';
import { createPullControl } from './pull/pull-control';
import {
  copyFailuresOf,
  failedConversations,
  retryRefusal,
  type FailureLine,
  type TargetFailures,
} from './copy/copy-failures';
import {
  addCopyFailures,
  addFetchedToAllTargets,
  emptyJobFailures,
  isEmpty,
  lostConversations,
  replaceBatchPull,
  retryFiles,
  takePullSlice,
  type JobFailures,
} from './job/job-failures';
import { dismissShownToast, showToast } from '../toast/toast-presenter';
import { nativeLabels } from '../menus/native-labels';
import { notifyLog } from '../notify/notify-log';
import { failedRowIndexes } from '../../renderer/lib/failure-list';
import {
  attemptWrite,
  finishCopyJournal,
  findOrphanedRuns,
  readCopyJournal,
  recordCopyJournalDecision,
  withWarnings,
  type CopyJournalOutcome,
  type CopyJournalRead,
  type CopyJournalRemainder,
} from './copy/copy-journal';
import type { CopyRunId, CopyStopMode } from './copy/copy-run-types';
import {
  activePull,
  batchPullFailedThreads,
  bumpDropSerial,
  dropSerial,
  pullDone,
  setActivePull,
  setLastDropSaved,
  setPullDone,
  type SavedRef,
} from './drop-state';
import {
  dropLock,
  mailDropFolder,
  openDropPreview,
  pullReporter,
  rememberPullFailures,
  setJobDriverHooks,
  withPullLock,
} from './pull/pull-controller';
import { fetchThreadSlice, saveLabel, writeCollected } from './pull/pull-collect';
import {
  activeRun,
  insertsPerMailbox,
  runCopyToMailboxes,
  settled,
  setCopyJobHooks,
  sweepRemainder,
  sweepRunMarkers,
} from './copy/copy-run';
import { lastRunFailures, retryInFlight, setCopyEntryPoint, setLastCopyFailures, setLastRunFailures, setRetryInFlight } from './copy/copy-retry';

//===========================
// Types
//===========================

/** What a job lost, in the controller's own types */
type JobLosses = JobFailures<MailDropCopyTarget, SavedRef, TreeThread>;

/** The progress payload, with `jobEnd` narrowed back to this controller's own shape: core/ipc.ts's
 * mirror (by way of renderer/lib/maildrop-copy.ts) types that field as the full JobEnd, jobId
 * included, but no job end this controller ever builds carries one -- see JobEndInfo's own
 * comment. `panel` needs no such override; the mirror already carries the same JobPanel. */
type PanelProgress = Omit<MailDropCopyProgress, 'jobEnd'> & { jobEnd?: JobEndInfo };


//===========================
// Module state
//===========================

/** The job the driver is advancing, or null when this drag was not big enough to need one. One
 * at a time, always: the drop lock admits one pull and a job never overlaps its own batches. */
let activeJob: { job: LabelJob; root: string } | null = null;

/** Set when the stop the user chose was job-wide. Read once the running batch's own rollback has
 * finished, which is the only moment the earlier batches may be swept: two sweeps trashing under
 * two markers in one mailbox at once is a race with nothing to gain. */
let rollbackWholeJob = false;

/** A stop the user asked for while the driver was between two batches, where there is no copy
 * in flight for the gate to take it. Read at the top of the walk and again once a batch has been
 * pulled -- the two moments the driver answers to nobody else -- and cleared the moment it is
 * honoured. Null at every other time. */
let jobStopWanted: 'keep' | 'rollback' | null = null;

/** Set while the driver is walking a job. The tail of copyToMailboxes starts the driver, and the
 * driver's own loop calls copyToMailboxes -- so this is what keeps that from forking a second
 * walk on every batch. Read nowhere else: it is a re-entrancy guard, not state anyone reports. */
let jobDriving = false;

/** What the job being walked has lost so far, across its batches. Belongs to `jobFailuresFor` */
let jobFailures: JobLosses = emptyJobFailures();

/** The jobId `jobFailures` was gathered for, or null when nothing is being gathered */
let jobFailuresFor: string | null = null;

/** Set when the gathering began after a restart: the batches before it lost their failures with
 * the old process, so what it holds is not all the job lost and is never offered */
let jobFailuresPartial = false;

/** The card that announced the held job offer, taken down whenever that offer goes */
let jobOfferToast: string | null = null;

/** A completed job's losses, held for the one retry its closing line offers */
let lastJobFailures:
  | {
      retryId: string;
      serial: number;
      jobId: string;
      account: string;
      label: string;
      targets: MailDropCopyTarget[];
      acc: JobLosses;
    }
  | null = null;

/** The job end the panel was sent, kept while `lastJobFailures` is held so a reopened panel lands on it */
let lastJobEnd: JobEndInfo | null = null;

/** A run that crashed before ever deciding what to do with its markers, waiting for the
 * mail-drop window to ask the same keep-or-rollback question a live run's stop dialog already
 * asks. A run whose journal already recorded a decision needs none of this -- it is finished
 * silently by resumeOrphanedCopyRuns instead. */
let pendingOrphans: CopyJournalRead[] = [];

/** A job this app never heard the end of, waiting for the same continue-or-undo answer the
 * orphan-run decision already asks for a single run. At most one is offered at a time: two
 * half-finished jobs is not a state this app can get into, since a job holds the drop lock for
 * every batch. */
let pendingJob: LabelJob | null = null;


//===========================
// Exported functions
//===========================

/**
 * Rolls back every batch of the running job that had already finished
 *
 * Newest first, so a mailbox the sweep cannot reach costs the most recent work rather than the
 * oldest. Each batch is swept from its own journal and its own recorded marker id -- nothing is
 * inferred, and a batch whose journal is gone is reported rather than guessed at.
 *
 * @param job
 * @param root the drop folder
 * @returns the batches it could not account for, for the message the picker shows
 * @private
 */
async function rollbackFinishedBatches(job: LabelJob, root: string): Promise<string[]> {
  const trouble: string[] = [];
  const finished = job.batches.filter((b) => b.state === 'copied' && b.runId).reverse();
  for (const batch of finished) {
    const journal = readCopyJournal(root, batch.runId!);
    if (!journal) {
      trouble.push(`batch ${batch.index + 1}: geen journaal meer`);
      continue;
    }
    const outcome = await sweepRunMarkers(journal.runId, journal.markers, 'trash', journal.created);
    if (!settled(outcome) || !outcome.complete) trouble.push(`batch ${batch.index + 1}`);
    const closeError = attemptWrite(() =>
      finishCopyJournal(
        root,
        journal.runId,
        outcome.complete ? 'rolled-back' : 'rolled-back-partial',
      ),
    );
    // Collected rather than thrown: the batches left in this loop are the older ones, and a
    // share that drops this line must not cost them their sweep.
    if (closeError) trouble.push(`batch ${batch.index + 1}: journaal niet afgesloten`);
  }
  return trouble;
}

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
  pendingJob = null;
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

/**
 * Tells the panel a job has taken the copy over
 *
 * Sent on the progress channel because it happens while the picker is still awaiting the answer
 * to batch one's own Kopieer: whichever of the two arrives first, the panel ends up showing the
 * job rather than that one batch's report.
 *
 * @private
 */
function sendJobPanel(): void {
  const panel = jobPanelInfo();
  if (!panel || !activeJob) return;
  const line = jobProgress(activeJob.job);
  dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
    phase: 'copy',
    done: line.done,
    total: line.total,
    job: line,
    panel,
  } satisfies PanelProgress);
}

/**
 * Tells the panel what became of the job
 *
 * The only way out of the panel's job phase: the driver's copy has no return path to that
 * window -- only the picker's own Kopieer has one -- so a job that ended without this would
 * leave the panel sitting on a walk that is over, with its close button disabled.
 *
 * @param job the plan as it stands, after its closing line has been written
 * @param outcome 'stuck' for a job left open on a failed batch; otherwise the plan's own outcome
 * @param reason what to tell the user, for an ending no batch recorded -- a lost drop lock, a
 *   plan with no choices, a throw. Falls back to the failed batch's own error.
 * @param retryId the held offer's id, only for a completed job with losses
 * @returns the job end as sent
 * @private
 */
function sendJobEnd(job: LabelJob, outcome: JobOutcome | 'stuck', reason?: string, retryId?: string): JobEndInfo {
  const line = jobProgress(job);
  const jobEnd: JobEndInfo = {
    outcome,
    label: job.label,
    done: line.done,
    total: line.total,
    batches: job.batches.length,
    copiedBatches: job.batches.filter((b) => b.state === 'copied').length,
    targets: (job.choices?.targets ?? []).map((t) => t.email),
    error: reason ?? job.batches.find((b) => b.state === 'failed')?.error,
    failed: jobFailed(job),
    ...(retryId ? { retryId } : {}),
  };
  dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
    phase: 'copy',
    done: line.done,
    total: line.total,
    job: line,
    jobEnd,
  } satisfies PanelProgress);
  return jobEnd;
}

// The panel's walking phase is left by a job end and by nothing else, so every path that lets go
// of a walked job has to send one -- a throw out of the pull or the copy, a drop lock taken by a
// second drag, a plan whose batch one never got its choices. Each of those left activeJob set
// with no end sent, and the panel then sat on a walk that was over.
//
// Hence one function, and the rule that goes with it: activeJob is cleared here and in no other
// place. What makes that a guarantee rather than three more cases handled is the `finally` in
// advanceJob, which ends any job still held once the walk has left, however it left.

/**
 * Lets go of a walked job, telling the panel what became of it
 *
 * @param job the plan as it stands, after whatever closing line the caller decided to write
 * @param outcome 'stuck' leaves the plan open for the next start to offer
 * @param reason what to tell the user when no batch recorded the failure
 * @param offer true only from the walk's own completed ending, which may hold a retry offer
 * @private
 */
function endWalkedJob(job: LabelJob, outcome: JobOutcome | 'stuck', reason?: string, offer = false): void {
  // Every other ending lets the gathered losses go: only a completed job is offered a retry
  const lost = jobFailuresFor === job.jobId ? jobFailures : emptyJobFailures<MailDropCopyTarget, SavedRef, TreeThread>();
  const partial = jobFailuresPartial;
  jobFailures = emptyJobFailures();
  jobFailuresFor = null;
  jobFailuresPartial = false;
  dropJobOfferToast();
  lastJobFailures =
    offer && !partial && outcome === 'completed' && job.choices && !isEmpty(lost)
      ? {
          retryId: randomUUID(),
          serial: dropSerial,
          jobId: job.jobId,
          account: job.account,
          label: job.label,
          targets: job.choices.targets,
          acc: lost,
        }
      : null;
  const end = sendJobEnd(job, outcome, reason, lastJobFailures?.retryId);
  lastJobEnd = lastJobFailures ? end : null;
  activeJob = null;
  if (!lastJobFailures) return;
  notifyLog(
    `[maildrop] job for "${job.label}" holds a retry: ${lost.pull.length} unfetched, ${lost.copy.reduce((n, t) => n + t.files.length, 0)} copies`,
  );
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  jobOfferToast =
    showToast({
      kind: 'maildrop',
      title: L.jobRetryToastTitle(end.done, end.total, end.failed || lostConversations(lost)),
      body: L.jobRetryToastBody,
      persist: true,
    }) ?? null;
}

/**
 * Pulls and copies every batch left in the running job, one at a time
 *
 * Not a loop over a list but a walk over the plan on disk: each turn asks it what is next, so a
 * batch recorded as failed or a job that was closed underneath this stops it, and nothing has to
 * be kept in memory that a crash would take with it.
 *
 * One batch at a time on purpose, never overlapping the next pull with this copy. The two would
 * spend different mailboxes' quota and overlapping would nearly halve the wall clock, but
 * `lastDropSaved`, `lastDropPreview`, `lastDropTree` and `dropSerial` are module-level and built
 * for one drag -- which is exactly what re-entering the ordinary pull per batch relies on.
 *
 * @private
 */
async function advanceJob(): Promise<void> {
  // One walk at a time. The loop below awaits copyToMailboxes, and the tail of that function
  // starts the driver for the batch the user pressed Kopieer on -- so without this guard the
  // walk forks on every batch and the two halves fight over the drop lock, one of them losing it
  // and logging a wait nobody caused.
  if (jobDriving) return;
  jobDriving = true;
  // A stop meant for the walk that just ended is not one this walk inherits.
  jobStopWanted = null;
  // Before the first pull, so the panel leaves batch one's own report behind while that batch's
  // answer is still on its way back to the window.
  sendJobPanel();
  try {
    await walkJob();
  } catch (e) {
    // A pull that lost the network, a copy that could not even start. Left open rather than
    // closed: nothing here says the mail already copied is unwanted, and the next start's
    // offer is where that is answered.
    const why = (e as Error)?.message ?? 'onbekende fout';
    notifyLog(`[maildrop] job aborted by an error: ${why}`);
    if (activeJob) endWalkedJob(activeJob.job, 'stuck', why);
  } finally {
    // The guarantee. Every ending above clears activeJob through endWalkedJob, and anything
    // that reaches here still holding one left the walk by a route nobody wrote down -- which
    // is precisely the case that used to strand the panel. Reported rather than dropped.
    if (activeJob) endWalkedJob(activeJob.job, 'stuck', 'De klus is onverwacht gestopt');
    jobDriving = false;
  }
}

/**
 * The walk itself, batch after batch, with advanceJob owning the guard around it
 *
 * @private
 */
async function walkJob(): Promise<void> {
  while (activeJob) {
    if (jobStopWanted) {
      await stopWalkedJob(jobStopWanted);
      return;
    }
    const { job, root } = activeJob;
    const at = nextBatch(job);
    if (!at) break;
    // Nothing to copy with; batch zero never got its answer. Reported rather than broken out
    // of: the tail below only speaks for a job that has run out of batches, so this one used
    // to leave the walk without a word and be offered again at every start, forever.
    if (!job.choices) {
      notifyLog(`[maildrop] job for "${job.label}" cannot run: no mailboxes were chosen`);
      endWalkedJob(job, 'stuck', 'Deze klus heeft geen gekozen postvakken — sleep het label opnieuw');
      return;
    }

    const token = dropLock.take(Date.now());
    // Nobody resumes a walk that stood aside, so standing aside is an ending and says so. The
    // plan stays open, which is what makes the next start offer to continue it.
    if (token === null) {
      notifyLog('[maildrop] job stopped: mail is already being fetched');
      endWalkedJob(job, 'stuck', 'Er werd al andere mail opgehaald, dus de klus is gestopt');
      return;
    }
    manager?.sendDropLock({ locked: true });
    // A batch's pull is cancellable exactly like a plain drag's, and it is the longer of the two:
    // this is the wait the user is most likely to want out of. The driver's own check right after
    // this block sees jobStopWanted, which cancelMailDropPull sets, and ends the job before the
    // batch it just pulled goes out.
    const pull = createPullControl();
    setActivePull(pull);
    setPullDone(0);
    try {
      const ts = new Date().toISOString();
      bumpDropSerial();
      setLastDropSaved([]);
      const report = pullReporter();
      // No listing for a later batch: the plan already holds the conversations, and asking Gmail
      // again would both cost a hundred pages and risk a different answer than the one the
      // batches were cut from.
      const { items, saved, threads } = await saveLabel(
        ts, job.account, root, job.label, '', '', report, null, at.threads,
      );
      // Nothing is offered while a job walks; this tells the batch what it lost, and the job too
      rememberPullFailures(items, {
        acctKey: '',
        account: job.account,
        authuser: '',
        ik: '',
        rowCount: items.length,
        from: (failedAt) => ({ kind: 'label', label: job.label, threads: failedAt.map((i) => threads[i]) }),
      }, at.threads.map((t) => t.threadId));
      // A cancelled batch pull records nothing and shows nothing: the batch stays 'pending', so a
      // job resumed later pulls it again rather than copying half of it. Deliberately not a
      // return: the walk's own stop check sits just past this block and is what ends the job and
      // lets the panel out of its walking phase. Leaving here would strand it there.
      if (pull.stopped()) {
        setLastDropSaved([]);
      } else {
        setLastDropSaved(saved);
        recordJobBatchState(root, job.jobId, { index: at.index, state: 'pulled' });
        activeJob.job = readLabelJob(root, job.jobId) ?? job;
        // Shown, but marked as driven. Not showing it at all was the first answer to the
        // duplicate of 2026-08-26 and it went too far: once the picker had been closed after a
        // batch, the rest of a half-hour job ran with nothing on screen. `driven` is what
        // separates the two needs -- the picker updates its list and stays out of its picking
        // phase, so the batch is visible without Kopieer being offered for it.
        openDropPreview(items, true, { panel: jobPanelInfo(), job: activeJob ? jobProgress(activeJob.job) : undefined });
      }
    } finally {
      if (activePull === pull) setActivePull(null);
      if (dropLock.release(token)) {
        manager?.sendDropLock(
          pull.stopped() ? { locked: false, note: cancelledText(pullDone) } : { locked: false },
        );
      }
    }

    // Asked for while this batch was being pulled: stopped before a single mail of it goes out,
    // which is why this sits between the pull and the copy rather than only at the top of the walk.
    if (jobStopWanted) {
      await stopWalkedJob(jobStopWanted);
      return;
    }

    // The same call the picker's own Kopieer makes, with the choices batch zero was given. The
    // duplicate scan runs again inside it, per batch, against that batch's own mail -- which is
    // what keeps "which mail lands where" the live answer it has always been.
    const result = await copyToMailboxes({
      targets: job.choices.targets,
      mode: job.choices.mode,
      fromJob: true,
    });
    if ('stopped' in result && result.stopped) {
      // Ordinarily closed by the tail of copyToMailboxes before this line is reached, which is
      // why the guard is on activeJob rather than on the result: a stop that got there first
      // leaves nothing here to do, and one that somehow did not still ends the job here.
      if (activeJob) {
        await endJobWithStop(
          activeJob.job,
          activeJob.root,
          result.mode,
          rollbackWholeJob,
          'stopped during a batch',
        );
      }
      return;
    }
    if ('ok' in result && !result.ok) refuseUnrecordedBatch(at.index, result.error);
  }

  if (activeJob && !nextBatch(activeJob.job)) {
    const { job, root } = activeJob;
    const stuck = job.batches.some((b) => b.state === 'failed');
    // A job stopped by a failed batch is left open on purpose -- no closing line. The picker
    // already shows that batch's own failure now, and the missing line is what makes the next
    // start offer to continue, keep or undo it. Closing it here would swallow the one state the
    // user still has to answer for, which is the whole reason a failed batch stops the walk
    // instead of stepping over it.
    if (!stuck) {
      const failed = attemptWrite(() => finishLabelJob(root, job.jobId, 'completed'));
      if (failed) notifyLog(`[maildrop] could not close the job: ${failed}`);
    }
    notifyLog(
      `[maildrop] job for "${job.label}" ${stuck ? 'stopped on a failed batch, left open for a choice' : 'finished'}: ${job.batches.filter((b) => b.state === 'copied').length} of ${job.batches.length} batches`,
    );
    endWalkedJob(job, stuck ? 'stuck' : 'completed', undefined, !stuck);
  }
}

/**
 * Ends a job the user cancelled between two batches
 *
 * The same two steps the stop of a running batch takes, minus the batch: the one just pulled has
 * not inserted anything, so there is nothing of it to sweep. 'rollback' still means the batches
 * that did finish, swept by the same rollbackFinishedBatches a running stop uses -- what
 * cancelling does to mail that already landed is decided in one place, not two.
 *
 * @param mode what the panel asked for
 * @private
 */
async function stopWalkedJob(mode: 'keep' | 'rollback'): Promise<void> {
  jobStopWanted = null;
  if (!activeJob) return;
  const { job, root } = activeJob;
  // Between two batches every rollback is a job-wide one: the batch just pulled has inserted
  // nothing, so the only mail a rollback here can mean is what the finished batches landed.
  await endJobWithStop(
    job,
    root,
    mode,
    mode === 'rollback' || rollbackWholeJob,
    'stopped between two batches',
  );
}

/**
 * Copies whatever the last drag saved into the chosen labels, in the chosen mailboxes
 *
 * The job-aware wrapper around copy/copy-run.ts's own runCopyToMailboxes, the engine itself:
 * this adds the re-entrancy guard against a job's own batch, and the callbacks that let a walked
 * batch note its choices, honour a job-wide stop, fold its losses into the job's, and record what
 * it came to -- every one a no-op outside a job.
 *
 * A copy that is paused and then stopped ends in one of three ways: 'completed' when it was
 * never stopped at all, 'kept' when the user chose to leave what had already landed, or a
 * rollback outcome when they chose to undo it -- see copy/upload.ts's copyOneFile and
 * copy/copy-run.ts's runCopyToMailboxes for where each of those is decided.
 *
 * @param arg
 * @returns {Promise<MailDropCopyResult|MailDropCopyWarnedResult|MailDropCopyStoppedResult>} what
 *   the picker draws: the counts, the duplicate question, or how the stop was settled
 */
export async function copyToMailboxes(arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
  /** Set only by the job driver, when this copy is one batch of a walked job. Every other
   * caller -- the picker's Kopieer, an IPC message, a stale window -- leaves it unset, which is
   * what the guard below reads to refuse a second copy of mail a running job is already
   * copying. */
  fromJob?: boolean;
  /** Set only by retryFailedCopy and retryFailedJob: the mailboxes and, per mailbox, the files
   * that failed there */
  retry?: { retryId: string; targets: MailDropCopyTarget[]; files: Map<string, SavedRef[]> };
  /** Set only by retryFailedJob, which rebuilds the job's offer from this run's failures rather
   * than letting the tail hold a part-1 offer */
  jobRetry?: boolean;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
  // A copy nobody asked for is worse than a copy refused. While the driver is walking a job it
  // is already copying `lastDropSaved`, and a second call against the same files inserts every
  // one of them again: 717 mails landed twice that way on 2026-08-26, off a preview that
  // reopened for batch 2 with a live Kopieer button.
  //
  // The duplicate scan is no defence here and cannot be made one -- Gmail's index had not caught
  // up with inserts made seconds earlier, so the scan found nothing and the second copy went
  // ahead in good faith. Only knowing that a job owns these files right now can refuse it.
  if (jobDriving && !arg?.fromJob) {
    notifyLog('[maildrop] second copy refused: the job is already copying this mail itself');
    return {
      ok: false,
      copied: 0,
      skipped: 0,
      total: 0,
      accounts: [],
      error: 'Er loopt een klus die deze mail zelf kopieert. Pauzeer of stop die eerst.',
    };
  }
  // The plan this copy answers for, captured rather than read again at the far end. The driver's
  // own walk runs minutes after this line, and a plan replaced in between took this batch's
  // insert count into its own file: two thousand conversations recorded as copied that nobody
  // had copied. What recordBatchAndAdvance compares against is sameJobPlan.
  const forPlan: JobPlanRef | null = activeJob ? { jobId: activeJob.job.jobId } : null;
  return await runCopyToMailboxes({
    ...arg,
    partOfJob: Boolean(arg?.fromJob) || Boolean(arg?.jobRetry) || forPlan !== null,
    // Recorded the moment the copy is accepted rather than when it finishes: these are the
    // choices, and a crash between here and the end of batch zero must resume with them rather
    // than ask again. Only the first batch writes them; every later one is running because of
    // them. A no-op outside a job, and after the first batch of one.
    noteJobChoices: (targets, mode) => {
      if (!activeJob || activeJob.job.choices) return;
      const choices = { targets, mode: inheritedMode(mode === 'all' ? 'all' : mode === 'new' ? 'new' : null) };
      const failed = attemptWrite(() => recordJobChoices(activeJob!.root, activeJob!.job.jobId, choices));
      if (failed) notifyLog(`[maildrop] could not record the job's choices: ${failed}`);
      activeJob.job = { ...activeJob.job, choices };
    },
    // Asked at the two moments a job-wide stop can still change this batch's own outcome before
    // its gate exists to take it -- see runCopyToMailboxes's own call sites. Consumes the stop
    // once taken, so a second ask answers null unless another stop arrived meanwhile.
    jobStop: arg?.fromJob
      ? () => {
          if (!jobStopWanted) return null;
          const stopMode = jobStopWanted;
          // The job-wide sweep, exactly as the running stop sets it: this batch has nothing of
          // its own to undo, and only the batches that already finished are anybody's question.
          if (stopMode === 'rollback') rollbackWholeJob = true;
          jobStopWanted = null;
          return stopMode;
        }
      : undefined,
    // A job's batch adds to what the job lost; a job retry hands its failures to retryFailedJob
    // instead, which runCopyToMailboxes does on its own.
    onJobFailures: (failuresByTarget) => {
      if (forPlan && activeJob?.job.jobId === forPlan.jobId && jobFailuresFor === forPlan.jobId) {
        jobFailures = addCopyFailures(jobFailures, failuresByTarget);
      }
    },
    onBatchResult: (result, runId, failuresByTarget) =>
      recordBatchAndAdvance(forPlan, result, runId, failuresByTarget),
  });
}

/**
 * Records a walked batch's outcome against the job it belonged to, and lets the walk go on
 *
 * Reads the plan afresh rather than trusting what copyToMailboxes started with: a plan replaced
 * while the copy was running must not have this batch's count written into its file. What
 * matches is sameJobPlan, and a job that no longer matches gets nothing written for it -- see
 * copyToMailboxes's own comment on `forPlan` for why a drag can no longer land here.
 *
 * @param forPlan the plan this copy was started for, captured before it ran, or null outside
 *   any job
 * @param result what the copy answered
 * @param runId the copy's own run id, for the batch state line
 * @param failuresByTarget what the copy could not land, per mailbox
 * @private
 */
async function recordBatchAndAdvance(
  forPlan: JobPlanRef | null,
  result: MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult,
  runId: CopyRunId,
  failuresByTarget: TargetFailures<MailDropCopyTarget, SavedRef>[],
): Promise<void> {
  const held = activeJob ? { jobId: activeJob.job.jobId } : null;
  const ours = sameJobPlan(forPlan, held) ? activeJob : null;
  if (forPlan && !ours) {
    notifyLog('[maildrop] batch state not recorded: this job is no longer being walked');
    // The flag was set for a job that is no longer walked. Left standing it would roll back
    // the finished batches of whatever job is walked next.
    rollbackWholeJob = false;
  }
  // The batch is only 'copied' once the copy answered, whatever it answered: a batch that
  // failed outright is recorded as failed and nextBatch then stops the job rather than trying
  // the next two thousand into a mailbox that just refused us.
  if (ours) {
    const at = nextBatch(ours.job);
    if (at) {
      const stopped = 'stopped' in result && result.stopped;
      const failedHard = !stopped && 'ok' in result && !result.ok;
      const failed = attemptWrite(() =>
        recordJobBatchState(ours.root, ours.job.jobId, {
          index: at.index,
          state: failedHard ? 'failed' : 'copied',
          runId,
          copied: 'copied' in result ? result.copied : undefined,
          skipped: 'skipped' in result ? result.skipped : undefined,
          error: failedHard ? (result as MailDropCopyResult).error : undefined,
          failed: failedConversations(failuresByTarget, batchPullFailedThreads),
        }),
      );
      if (failed) notifyLog(`[maildrop] could not record the state of batch ${at.index}: ${failed}`);
      ours.job = readLabelJob(ours.root, ours.job.jobId) ?? ours.job;
      // A stop is the user's final word on the whole job, not just on this batch, so the driver
      // is not started. What the stop rolls back is decided just below.
      if (!stopped) void advanceJob();
    }
  }
  // The same plan again, for the same reason: a stop closes the job this copy belonged to and
  // never one that took its place.
  if (ours && 'stopped' in result && result.stopped) {
    await endJobWithStop(ours.job, ours.root, result.mode, rollbackWholeJob, 'stopped during a batch');
  }
}

/**
 * Fetches what a finished job could not, then copies everything it lost into its own mailboxes
 *
 * @param arg the id the job's closing line was given, and the mode the duplicate screen answered with
 * @returns what copyToMailboxes answers, carrying the next offer's id and what is still unfetched
 */
export async function retryFailedJob(arg: {
  retryId: string;
  mode?: CopyMode;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
  const fail = (error: string, retryId?: string): MailDropCopyResult => ({
    ok: false,
    copied: 0,
    skipped: 0,
    total: 0,
    accounts: [],
    error,
    ...(retryId ? { retryId } : {}),
  });
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastJobFailures,
    serial: dropSerial,
    jobDriving,
    jobActive: activeJob !== null,
    pulling: activePull !== null,
    copying: activeRun !== null || retryInFlight,
  });
  if (refused || !lastJobFailures) return fail(refused ?? 'Niets om opnieuw te proberen');
  const mode: CopyMode = arg.mode ?? 'check';
  let held = lastJobFailures;
  setRetryInFlight(true);
  try {
    const errors = new Map<string, string>();
    const warnings: string[] = [];
    // A confirm-screen follow-up already holds what the first press fetched
    if (mode === 'check' && held.acc.pull.length > 0) {
      const { slice, rest } = takePullSlice(held.acc, JOB_BATCH_THREADS);
      const ts = new Date().toISOString();
      const root = mailDropFolder();
      const got: { cancelled?: boolean; saved?: SavedRef[]; failed?: Set<string> } = {};
      const viewKey = profiles.find((p) => p.email === held.account);
      // No await between the refusal and the lock: a second press is refused by one or the other
      const ran = await withPullLock(viewKey ? keyOf(viewKey) : manager?.activeKey() ?? '', async () => {
        const mine = activePull;
        const fetched = await fetchThreadSlice(held.account, slice, pullReporter());
        if (mine?.stopped()) {
          got.cancelled = true;
          return;
        }
        if (fetched === null) {
          for (const t of slice) errors.set(t.threadId, 'Geen toegang tot dit postvak');
          got.failed = new Set(slice.map((t) => t.threadId));
          return;
        }
        const written = await writeCollected(ts, held.account, root, held.label, fetched, []);
        if (written.logError) warnings.push(`logboek niet bijgeschreven: ${written.logError}`);
        const again = failedRowIndexes(written.items).map((i) => written.items[i]);
        for (const row of again) errors.set(row.threadId, row.error ?? '');
        got.failed = new Set(again.map((row) => row.threadId));
        got.saved = written.saved;
      });
      if (!ran) return fail(BUSY_TEXT, held.retryId);
      if (got.cancelled) return fail('Opnieuw ophalen geannuleerd', held.retryId);
      // A long retry can outlive the lock, and the drag that took over must not receive its files
      if (dropSerial !== held.serial || lastJobFailures !== held) {
        notifyLog('[maildrop] job retry fetch discarded: another drag took its place');
        return fail('Deze lijst is verlopen. Sleep de mail opnieuw.');
      }
      const failed = got.failed ?? new Set<string>();
      const pull = [...slice.filter((t) => failed.has(t.threadId)), ...rest];
      const acc = addFetchedToAllTargets({ copy: held.acc.copy, pull }, held.targets, got.saved ?? []);
      notifyLog(`[maildrop] job retry fetched ${slice.length - failed.size} of ${slice.length} conversation(s)`);
      // Written back before the copy, so a confirm follow-up sees these files and fetches nothing
      held = { ...held, acc };
      lastJobFailures = held;
    }

    const unfetched = (pull: TreeThread[]): FailureLine[] =>
      pull.map((t) => ({ subject: t.subject, error: errors.get(t.threadId) || 'Niet opgehaald', maybeLanded: false }));
    const files = retryFiles(held.acc);
    const targets = held.targets.filter((t) => (files.get(t.email)?.length ?? 0) > 0);
    if (targets.length === 0) {
      const retryId = renewJobOffer(held, held.acc);
      return withWarnings(
        {
          ok: held.acc.pull.length === 0,
          copied: 0,
          skipped: 0,
          total: 0,
          accounts: [],
          ...(retryId ? { retryId, unfetched: unfetched(held.acc.pull) } : {}),
        } satisfies MailDropCopyResult,
        warnings,
      );
    }

    notifyLog(`[maildrop] job retry of ${targets.reduce((n, t) => n + files.get(t.email)!.length, 0)} copies`);
    setLastRunFailures(null);
    let result: Awaited<ReturnType<typeof copyToMailboxes>>;
    try {
      result = await copyToMailboxes({
        targets: [],
        mode,
        retry: { retryId: held.retryId, targets, files },
        jobRetry: true,
      });
    } catch (e) {
      // Some of these may have landed before the throw, and the scan cannot see fresh inserts
      if (lastJobFailures === held) clearJobOffer();
      throw e;
    }
    // Widened again: the tail sets it during the await, which narrowing cannot see
    const runFailures = lastRunFailures as TargetFailures<MailDropCopyTarget, SavedRef>[] | null;
    setLastRunFailures(null);
    const merged = <T extends object>(r: T): T => {
      const had = (r as { warnings?: string[] }).warnings ?? [];
      return withWarnings(r, [...had, ...warnings]) as T;
    };
    if ('stopped' in result && result.stopped) {
      if (lastJobFailures === held) clearJobOffer();
      return merged(result);
    }
    // Only the tail of a run that went to its end leaves failures; anything earlier changed nothing
    if (!runFailures) {
      const live = lastJobFailures === held;
      return merged({
        ...result,
        ...(live ? { retryId: held.retryId, unfetched: unfetched(held.acc.pull) } : {}),
      });
    }
    if (dropSerial !== held.serial || lastJobFailures !== held) return merged(result);
    // A mailbox the run never wrote to keeps what it was owed
    const ran = new Set(runFailures.map((t) => t.target.email));
    const untouched = held.acc.copy.filter((t) => !ran.has(t.target.email));
    const copy = [...untouched, ...(copyFailuresOf(runFailures) ?? [])];
    const retryId = renewJobOffer(held, { copy, pull: held.acc.pull });
    return merged({
      ...result,
      ...(retryId ? { retryId } : {}),
      ...(held.acc.pull.length > 0 ? { unfetched: unfetched(held.acc.pull) } : {}),
    });
  } finally {
    setRetryInFlight(false);
  }
}

/**
 * The job the user has to make a continue-or-undo decision about, if any
 *
 * Asked by the mail-drop window when it opens, the same moment it already asks for the orphan
 * decision (copy/orphan-runs.ts) and the existing-mail scan.
 *
 * @returns the job and how far it got, or null when nothing is waiting
 */
export function pendingJobDecision(): PendingJob | null {
  if (!pendingJob || !pendingJob.choices) return null;
  return {
    jobId: pendingJob.jobId,
    label: pendingJob.label,
    ...jobProgress(pendingJob),
    mode: pendingJob.choices.mode,
  };
}

/**
 * Answers a pending job decision
 *
 * 'continue' re-pulls the batch that was in flight. Its slice may be partly copied already, and
 * the inherited 'new' mode is what makes that safe: the scan finds what landed and skips it. An
 * 'all' job has no such protection, which is why the offer says so in those words rather than
 * leaving the user to find out.
 *
 * @param jobId must be the one pendingJobDecision last returned
 * @param choice
 * @returns whether the decision was taken -- false when this job is no longer pending, which a
 *   second click or a stale window can both cause harmlessly
 */
export async function decideJobRun(
  jobId: string,
  choice: 'continue' | 'keep' | 'rollback',
): Promise<{ ok: boolean }> {
  const job = pendingJob;
  if (!job || job.jobId !== jobId) return { ok: false };
  pendingJob = null;
  const root = mailDropFolder();

  if (choice === 'continue') {
    // A batch recorded as failed is what nextBatch stops at, so continuing has to clear it back
    // to pending first -- otherwise the driver is handed a job it will refuse to walk and the
    // offer would do nothing at all. Written as a new state line rather than by rewriting the
    // file: the failure stays in the record above it, which is what a later reader needs to see
    // that this batch was retried and not merely slow.
    const stuck = job.batches.find((b) => b.state === 'failed');
    if (stuck) {
      const failed = attemptWrite(() =>
        recordJobBatchState(root, jobId, { index: stuck.index, state: 'pending' }),
      );
      if (failed) return { ok: false };
    }
    activeJob = { job: readLabelJob(root, jobId) ?? job, root };
    startGathering(jobId, true);
    void advanceJob();
    return { ok: true };
  }

  const trouble = choice === 'rollback' ? await rollbackFinishedBatches(job, root) : [];
  const outcome = jobStopOutcome(choice, trouble);
  const failed = attemptWrite(() => finishLabelJob(root, jobId, outcome));
  if (failed) notifyLog(`[maildrop] could not close the job: ${failed}`);
  if (trouble.length > 0) notifyLog(`[maildrop] not everything was rolled back: ${trouble.join(', ')}`);
  return { ok: true };
}


//===========================
// Helper functions
//===========================

/**
 * The plan's own outcome for a stop
 *
 * @param mode what the user chose for the mail that had already landed
 * @param trouble the batches a rollback could not account for
 * @returns {JobOutcome}
 * @private
 */
function jobStopOutcome(mode: CopyStopMode, trouble: string[]): JobOutcome {
  if (mode === 'keep') return 'kept';
  return trouble.length === 0 ? 'rolled-back' : 'rolled-back-partial';
}

/**
 * Closes a job the user stopped and lets the walk go
 *
 * The one place the ordering of a stop is written down: the batches that already finished are
 * swept when the stop was job-wide, the outcome follows from what that came to, the plan is
 * closed, and only then is the job let go. Three call sites spelled this out with small
 * divergences between them, which is three copies of an ordering that has to agree.
 *
 * @param job the plan as it stands
 * @param root the drop folder
 * @param mode what the user chose for the mail that had already landed
 * @param wholeJob whether the batches that already finished are part of this stop
 * @param where what to log about the moment the stop arrived
 * @private
 */
async function endJobWithStop(
  job: LabelJob,
  root: string,
  mode: CopyStopMode,
  wholeJob: boolean,
  where: string,
): Promise<void> {
  const trouble = wholeJob ? await rollbackFinishedBatches(job, root) : [];
  const outcome = jobStopOutcome(mode, trouble);
  const failed = attemptWrite(() => finishLabelJob(root, job.jobId, outcome));
  if (failed) notifyLog(`[maildrop] could not close the job: ${failed}`);
  if (trouble.length > 0) notifyLog(`[maildrop] not everything was rolled back: ${trouble.join(', ')}`);
  notifyLog(
    `[maildrop] job for "${job.label}" ${where}: ${
      mode === 'keep' ? 'what has landed stays' : 'rolled back'
    }`,
  );
  rollbackWholeJob = false;
  // Read back rather than handed on: the panel is told the counts the closing line just wrote
  endWalkedJob(readLabelJob(root, job.jobId) ?? job, outcome);
}

/**
 * Starts gathering a job's losses afresh, letting go of any older job's offer
 *
 * @param jobId the job about to be walked
 * @param partial true for a job resumed after a restart, which then ends with no offer
 * @private
 */
function startGathering(jobId: string, partial = false): void {
  jobFailures = emptyJobFailures();
  jobFailuresFor = jobId;
  jobFailuresPartial = partial;
  clearJobOffer();
}

/**
 * Lets go of the held job offer, and of the card that announced it
 *
 * @private
 */
function clearJobOffer(): void {
  lastJobFailures = null;
  lastJobEnd = null;
  dropJobOfferToast();
}

/**
 * Takes down the card of a job offer that has gone or been replaced
 *
 * @private
 */
function dropJobOfferToast(): void {
  if (jobOfferToast) dismissShownToast(jobOfferToast);
  jobOfferToast = null;
}

/**
 * Records a walked batch as failed when its copy refused before the tail could record it
 *
 * A refusal such as no saved mail or no link left the batch 'pulled', and nextBatch then handed
 * it back to be pulled again for as long as the refusal lasted. Failed, it ends the job stuck the
 * way any refused batch does, with the plan left open for the start-up choice.
 *
 * @param index the batch the copy was for
 * @param error what the copy answered
 * @private
 */
function refuseUnrecordedBatch(index: number, error: string | undefined): void {
  if (!activeJob) return;
  const { job, root } = activeJob;
  const batch = job.batches.find((b) => b.index === index);
  if (!batch || batch.state === 'failed' || batch.state === 'copied') return;
  const failed = attemptWrite(() => recordJobBatchState(root, job.jobId, { index, state: 'failed', error }));
  if (failed) {
    notifyLog(`[maildrop] could not record the state of batch ${index}: ${failed}`);
    endWalkedJob(job, 'stuck', error);
    return;
  }
  activeJob.job = readLabelJob(root, job.jobId) ?? job;
}

/**
 * Holds what a job retry left under a fresh id, or lets the offer go when nothing is left
 *
 * @param held the offer the retry ran for
 * @param acc what is still lost
 * @returns the new id, or undefined when the offer is gone
 * @private
 */
function renewJobOffer(held: NonNullable<typeof lastJobFailures>, acc: JobLosses): string | undefined {
  if (isEmpty(acc)) {
    clearJobOffer();
    return undefined;
  }
  // The card still speaks the first count; the panel holding the renewed offer speaks this one
  dropJobOfferToast();
  const retryId = randomUUID();
  lastJobFailures = { ...held, retryId, acc };
  lastJobEnd = lastJobEnd ? { ...lastJobEnd, retryId, failed: lostConversations(acc) } : null;
  return retryId;
}

/**
 * What the panel should say a job is doing, or nothing when no job is walking
 *
 * Gated on the choices rather than on the job existing: a plan is written before the user has
 * picked anything, and a panel told about that job would replace the picking phase with a job
 * phase before there was a job to walk.
 *
 * @returns the label and its target mailboxes, or undefined outside a walking job
 * @private
 */
function jobPanelInfo(): JobPanel | undefined {
  const choices = activeJob?.job.choices;
  if (!activeJob || !choices) return undefined;
  return { label: activeJob.job.label, targets: choices.targets.map((t) => t.email) };
}

/**
 * The running job's own numbers, for the strip that draws above one batch's bar
 *
 * The batches behind come off the plan file; the batch in flight is only in the caller's own
 * counters, so it is handed in. Called without it the line steps once a batch, which is what
 * it did before -- so every caller that has the figures passes them.
 *
 * Wired into copy/copy-run.ts's own CopyJobHooks, which is how that file's progress lines and
 * paused line read it without importing the job driver here.
 *
 * @param running the current batch's live insert count and mailbox count, when copying
 * @returns the job's progress, or undefined when this is a plain drag -- which is what makes the
 *   picker draw exactly the line it drew before jobs existed
 * @private
 */
function jobProgressForSend(running?: RunningBatchProgress): MailDropCopyProgress['job'] {
  return activeJob ? jobProgress(activeJob.job, running) : undefined;
}


//===========================
// Wiring
//===========================

// Told once, here, rather than reached for: pull-controller.ts cannot import the job driver
// above without a cycle, so every question and write that crosses that boundary travels
// through this one object instead. See JobDriverHooks for what each entry answers.
setJobDriverHooks({
  isDriving: () => jobDriving,
  isActive: () => activeJob !== null,
  copyBusy: () => activeRun !== null || retryInFlight,
  endStaleJob: () => {
    if (activeJob) {
      notifyLog(`[maildrop] job for "${activeJob.job.label}" let go for a new drag`);
      endWalkedJob(activeJob.job, 'stuck', 'Er werd opnieuw gesleept, dus de klus is losgelaten');
    }
    activeJob = null;
  },
  beginJob: (job, root) => {
    activeJob = { job, root };
    startGathering(job.jobId);
  },
  cancelIfDriving: () => {
    if (activeJob && jobDriving) {
      jobStopWanted = 'keep';
      notifyLog('[maildrop] the job stops with it; what has been copied stays');
    }
  },
  recordBatchPullLoss: (batchThreadIds, threads) => {
    if (activeJob && jobFailuresFor === activeJob.job.jobId) {
      jobFailures = replaceBatchPull(jobFailures, batchThreadIds, threads);
    }
  },
  clearJobOffer: () => clearJobOffer(),
  clearCopyFailures: () => {
    setLastCopyFailures(null);
  },
  previewExtra: () => ({
    jobEnd: lastJobFailures && lastJobEnd ? lastJobEnd : null,
    panel: jobPanelInfo(),
    job: activeJob ? jobProgress(activeJob.job) : undefined,
  }),
});

// copy/copy-run.ts cannot import the job driver above without a cycle either, so its own
// crossings travel the same way.
setCopyJobHooks({
  requestJobStop: (mode) => {
    jobStopWanted = mode;
  },
  jobProgressFor: jobProgressForSend,
});

// copy/copy-retry.ts's own retryFailedCopy re-enters this wrapper exactly as a fresh Kopieer
// does, so it reaches it the same way: a hook, never an import of the module above it.
setCopyEntryPoint(copyToMailboxes);
