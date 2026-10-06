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
  MailDropCopyAccountResult,
  MailDropCopyControlAction,
  MailDropCopyControlResult,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
  MailDropPayload,
  MailDropPreviewItem,
  MailDropTree,
} from '../core/ipc';
import { currentLocale, dropOverlay, recentLabels, keyOf, manager, oauthTokens, prefs, profiles, messageIndex } from '../core/runtime';
import type { JobPanel, PendingJob, PendingOrphan } from '../../renderer/lib/maildrop-copy';
import { createUploadBudget, mapLimit, type UploadBudget } from '../core/concurrency';
import { forceRefresh } from '../auth/oauth-flow';
import { oauthConfig } from '../auth/oauth-config';
import { isAllowedAccount } from '../auth/account-domain';
import {
  clearRefreshFailure,
  markRefreshFailed,
} from '../auth/oauth-health-check';
import { isDelegatedMailbox, mailboxToken } from '../auth/mailbox-token';
import { notifyLog } from '../notify/notify-log';
import { appendLog, type LogRecord } from './pull/mail-archive';
import {
  assembleCopy,
  checkLogLine,
  copyLogLine,
  copyTotal,
  perMailboxLimit,
  duplicateIndex,
  groupDuplicates,
  newMessageCount,
  normalizeTargets,
  tallyOutcomes,
  type CopyMode,
  type ResolvedTreeLabels,
} from './copy/mail-copy';
import { type TreeThread } from './drag/label-drop';
import {
  JOB_BATCH_THREADS,
  findUnfinishedJobs,
  finishLabelJob,
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
import {
  STOP_TOO_LATE_TEXT,
  jobStopFromAction,
  sameJobPlan,
  stopReachesRun,
  type JobEndInfo,
  type JobPlanRef,
} from './job/job-guard';
import { BUSY_TEXT, cancelledText, dropOutcome } from './drag/dropzone';
import { createPullControl } from './pull/pull-control';
import { createCopyRunControl, type CopyRunControl } from './copy/copy-control';
import {
  ALREADY_COPIED_TEXT,
  copyFailuresOf,
  failedConversations,
  failedFiles,
  failureLines,
  retryRefusal,
  wholeTargetFailed,
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
import { failedRowIndexes } from '../../renderer/lib/failure-list';
import {
  attemptWrite,
  finishCopyJournal,
  findOrphanedRuns,
  readCopyJournal,
  recordCopyJournalDecision,
  recordCopyJournalEntry,
  recordCopyJournalLabel,
  startCopyJournal,
  withWarnings,
  type CopyJournalOutcome,
  type CopyJournalRead,
  type CopyJournalRemainder,
} from './copy/copy-journal';
import { deleteCreatedLabels, sweepRunMarkers as runSweep } from './copy/copy-marker-run-sweep';
import type {
  CopyJournalEntry,
  CopyRunId,
  CopyStopMode,
  CreatedLabel,
  MarkerLabel,
  RollbackOutcome,
} from './copy/copy-run-types';
import {
  batchModifyMessages,
  createHiddenLabel,
  deleteLabel,
  fetchMessageListPage,
  markerLabelName,
  type ThreadMessage,
} from '../gmail/gmail-api';
import {
  activePull,
  batchPullFailedThreads,
  bumpDropSerial,
  copiedSerial,
  dropSerial,
  lastDropPreview,
  lastDropSaved,
  lastDropSource,
  lastDropTree,
  pullDone,
  setActivePull,
  setCopiedSerial,
  setLastDropPreview,
  setLastDropSaved,
  setLastDropSource,
  setLastDropTree,
  setPullDone,
  type SavedRef,
} from './drop-state';
import { copyOneFile, copyToMailbox, type CopyOutcome } from './copy/upload';
import { createTreeLabels, MAILBOX_LIMIT, perMessageLabels, planTrees } from './copy/tree-setup';
import {
  existingForCopyTargets,
  findDuplicates,
  labelsForCopyTargets,
  labelsForEveryMailbox,
  lastScan,
  setLastScan,
} from './copy/duplicate-scan';
import {
  fetchThreadSlice,
  saveLabel,
  writeCollected,
  type SaveProgress,
} from './pull/pull-collect';
import {
  dropLock,
  mailDropFolder,
  openDropPreview,
  pullReporter,
  rememberPullFailures,
  setJobDriverHooks,
  withPullLock,
} from './pull/pull-controller';

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

/** What the last copy could not land, held for the panel's retry button. Only for a copy the
 * picker ran itself: a job's batches are part 2. */
let lastCopyFailures:
  | { retryId: string; serial: number; targets: TargetFailures<MailDropCopyTarget, SavedRef>[] }
  | null = null;

/** The copy in flight right now, if any -- so a pause or stop asked for over IPC can reach
 * the loop that is actually running. `total` is carried here too, not recomputed, since a
 * paused progress line needs the same number the running one showed. */
let activeRun: {
  runId: CopyRunId;
  control: CopyRunControl;
  root: string;
  total: number;
  /** Mailboxes this run writes to, kept because `total` alone cannot be turned back into
   * conversations for the job line */
  targets: number;
  /** Set once the run has read its own stop mode, after which its tally is fixed. Everything
   * that follows -- the log, the marker sweep with its five rounds of backoff -- is seconds of
   * work in which the gate no longer decides anything, and a stop arriving then was answered as
   * if it had been taken. See stopReachesRun. */
  decided: boolean;
} | null = null;

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

/** Set while a retry is under way, which activeRun only covers once the copy itself starts */
let retryInFlight = false;

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

/** A job retry's copy failures, left by the tail of copyToMailboxes for retryFailedJob to take */
let lastRunFailures: TargetFailures<MailDropCopyTarget, SavedRef>[] | null = null;


//===========================
// Exported functions
//===========================

// What may be in flight across the whole copy, in bytes rather than in mails. A count was the
// wrong unit: it had to be low enough for the one mail of eleven megabytes, which then throttled
// the ninety-nine of fifty kilobytes beside it -- measured at 28% of the quota Gmail allowed,
// purely because of that setting. This bounds peak memory for real, and lets small mails go wide.
const COPY_BYTES_IN_FLIGHT = 64 * 1024 * 1024;

// A ceiling on the count as well, so tiny mails do not open hundreds of connections at once.
//
// Set from a measurement rather than from the arithmetic. The arithmetic says thirty-two: an
// insert costs 25 of 250 units, so ten a second, and reaching ten a second while one insert takes
// 2.8 seconds needs about thirty in flight. Tried, and it came out 2.2x SLOWER -- the old quota
// window handed out a second's worth in one burst, Gmail answered 429, and the retry backoff cost
// more than the concurrency won. quota.ts paces smoothly now, so that failure mode is gone, and
// twenty-four is as far as this goes until a live run says otherwise.
const COPY_IN_FLIGHT = 24;

const PER_MAILBOX_MAX = 12;

/**
 * Sweeps every mailbox's own marker for one run, wiring the real Gmail calls into
 * copy-marker-run-sweep.ts's own sweepRunMarkers
 *
 * The strip-vs-trash logic and the "acts on the listing, not on any local record" property it
 * gives a rollback both live there instead of here, purely so they can be unit tested: this
 * file pulls in Electron's `app` at module load (core/paths.ts), so nothing importing it can
 * ever run under a test.
 *
 * @param runId
 * @param markers this run's own marker per mailbox, from its journal header
 * @param mode 'strip' for a clean finish or a stop-keep, 'trash' for a stop-rollback
 * @param created the labels this run made itself, deleted again on a rollback and left alone
 *   on every other ending
 * @param onProgress called once per mailbox as it settles, so a rollback dialog can show this
 *   running
 * @returns what became of each mailbox, and whether every one of them converged cleanly
 * @private
 */
async function sweepRunMarkers(
  runId: CopyRunId,
  markers: MarkerLabel[],
  mode: 'strip' | 'trash',
  created: CreatedLabel[] = [],
  onProgress?: (done: number, total: number) => void,
): Promise<RollbackOutcome> {
  const deps = {
    token: mailboxToken,
    list: fetchMessageListPage,
    modify: batchModifyMessages,
    deleteLabel,
  };
  const outcome = await runSweep(runId, markers, mode, deps, onProgress);
  // After the mail, never before it: a label deleted while its messages still carry it takes
  // the marker off them too, and the sweep would then have nothing left to find them by.
  if (mode === 'trash' && created.length > 0) {
    const left = await deleteCreatedLabels(created, deps);
    if (left.length > 0) {
      notifyLog(`[maildrop] rollback: labels left behind — ${left.join(', ')}`);
    }
  }
  return outcome;
}

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
 * Pauses, resumes or stops the copy in flight
 *
 * A stop is answered by whichever of the two can still act on it. The run's own gate takes it
 * while the run is still deciding; once the run has settled its tally -- everything after
 * stopReachesRun turns false, which is the log and a marker sweep of up to five rounds -- the gate
 * is a no-op that used to be reported as a success, and the walk went on to pull the next batch.
 * The job carries the intent instead, and where there is no job either, this says so rather than
 * claiming a stop nothing will honour.
 *
 * @param action what the paused dialog asked for
 * @returns whether the action was taken, and by what
 */
export function controlCopyRun(action: MailDropCopyControlAction): MailDropCopyControlResult {
  const pausing = action === 'pause' || action === 'resume';
  // Pause and resume are the run's alone: between batches there is nothing to hold still, and the
  // panel treats their refusal as the non-event it is.
  if (activeRun && pausing) {
    if (action === 'pause') {
      activeRun.control.pause();
      sendPausedProgress();
    } else {
      activeRun.control.resume();
    }
    return { ok: true };
  }
  if (pausing) return { ok: false, error: 'Er wordt niet gekopieerd' };

  if (activeRun) {
    const reach = { decided: activeRun.decided, stopping: activeRun.control.stopMode() !== null };
    if (stopReachesRun(reach)) return stopTheRun(activeRun.control, action);
  }
  // No run that can still take it. Between two batches, and now also inside a batch whose tally is
  // already fixed, the panel's Annuleren is live for the whole job: the stop is remembered and the
  // driver honours it before the next batch goes out. What that batch landed stays where it is --
  // it cannot be swept once its own markers have been stripped -- so only the job-wide choice
  // reaches the batches that finished, exactly as it does between two batches.
  if (activeJob && jobDriving) {
    jobStopWanted = jobStopFromAction(action);
    return { ok: true };
  }
  return { ok: false, error: activeRun ? STOP_TOO_LATE_TEXT : 'Er wordt niet gekopieerd' };
}

/**
 * Hands a stop to the gate of the run in flight
 *
 * @param control the running gate
 * @param action the stop the dialog asked for
 * @returns what to tell the panel
 * @private
 */
function stopTheRun(
  control: CopyRunControl,
  action: MailDropCopyControlAction,
): MailDropCopyControlResult {
  switch (action) {
    case 'stop-keep':
      control.stop('keep');
      return { ok: true };
    case 'stop-rollback-batch':
      control.stop('rollback');
      return { ok: true };
    case 'stop-rollback-job':
      // The running batch is rolled back by the run's own stop, exactly as a plain drag is. The
      // batches already finished are a separate sweep, started once this run has drained --
      // running both at once would have two sweeps trashing under two markers in one mailbox.
      //
      // Only when this stop is the one that lands: once the gate is stopping its own stop() is a
      // no-op, and trashing the finished batches on the back of a stop that was already answered
      // as 'keep' would undo the mail the user asked to keep.
      if (control.stopMode() === null) rollbackWholeJob = true;
      control.stop('rollback');
      return { ok: true };
    default:
      return { ok: false, error: 'Onbekende actie' };
  }
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
 * Tells the modal how far a paused copy had got, per mailbox
 *
 * Read off the journal rather than off a running tally: every insert that landed is already
 * on disk the moment it answers (appendCopyJournalEntry), so counting those lines is the
 * same count a rollback would work from, and needs nothing kept in memory just for this.
 *
 * @private
 */
function sendPausedProgress(): void {
  if (!activeRun) return;
  const { runId, root, total, targets } = activeRun;
  const entries = readCopyJournal(root, runId)?.entries ?? [];
  const byMailbox = insertsPerMailbox(entries);
  dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
    phase: 'copy',
    done: entries.length,
    total,
    paused: true,
    byMailbox: [...byMailbox.entries()].map(([email, copied]) => ({ email, copied })),
    job: jobProgressForSend({ phase: 'copy', done: entries.length, targets }),
  } satisfies MailDropCopyProgress);
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
 * Runs in three modes. 'check' scans for messages already there and reports them rather than
 * copying; 'all' skips the scan; the default copies what the scan said was new.
 *
 * The mails of one mailbox go up alongside each other, the mailboxes themselves one after the
 * other: the progress bar names the mailbox it is working on, and that only stays true with one
 * at a time.
 *
 * A copy that is paused and then stopped ends in one of three ways: 'completed' when it was
 * never stopped at all, 'kept' when the user chose to leave what had already landed, or a
 * rollback outcome when they chose to undo it -- see copyOneFile and the tail of this function
 * for where each of those is decided.
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
 * Copies whatever the last drag saved into the chosen labels, in the chosen mailboxes -- the
 * engine itself, with no knowledge of any batched job
 *
 * Runs in three modes. 'check' scans for messages already there and reports them rather than
 * copying; 'all' skips the scan; the default copies what the scan said was new.
 *
 * The mails of one mailbox go up alongside each other, the mailboxes themselves one after the
 * other: the progress bar names the mailbox it is working on, and that only stays true with one
 * at a time.
 *
 * A copy that is paused and then stopped ends in one of three ways: 'completed' when it was
 * never stopped at all, 'kept' when the user chose to leave what had already landed, or a
 * rollback outcome when they chose to undo it -- see copyOneFile and the tail of this function
 * for where each of those is decided.
 *
 * @param arg
 * @returns {Promise<MailDropCopyResult|MailDropCopyWarnedResult|MailDropCopyStoppedResult>} what
 *   the picker draws: the counts, the duplicate question, or how the stop was settled
 * @private
 */
async function runCopyToMailboxes(arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
  fromJob?: boolean;
  retry?: { retryId: string; targets: MailDropCopyTarget[]; files: Map<string, SavedRef[]> };
  jobRetry?: boolean;
  /** Whether this copy belongs to a job in any way -- a walked batch, a job retry, or batch zero
   * while a job is being planned. Set only by copyToMailboxes; decides whether a plain-drag
   * retry offer is held for a failure here. */
  partOfJob?: boolean;
  /** Called once, before the duplicate check's own stop window. Set only by copyToMailboxes. */
  noteJobChoices?: (targets: MailDropCopyTarget[], mode: CopyMode) => void;
  /** Asked at the two moments a job-wide stop can still change this batch's own outcome before
   * its gate exists to take it. Set only by copyToMailboxes; consumes the stop once taken. */
  jobStop?: () => CopyStopMode | null;
  /** Called with this run's per-mailbox failures, when it is not a job retry's own copy. Set
   * only by copyToMailboxes, to fold them into the job's own losses when this batch belongs to
   * one. */
  onJobFailures?: (failuresByTarget: TargetFailures<MailDropCopyTarget, SavedRef>[]) => void;
  /** Called once the copy has settled, with the run's own id and what it could not land, only
   * by copyToMailboxes -- which is what decides what the run meant for any job it belonged to. */
  onBatchResult?: (
    result: MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult,
    runId: CopyRunId,
    failuresByTarget: TargetFailures<MailDropCopyTarget, SavedRef>[],
  ) => Promise<void> | void;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
  const cfg = oauthConfig();
  const retry = arg?.retry;
  // The drag this copy answers for: a drag made while it runs bumps dropSerial under it
  const serialAtStart = dropSerial;
  const requested = normalizeTargets(retry ? retry.targets : arg?.targets ?? []);
  const targets = requested.filter((t) => isAllowedAccount(t.email));
  const mode: CopyMode = arg?.mode ?? 'check';
  const fail = (error: string): MailDropCopyResult => ({
    ok: false,
    copied: 0,
    skipped: 0,
    total: 0,
    accounts: [],
    error,
  });
  // The same class from the other side: a stale Kopieer after this drag already went out. The
  // duplicate scan cannot refuse it for the reason above, so only knowing it was copied can.
  if (!retry && !arg?.fromJob && copiedSerial === dropSerial) {
    notifyLog('[maildrop] second copy refused: this drag has already been copied');
    return fail(ALREADY_COPIED_TEXT);
  }
  if (!cfg || !oauthTokens) return fail('Koppeling niet ingesteld');
  // Held in a const because the mailboxes now run inside a closure, where the module binding
  // could in principle have been cleared by the time a worker gets there.
  const tokens = oauthTokens;
  if (requested.length === 0) return fail('Geen label gekozen');
  if (targets.length === 0) return fail('Alleen postvakken van het werkdomein kunnen worden gekozen');
  const filesFor = (email: string): SavedRef[] => (retry ? retry.files.get(email) ?? [] : lastDropSaved);
  const files = retry ? [...new Set([...retry.files.values()].flat())] : lastDropSaved;
  if (files.length === 0) return fail('Geen opgeslagen berichten om te kopiëren');

  // Written down here rather than at the far end: this copy can be minutes of work, and the
  // picker asks for the list the next time it opens -- which may well be while this one is
  // still running. A copy that fails halfway is the one you most want offered back anyway.
  // A tree copy passes no label ids and is skipped inside remember: its labels do not exist
  // yet when it is asked for, so it has nothing to offer back.
  for (const target of targets) recentLabels?.remember(target.email, target.labelIds);

  // Planned before the scan below, and creating nothing yet: see planTrees.
  const trees = await planTrees(targets, files, lastDropTree);
  const treeResolved: ResolvedTreeLabels = new Map(trees.resolved);

  const total = retry
    ? targets.reduce((n, t) => n + filesFor(t.email).length, 0)
    : copyTotal(targets, files.length);
  const ts = new Date().toISOString();
  const root = mailDropFolder();
  const records: LogRecord[] = [];
  const accounts: MailDropCopyAccountResult[] = [];
  let done = 0;
  let copied = 0;
  let skipped = 0;
  // Inserts that landed, which is the one number the job line may speak. `done` is every file
  // this copy has finished with, whatever became of it, since that is what lets the bar reach
  // its own total. The job line and the paused line both count landings instead: counting
  // attempts against a journal of landings is what made the line fall the moment the user
  // pressed pause, 1535 to 1074 on a batch where no mail had moved.
  let landed = 0;
  // The mailboxes actually being written to. The job line divides inserts by this to reach
  // conversations, and the paused line divides the journal's entries by the same figure --
  // readyTargets, since a mailbox without a marker label is never inserted into. Dividing the
  // live line by every chosen mailbox instead made the two disagree, and the count jumped the
  // moment the user pressed pause. Starts at the chosen count because nothing has been
  // inserted yet while that is still all we know.
  let writingTo = targets.length;
  // No mailbox in here any more: both phases run several at once, so naming one of them was
  // going to be a lie. The count is over the whole copy.
  const progress = (phase: 'check' | 'copy', of = total) =>
    dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
      phase,
      done,
      total: of,
      // Two different counts on purpose: the bar takes every file this copy is through with,
      // the job line only the inserts that landed -- the same unit the paused line reads off the
      // journal. The phase and the mailbox count are what let jobProgress turn those into
      // conversations.
      job: jobProgressForSend({ phase, done: landed, targets: writingTo }),
    });

  let index = new Set<string>();
  if (mode !== 'all') {
    // Kept apart so a retry's narrowed hits never answer for the whole drag, nor the reverse
    const key = retry ? `retry:${retry.retryId}|${scanKey(targets)}` : scanKey(targets);
    const tally = { checks: 0, reused: 0, asked: 0 };
    const checkFrom = Date.now();
    // A retry's check always asks again: the stored scan was taken before the first copy landed
    if (retry && mode === 'check') setLastScan(null);
    const reusedWholeScan = lastScan?.key === key;
    const hits = reusedWholeScan
      ? lastScan!.hits
      : await findDuplicates(
          targets,
          files,
          (n, of) => {
            done = n;
            progress('check', of);
          },
          tally,
          treeResolved,
          !retry,
          retry ? (email, messageId) => filesFor(email).some((f) => f.messageId === messageId) : undefined,
        );
    notifyLog(
      `[maildrop] ${
        reusedWholeScan
          ? `duplicate check: skipped, same choice as the previous attempt`
          : checkLogLine({ ...tally, ms: Date.now() - checkFrom })
      }`,
    );
    setLastScan({ key, hits });
    done = 0;
    index = duplicateIndex(hits);
    if (mode === 'check' && hits.length > 0) {
      // Counted against every destination the plan is going to have rather than off the labels
      // that exist now: a mailbox whose tree is still to be created resolves to nothing at this
      // point, which credited it no new mail at all and understated what "kopieer toch" inserts
      // by that mailbox's entire share.
      const planned: ResolvedTreeLabels = new Map(treeResolved);
      for (const [email, plan] of trees.plans) {
        const ids = new Map(plan.reuse);
        // A stand-in for a label that does not exist yet: it holds nothing, so whatever is filed
        // under it is new by definition, and no real id in the duplicate index can match it.
        for (const name of plan.create) ids.set(name, `nog-te-maken:${name}`);
        planned.set(email, perMessageLabels(files, plan, ids));
      }
      return {
        ok: false,
        copied: 0,
        skipped: 0,
        total,
        accounts: [],
        needsConfirm: true,
        duplicates: groupDuplicates(hits),
        newCount: targets.reduce(
          (n, t) => n + newMessageCount(index, [t], filesFor(t.email).map((f) => f.messageId), planned),
          0,
        ),
      };
    }
  }

  arg.noteJobChoices?.(targets, mode);

  // The stop the user asked for while this batch was still being scanned for duplicates. There
  // is no gate to take it during 'check' -- activeRun is not set until the copy itself starts --
  // so it was recorded and then only looked at between batches, which meant watching the whole
  // batch copy after asking it to stop. Consumed here instead: before the marker labels, before
  // the journal, before a single insert, so nothing of this batch exists to answer for.
  const stop1 = arg.jobStop?.();
  if (stop1) {
    notifyLog('[maildrop] batch stopped during the duplicate check, nothing of it was sent');
    return {
      stopped: true,
      mode: stop1,
      copied: 0,
      byMailbox: [],
    } satisfies MailDropCopyStoppedResult;
  }

  // Minted here rather than reusing dropSerial: dropSerial names the drag, and a 'check' pass
  // followed by an 'all' pass against the same drag are two runs, each with its own inserts
  // to answer for if either one is stopped partway through.
  const runId: CopyRunId = randomUUID();
  const failuresByTarget: TargetFailures<MailDropCopyTarget, SavedRef>[] = [];

  // One hidden marker label per mailbox, created before a single file goes out to it. Its id
  // is folded into every insert this run makes to that mailbox (copyOneFile) -- never applied
  // by a follow-up call -- which is what later lets a sweep find everything this run created
  // by label membership, with nothing to infer. A mailbox whose marker cannot be created is
  // not written to at all: there is nothing safe to insert into it without one, so it is
  // reported exactly like a mailbox whose token could not be had.
  const markerName = markerLabelName(runId);
  type MarkerAttempt = { email: string; markerLabelId: string } | { email: string; error: string };
  const markerAttempts = await mapLimit(targets, MAILBOX_LIMIT, async (target): Promise<MarkerAttempt> => {
    const got = await mailboxToken(target.email);
    if (!got.ok) return { email: target.email, error: got.error };
    try {
      const created = await createHiddenLabel(got.token, markerName);
      return { email: target.email, markerLabelId: created.id };
    } catch (e) {
      return { email: target.email, error: (e as Error).message };
    }
  });
  const markers: MarkerLabel[] = [];
  const markerLabelByEmail = new Map<string, string>();
  for (const a of markerAttempts) {
    if ('markerLabelId' in a) {
      markers.push({ email: a.email, markerLabelId: a.markerLabelId });
      markerLabelByEmail.set(a.email, a.markerLabelId);
    } else {
      notifyLog(`[maildrop] copy ${a.email}: could not create an internal label — ${a.error}`);
      const lost = wholeTargetFailed(filesFor(a.email), a.error);
      accounts.push({
        email: a.email,
        copied: 0,
        skipped: 0,
        total: filesFor(a.email).length,
        error: a.error,
        failures: failureLines(lost),
      });
      failuresByTarget.push({ target: targets.find((t) => t.email === a.email)!, files: lost });
      done += filesFor(a.email).length;
      progress('copy');
    }
  }
  // A mailbox whose tree could not even be planned is reported and left alone, exactly like one
  // whose marker could not be made: there is nothing safe to insert into it either.
  for (const [email, error] of trees.errors) {
    if (!markerLabelByEmail.has(email)) continue;
    notifyLog(`[maildrop] copy ${email}: could not work out the label structure — ${error}`);
    const lost = wholeTargetFailed(filesFor(email), error);
    accounts.push({
      email,
      copied: 0,
      skipped: 0,
      total: filesFor(email).length,
      error,
      failures: failureLines(lost),
    });
    failuresByTarget.push({ target: targets.find((t) => t.email === email)!, files: lost });
    done += filesFor(email).length;
    progress('copy');
    markerLabelByEmail.delete(email);
  }
  const readyTargets = targets.filter((t) => markerLabelByEmail.has(t.email));
  // From here the two lines speak the same unit. Nothing has been inserted yet, so moving it
  // now cannot make the count jump.
  writingTo = readyTargets.length;

  // Alongside each other, because the quota that limits a copy is per user and every target is
  // a different user: three mailboxes have three times ten inserts a second between them where
  // one after the other had ten. What is left after that is the uplink, since there is no
  // server-side copy between accounts and the bytes go up once per mailbox regardless.
  // Worked out here rather than fixed: a copy into one mailbox gets the whole allowance and
  // reaches that mailbox's own ceiling of ten inserts a second, where a fixed split left it on
  // the same narrow limit as one of three.
  const groupLimit = perMailboxLimit(
    Math.min(readyTargets.length, MAILBOX_LIMIT),
    COPY_IN_FLIGHT,
    PER_MAILBOX_MAX,
  );
  // Shared across the mailboxes on purpose: the memory these uploads hold is one pool, however
  // many mailboxes are being written to.
  const budget = createUploadBudget(COPY_BYTES_IN_FLIGHT, COPY_IN_FLIGHT);
  const copyFrom = Date.now();

  const control = createCopyRunControl();
  // Declared out here because the copy closure below reads them, and filled by the label
  // creation inside the run's own try
  const createdLabels: CreatedLabel[] = [];
  const treeWarnings: string[] = [];
  const failedLabels = new Map<string, string[]>();

  const runCopy = async (): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> => {
    const perTarget = await mapLimit(
      readyTargets,
      MAILBOX_LIMIT,
      async (target) => {
        const tokenFrom = Date.now();
        const got = await mailboxToken(target.email);
        const tokenMs = Date.now() - tokenFrom;
        // Every attempted upload, so the line can show the spread. Held per mailbox rather
        // than logged per mail: notifyLog appends synchronously, and a label drag is
        // hundreds of mails.
        const inserts: number[] = [];
        if (!got.ok) {
          notifyLog(
            `[maildrop] copy ${target.email} (${
              isDelegatedMailbox(target.email) ? 'delegated' : 'own'
            }): no token after ${tokenMs}ms — ${got.error}`,
          );
          if (!isDelegatedMailbox(target.email)) markRefreshFailed(target.email);
          done += filesFor(target.email).length;
          progress('copy');
          const lost = wholeTargetFailed(filesFor(target.email), got.error);
          failuresByTarget.push({ target, files: lost });
          return {
            account: {
              email: target.email,
              copied: 0,
              skipped: 0,
              total: filesFor(target.email).length,
              error: got.error,
              failures: failureLines(lost),
            },
            records: [] as LogRecord[],
          };
        }
        const outcomes = await copyToMailbox({
          cfg,
          tokens,
          ts,
          target,
          token: got.token,
          files: filesFor(target.email),
          index,
          groupLimit,
          budget,
          runId,
          journalRoot: root,
          wait: control.wait,
          signal: control.signal(),
          resolved: treeResolved,
          markerLabelId: markerLabelByEmail.get(target.email)!,
          onInsert: (ms) => inserts.push(ms),
          onDone: (ok) => {
            done += 1;
            if (ok) landed += 1;
            progress('copy');
          },
        });

        // In the order of the drag rather than the order the uploads finished, so log.jsonl
        // and the error the strip shows read the same as when this ran one mail at a time.
        const mine: LogRecord[] = [];
        for (const outcome of outcomes) {
          if (outcome?.record) mine.push(outcome.record);
        }
        // Counted, not derived by subtraction: a file the gate refused and one a cancel
        // severed mid-flight are `stopped`, never `failed` -- see tallyOutcomes.
        const { copied: ok, skipped: over, failed, stopped, lastError } = tallyOutcomes(outcomes);
        const lost = failedFiles(filesFor(target.email), outcomes);
        failuresByTarget.push({ target, files: lost });
        notifyLog(
          `[maildrop] ${copyLogLine({
            email: target.email,
            delegated: isDelegatedMailbox(target.email),
            tokenMs,
            inserts,
            copied: ok,
            skipped: over,
            failed,
            stopped,
          })}`,
        );
        return {
          account: {
            email: target.email,
            copied: ok,
            skipped: over,
            total: filesFor(target.email).length,
            error: failed > 0 ? (lastError ?? 'Niet alles gekopieerd') : undefined,
            ...(lost.length > 0 ? { failures: failureLines(lost) } : {}),
          },
          records: mine,
        };
      },
      control.wait,
    );

    // In the order the mailboxes were picked rather than the order they finished: mapLimit
    // answers in input order, and assembleCopy keeps it that way, so log.jsonl and the report
    // read the same as they did when the mailboxes ran one at a time.
    const assembled = assembleCopy(perTarget);
    records.push(...assembled.records);
    // A label Gmail refused is named in the mailbox's own line rather than folded into the
    // warnings: the mail that would have gone there was not copied, and that is a property of
    // this mailbox, not of the run.
    accounts.push(
      ...assembled.accounts.map((a) => {
        const refused = failedLabels.get(a.email);
        if (!refused) return a;
        const said = `label niet aangemaakt: ${refused.join('; ')}`;
        return { ...a, error: a.error ? `${a.error} — ${said}` : said };
      }),
    );
    copied += assembled.copied;
    skipped += assembled.skipped;

    notifyLog(
      `[maildrop] copy done: ${copied} copied, ${skipped} skipped of ${total} ` +
        `into ${targets.length} mailbox(es) in ${((Date.now() - copyFrom) / 1000).toFixed(1)}s`,
    );

    // Written for a stopped run too: this is real mail that really landed, and the log must
    // say so whether or not the run was allowed to run to its own end. A failure here is not
    // swallowed any more -- this share has dropped an appended write before, and the run
    // must say so rather than quietly proceed as if nothing happened.
    const warnings: string[] = [...treeWarnings];
    const logError = attemptWrite(() => appendLog(root, records));
    if (logError) {
      const message = `logboek niet bijgeschreven: ${logError}`;
      warnings.push(message);
      notifyLog(`[maildrop] ${message}`);
    }

    // Marked before the read and not after it: from here the run's outcome is settled, and a stop
    // arriving during the sweep below cannot change it however long that sweep takes. Set on the
    // run rather than kept local, because the one who has to know is controlCopyRun.
    if (activeRun?.runId === runId) activeRun.decided = true;
    const stopMode = control.stopMode();
    if (!stopMode) {
      // Recorded before the sweep is even attempted: a normal, never-stopped finish still
      // resolves to 'keep' (strip the marker), and writing that down first is what lets a
      // crash mid-sweep resume silently instead of asking the keep-or-rollback question a
      // run that was never even paused has no business being asked.
      const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, 'keep'));
      if (decisionError) {
        notifyLog(`[maildrop] could not record the sweep decision: ${decisionError}`);
      }
      const swept = await sweepRunMarkers(runId, markers, 'strip');
      for (const m of swept.mailboxes) {
        if (!m.converged) warnings.push(sweepWarning(m, 'opruimen'));
      }
      if (settled(swept)) {
        // Left to fail rather than only warned: an unclosed journal is precisely how this
        // app recognises a run that died halfway, so a dropped write here would make a fully
        // successful copy indistinguishable from a crash -- and the next start would offer
        // to undo mail that never needed undoing. The copy itself still succeeded, so this
        // is reported as success regardless, with the failure carried in `warnings` instead
        // of lost the way it was before.
        const closeError = attemptWrite(() => finishCopyJournal(root, runId, 'completed'));
        if (closeError) {
          const message = `afronding niet vastgelegd: ${closeError}`;
          warnings.push(message);
          notifyLog(`[maildrop] ${message}`);
        }
      } else {
        // Deliberately left without a closing line: this is what makes resumeOrphanedCopyRuns
        // pick it up and finish the sweep at the next start, using the decision above rather
        // than asking again.
        notifyLog(`[maildrop] sweep of run ${runId} not complete yet, will be resumed`);
      }
      // A job's batch adds to what the job lost; a job retry hands its failures to retryFailedJob
      if (arg?.jobRetry) {
        lastRunFailures = failuresByTarget;
      } else if (!retry) {
        arg.onJobFailures?.(failuresByTarget);
      }
      const left = !arg?.partOfJob ? copyFailuresOf(failuresByTarget) : null;
      // Held only while its own drag is still the current one: a retry plans against that tree
      lastCopyFailures =
        left && serialAtStart === dropSerial ? { retryId: randomUUID(), serial: serialAtStart, targets: left } : null;
      return withWarnings(
        {
          ok: copied > 0 || skipped > 0,
          copied,
          skipped,
          total,
          accounts,
          ...(lastCopyFailures ? { retryId: lastCopyFailures.retryId } : {}),
        } satisfies MailDropCopyResult,
        warnings,
      );
    }

    lastCopyFailures = null;
    const byMailbox = accounts.map((a) => ({ email: a.email, copied: a.copied }));
    const decisionError = attemptWrite(() => recordCopyJournalDecision(root, runId, stopMode));
    if (decisionError) notifyLog(`[maildrop] could not record the sweep decision: ${decisionError}`);

    if (stopMode === 'keep') {
      // 'keep' means the user asked to keep the mail, not this app's own bookkeeping -- the
      // marker is stripped exactly as it would be on a normal finish.
      const swept = await sweepRunMarkers(runId, markers, 'strip');
      for (const m of swept.mailboxes) {
        if (!m.converged) warnings.push(sweepWarning(m, 'opruimen'));
      }
      if (!settled(swept)) {
        notifyLog(`[maildrop] sweep of run ${runId} not complete yet, will be resumed`);
        return {
          stopped: true,
          mode: 'keep',
          copied,
          byMailbox,
          ...(warnings.length > 0 ? { warnings } : {}),
        } satisfies MailDropCopyStoppedResult;
      }
      // Non-negotiable: this is the one write that tells a run the user chose to keep apart
      // from a crash. Left to surface rather than swallowed, so a share that drops the write
      // is reported as an error rather than trusted as a clean stop.
      const closeError = attemptWrite(() => finishCopyJournal(root, runId, 'kept'));
      if (closeError) {
        return {
          stopped: true,
          mode: 'keep',
          copied,
          byMailbox,
          error: `Gestopt, maar niet afgerond: ${closeError}`,
          ...(warnings.length > 0 ? { warnings } : {}),
        } satisfies MailDropCopyStoppedResult;
      }
      return {
        stopped: true,
        mode: 'keep',
        copied,
        byMailbox,
        ...(warnings.length > 0 ? { warnings } : {}),
      } satisfies MailDropCopyStoppedResult;
    }

    // stopMode === 'rollback': every message this run created, landed or merely severed mid-
    // flight, carries this mailbox's marker -- see copyOneFile. So undoing the run is exactly
    // the sweep that finds it: list the marker, trash whatever comes back, repeat until the
    // listing is empty. There is nothing left to reconcile by Message-ID; membership under
    // the marker already answers "is this ours" with certainty a search never could.
    const rollback = await sweepRunMarkers(runId, markers, 'trash', createdLabels, (rDone, rTotal) =>
      dropOverlay?.send(IPC.MAIL_DROP_COPY_PROGRESS, {
        phase: 'rollback',
        done: rDone,
        total: rTotal,
      } satisfies MailDropCopyProgress),
    );
    if (settled(rollback)) {
      const closeError = attemptWrite(() =>
        finishCopyJournal(
          root,
          runId,
          rollback.complete ? 'rolled-back' : 'rolled-back-partial',
          sweepRemainder(rollback),
        ),
      );
      if (closeError) {
        const message = `afronding van het ongedaan maken niet vastgelegd: ${closeError}`;
        warnings.push(message);
        notifyLog(`[maildrop] ${message}`);
      }
    } else {
      notifyLog(`[maildrop] rollback of run ${runId} not complete yet, will be resumed`);
    }
    return {
      stopped: true,
      mode: 'rollback',
      copied,
      byMailbox,
      rollback,
      ...(warnings.length > 0 ? { warnings } : {}),
    } satisfies MailDropCopyStoppedResult;
  };

  activeRun = { runId, control, root, total, targets: readyTargets.length, decided: false };
  try {
    // A stop asked for while the marker labels were being made, which is the one window between
    // the check above and the gate below. Handed to the gate rather than acted on here: stopping
    // a run is the gate's job, and every worker below asks it before it starts anything.
    const stop2 = arg.jobStop?.();
    if (stop2) control.stop(stop2);

    // The write that anchors the whole record, and the one this file used to make unguarded. No
    // journal means no insert may go out: the markers already minted are the only handle a later
    // sweep has on this run's mail, and findOrphanedRuns can never see a run whose file does not
    // exist. So the run is refused and its markers are swept off the mailboxes again.
    const journalError = attemptWrite(() =>
      startCopyJournal(root, runId, readyTargets.map((t) => t.email), Date.now(), markers),
    );
    if (journalError) {
      notifyLog(`[maildrop] copy refused: journal could not be started — ${journalError}`);
      const swept = await sweepRunMarkers(runId, markers, 'strip');
      for (const m of swept.mailboxes) {
        if (!m.converged) notifyLog(`[maildrop] ${sweepWarning(m, 'opruimen')}`);
      }
      return fail(`Niet gekopieerd: het rollback-journaal kon niet worden geschreven (${journalError})`);
    }
    // From here mail can land, so this drag must never be sent whole again
    if (readyTargets.length > 0) setCopiedSerial(serialAtStart);

    // After the journal exists, because every created label is written to it the moment it lands,
    // and after the markers, because an insert without one must stay impossible. Before the first
    // insert, because a message cannot be filed under a label that is not there yet.
    for (const target of readyTargets) {
      const plan = trees.plans.get(target.email);
      if (!plan) continue;
      const made = await createTreeLabels(root, runId, target.email, plan);
      createdLabels.push(...made.created);
      treeWarnings.push(...made.warnings);
      // Logged as well as carried: a driven batch's result is discarded by the walk, so for
      // every batch but the first this is the only place these warnings reach anybody.
      for (const warn of made.warnings) notifyLog(`[maildrop] copy ${target.email}: ${warn}`);
      if (made.failed.length > 0) failedLabels.set(target.email, made.failed);
      treeResolved.set(target.email, perMessageLabels(files, plan, made.ids));
      notifyLog(
        `[maildrop] copy ${target.email}: ${made.created.length} label(s) created, ${plan.reuse.size} reused${
          made.failed.length > 0 ? `, ${made.failed.length} failed` : ''
        }`,
      );
    }

    const result = await runCopy();
    await arg.onBatchResult?.(result, runId, failuresByTarget);
    return result;
  } finally {
    if (activeRun?.runId === runId) activeRun = null;
  }
}

