// Copying whatever the last drag saved into chosen mailboxes: the duplicate check, the marker
// labels, the upload itself with its journal/sweep tail, and pause/resume/stop of the run that is
// doing it.
//
// Runs as a job's own batch too, driven one batch at a time by mail-drop-controller.ts's walk --
// but knows nothing about that itself. runCopyToMailboxes takes every bit of job-only behaviour
// (noting the choices batch zero made, honouring a job-wide stop, folding this batch's losses
// into what the job has lost, recording what the batch came to) as plain callbacks; copyToMailboxes,
// the job-aware wrapper the driver calls, stays in mail-drop-controller.ts and supplies them. What
// this file cannot answer about a job on its own -- its own progress line, and a stop the picker's
// dialog asks for while no run of this file's own is left to take it -- comes back through
// CopyJobHooks, wired once at that file's module scope, the same way pull-controller.ts's
// JobDriverHooks does for the pull.

import { randomUUID } from 'node:crypto';
import { IPC } from '../../core/ipc';
import type {
  MailDropCopyAccountResult,
  MailDropCopyControlAction,
  MailDropCopyControlResult,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
} from '../../core/ipc';
import { dropOverlay, oauthTokens, recentLabels } from '../../core/runtime';
import { createUploadBudget, mapLimit } from '../../core/concurrency';
import { oauthConfig } from '../../auth/oauth-config';
import { isAllowedAccount } from '../../auth/account-domain';
import { markRefreshFailed } from '../../auth/oauth-health-check';
import { isDelegatedMailbox, mailboxToken } from '../../auth/mailbox-token';
import { notifyLog } from '../../notify/notify-log';
import { appendLog, type LogRecord } from '../pull/mail-archive';
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
} from './mail-copy';
import { STOP_TOO_LATE_TEXT, jobStopFromAction, stopReachesRun } from '../job/job-guard';
import type { RunningBatchProgress } from '../job/label-job';
import { createCopyRunControl, type CopyRunControl } from './copy-control';
import {
  ALREADY_COPIED_TEXT,
  copyFailuresOf,
  failedFiles,
  failureLines,
  wholeTargetFailed,
  type TargetFailures,
} from './copy-failures';
import {
  attemptWrite,
  finishCopyJournal,
  readCopyJournal,
  recordCopyJournalDecision,
  startCopyJournal,
  withWarnings,
  type CopyJournalRemainder,
} from './copy-journal';
import { deleteCreatedLabels, sweepRunMarkers as runSweep } from './copy-marker-run-sweep';
import type {
  CopyJournalEntry,
  CopyRunId,
  CopyStopMode,
  CreatedLabel,
  MarkerLabel,
  RollbackOutcome,
} from './copy-run-types';
import {
  batchModifyMessages,
  createHiddenLabel,
  deleteLabel,
  fetchMessageListPage,
  markerLabelName,
} from '../../gmail/gmail-api';
import {
  copiedSerial,
  dropSerial,
  lastDropSaved,
  lastDropTree,
  setCopiedSerial,
  type SavedRef,
} from '../drop-state';
import { copyToMailbox } from './upload';
import { createTreeLabels, MAILBOX_LIMIT, perMessageLabels, planTrees } from './tree-setup';
import { findDuplicates, lastScan, setLastScan } from './duplicate-scan';
import { setLastCopyFailures, setLastRunFailures } from './copy-retry';
import { jobDriverStatus, mailDropFolder } from '../pull/pull-controller';


//===========================
// Types
//===========================

/** What the job driver in mail-drop-controller.ts answers for while a batch of its own may be
 * running here, or while its own stop dialog reaches a job with no run left to take it. Wired
 * once, for the same reason pull-controller.ts's own JobDriverHooks is: this file must never
 * import the driver above it. Everything else the driver answers for is already read-only and
 * shared with the pull through jobDriverStatus(). */
export interface CopyJobHooks {
  /** Sets the job-wide stop the driver honours before its next batch, when the picker's own stop
   * dialog reaches a job with no run in flight for the gate to take it */
  requestJobStop(mode: 'keep' | 'rollback'): void;
  /** The running job's own progress line, for the strip that draws above one batch's bar --
   * undefined outside a walked job, which is what keeps a plain drag's line exactly as it always
   * was */
  jobProgressFor(running?: RunningBatchProgress): MailDropCopyProgress['job'];
}


//===========================
// Constants
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


//===========================
// Module state
//===========================

/** The copy in flight right now, if any -- so a pause or stop asked for over IPC can reach
 * the loop that is actually running. `total` is carried here too, not recomputed, since a
 * paused progress line needs the same number the running one showed. */