/**
 * Copies the mail the last copy could not land, to exactly where it was going
 *
 * @param arg the id the panel was given, and the mode the duplicate screen answered with
 * @returns what copyToMailboxes answers
 */
export async function retryFailedCopy(arg: {
  retryId: string;
  mode?: CopyMode;
}): Promise<MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult> {
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastCopyFailures,
    serial: dropSerial,
    jobDriving,
    jobActive: activeJob !== null,
    pulling: activePull !== null,
    copying: activeRun !== null || retryInFlight,
  });
  if (refused || !lastCopyFailures) {
    return {
      ok: false,
      copied: 0,
      skipped: 0,
      total: 0,
      accounts: [],
      error: refused ?? 'Niets om opnieuw te proberen',
    };
  }
  const held = lastCopyFailures;
  notifyLog(`[maildrop] retry of ${held.targets.reduce((n, t) => n + t.files.length, 0)} failed copies`);
  retryInFlight = true;
  try {
    return await copyToMailboxes({
      targets: [],
      mode: arg.mode ?? 'check',
      retry: {
        retryId: held.retryId,
        targets: held.targets.map((t) => t.target),
        files: new Map(held.targets.map((t) => [t.target.email, t.files.map((f) => f.file)])),
      },
    });
  } catch (e) {
    // Some of these may have landed before the throw, and the scan cannot see fresh inserts
    if (lastCopyFailures === held) lastCopyFailures = null;
    throw e;
  } finally {
    retryInFlight = false;
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
  retryInFlight = true;
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
    lastRunFailures = null;
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
    lastRunFailures = null;
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
    retryInFlight = false;
  }
}


//===========================
// Orphaned runs
//===========================

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
 * The job the user has to make a continue-or-undo decision about, if any
 *
 * Asked by the mail-drop window when it opens, the same moment it already asks for the orphan
 * decision and the existing-mail scan.
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
 * How many of a run's journal entries landed in each mailbox
 *
 * @param entries the journal's insert lines
 * @returns {Map<string, number>} per mailbox its own count
 * @private
 */
function insertsPerMailbox(entries: CopyJournalEntry[]): Map<string, number> {
  const byMailbox = new Map<string, number>();
  for (const e of entries) byMailbox.set(e.email, (byMailbox.get(e.email) ?? 0) + 1);
  return byMailbox;
}

/**
 * The mailboxes a sweep left unconfirmed, as the journal records them
 *
 * @param outcome what the sweep came to
 * @returns {CopyJournalRemainder[]} one entry per mailbox that did not converge
 * @private
 */
function sweepRemainder(outcome: RollbackOutcome): CopyJournalRemainder[] {
  return outcome.mailboxes
    .filter((m) => !m.converged || m.refused)
    .map((m) => ({ email: m.email, reason: m.reason ?? m.refused ?? 'niet geconvergeerd' }));
}

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

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
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
 * @param running the current batch's live insert count and mailbox count, when copying
 * @returns the job's progress, or undefined when this is a plain drag -- which is what makes the
 *   picker draw exactly the line it drew before jobs existed
 * @private
 */