export let activeRun: {
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

let jobHooks: CopyJobHooks = {
  requestJobStop: () => {},
  jobProgressFor: () => undefined,
};


//===========================
// Exported functions
//===========================

export function setCopyJobHooks(h: CopyJobHooks): void {
  jobHooks = h;
}

/**
 * Sweeps every mailbox's own marker for one run, wiring the real Gmail calls into
 * copy-marker-run-sweep.ts's own sweepRunMarkers
 *
 * The strip-vs-trash logic and the "acts on the listing, not on any local record" property it
 * gives a rollback both live there instead of here, purely so they can be unit tested: this
 * file pulls in Electron's `app` at module load (core/paths.ts, by way of pull-controller.ts's
 * mailDropFolder), so nothing importing it can ever run under a test.
 *
 * Exported for mail-drop-controller.ts's own rollbackFinishedBatches, and for
 * copy/orphan-runs.ts, which sweeps a run this app never heard the end of the same way.
 *
 * @param runId
 * @param markers this run's own marker per mailbox, from its journal header
 * @param mode 'strip' for a clean finish or a stop-keep, 'trash' for a stop-rollback
 * @param created the labels this run made itself, deleted again on a rollback and left alone
 *   on every other ending
 * @param onProgress called once per mailbox as it settles, so a rollback dialog can show this
 *   running
 * @returns what became of each mailbox, and whether every one of them converged cleanly
 */
export async function sweepRunMarkers(
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
  const { active, driving } = jobDriverStatus();
  if (active && driving) {
    jobHooks.requestJobStop(jobStopFromAction(action));
    return { ok: true };
  }
  return { ok: false, error: activeRun ? STOP_TOO_LATE_TEXT : 'Er wordt niet gekopieerd' };
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
 * rollback outcome when they chose to undo it -- see copyOneFile (copy/upload.ts) and the tail
 * of this function for where each of those is decided.
 *
 * Exported for mail-drop-controller.ts's job-aware copyToMailboxes, the only caller: that wrapper
 * adds the re-entrancy guard against a job's own walk, and the callbacks below, which are no-ops
 * outside a job.
 *
 * @param arg
 * @returns {Promise<MailDropCopyResult|MailDropCopyWarnedResult|MailDropCopyStoppedResult>} what
 *   the picker draws: the counts, the duplicate question, or how the stop was settled
 */
export async function runCopyToMailboxes(arg: {
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
      job: jobHooks.jobProgressFor({ phase, done: landed, targets: writingTo }),
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
        setLastRunFailures(failuresByTarget);
      } else if (!retry) {
        arg.onJobFailures?.(failuresByTarget);
      }
      const left = !arg?.partOfJob ? copyFailuresOf(failuresByTarget) : null;
      // Held only while its own drag is still the current one: a retry plans against that tree
      const held =
        left && serialAtStart === dropSerial ? { retryId: randomUUID(), serial: serialAtStart, targets: left } : null;
      setLastCopyFailures(held);
      return withWarnings(
        {
          ok: copied > 0 || skipped > 0,
          copied,
          skipped,
          total,
          accounts,
          ...(held ? { retryId: held.retryId } : {}),
        } satisfies MailDropCopyResult,
        warnings,
      );
    }

    setLastCopyFailures(null);
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


//===========================
// Helper functions
//===========================

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
      if (control.stopMode() === null) jobHooks.requestJobStop('rollback');
      control.stop('rollback');
      return { ok: true };
    default:
      return { ok: false, error: 'Onbekende actie' };
  }
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
    job: jobHooks.jobProgressFor({ phase: 'copy', done: entries.length, targets }),
  } satisfies MailDropCopyProgress);
}

/**
 * How many of a run's journal entries landed in each mailbox
 *
 * Exported for copy/orphan-runs.ts's own pendingOrphanDecision, which asks the same question of
 * a run this app never heard the end of.
 *
 * @param entries the journal's insert lines
 * @returns {Map<string, number>} per mailbox its own count
 */
export function insertsPerMailbox(entries: CopyJournalEntry[]): Map<string, number> {
  const byMailbox = new Map<string, number>();
  for (const e of entries) byMailbox.set(e.email, (byMailbox.get(e.email) ?? 0) + 1);
  return byMailbox;
}

/**
 * The mailboxes a sweep left unconfirmed, as the journal records them
 *
 * Exported for copy/orphan-runs.ts's own finishOrphanRun, which closes the journal of a rollback
 * the same way.
 *
 * @param outcome what the sweep came to
 * @returns {CopyJournalRemainder[]} one entry per mailbox that did not converge
 */
export function sweepRemainder(outcome: RollbackOutcome): CopyJournalRemainder[] {
  return outcome.mailboxes
    .filter((m) => !m.converged || m.refused)
    .map((m) => ({ email: m.email, reason: m.reason ?? m.refused ?? 'niet geconvergeerd' }));
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
 * Exported for mail-drop-controller.ts's own rollbackFinishedBatches, and for
 * copy/orphan-runs.ts's finishOrphanRun.
 *
 * @param outcome
 * @returns true once nothing here would change by sweeping again right now
 */
export function settled(outcome: RollbackOutcome): boolean {
  return outcome.mailboxes.every((m) => m.converged || m.refused);
}

function scanKey(targets: MailDropCopyTarget[]): string {
  return `${dropSerial}|${JSON.stringify(targets)}`;
}