function jobProgressForSend(running?: RunningBatchProgress): MailDropCopyProgress['job'] {
  return activeJob ? jobProgress(activeJob.job, running) : undefined;
}

/**
 * The warning line for a mailbox whose sweep did not converge
 *
 * Framed as resumable, not as doubtful: unlike the old Message-ID reconciliation this
 * replaces, there is no ambiguity left to report here -- only a sweep that has not finished
 * yet, which the next start's resumed sweep will pick up on its own.
 *
 * @param m
 * @param verb the Dutch verb for what did not finish -- 'opruimen' or 'ongedaan maken'
 * @returns the line, for `warnings`
 * @private
 */
function sweepWarning(m: RollbackOutcome['mailboxes'][number], verb: string): string {
  const why = m.refused === 'permission'
    ? 'geen rechten'
    : m.refused === 'auth'
      ? 'kon niet worden geopend'
      : m.reason ?? 'nog niet bevestigd';
  return `${m.email}: ${verb} niet afgerond (${why}), wordt bij de volgende start opnieuw geprobeerd`;
}

/**
 * Whether every mailbox in a sweep has reached a terminal state
 *
 * Not the same question as `complete`: a mailbox that refused outright is terminal -- retrying
 * will not fix a permission problem -- while one that merely has not converged yet is not, and
 * must be left open for the next resumed sweep rather than closed as if it were done. Only
 * when every mailbox is one or the other does this run's journal get its closing line.
 *
 * @param outcome
 * @returns true once nothing here would change by sweeping again right now
 * @private
 */
function settled(outcome: RollbackOutcome): boolean {
  return outcome.mailboxes.every((m) => m.converged || m.refused);
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
    lastCopyFailures = null;
  },
  previewExtra: () => ({
    jobEnd: lastJobFailures && lastJobEnd ? lastJobEnd : null,
    panel: jobPanelInfo(),
    job: activeJob ? jobProgress(activeJob.job) : undefined,
  }),
});

