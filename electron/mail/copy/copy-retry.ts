// Copying the mail the last plain-drag copy could not land, to exactly where it was going.
//
// Shares copy-run.ts's own engine: a retry is the same copyToMailboxes a fresh Kopieer press
// is, narrowed to the files that failed, which is what lets the journal, the marker, pause/
// cancel/rollback, quota and the job guard all apply unchanged. copyToMailboxes itself stays
// in mail-drop-controller.ts -- the job-aware wrapper that decides whether a job owns these
// files right now -- so this file reaches it through a hook rather than importing the module
// above it, the same reason pull-retry.ts reaches the job driver through jobDriverStatus().

import type {
  MailDropCopyResult,
  MailDropCopyStoppedResult,
  MailDropCopyTarget,
  MailDropCopyWarnedResult,
} from '../../core/ipc';
import { notifyLog } from '../../notify/notify-log';
import { type CopyMode } from './mail-copy';
import { retryRefusal, type TargetFailures } from './copy-failures';
import { activePull, dropSerial, type SavedRef } from '../drop-state';
import { jobDriverStatus } from '../pull/pull-controller';


//===========================
// Types
//===========================

type CopyAnswer = MailDropCopyResult | MailDropCopyWarnedResult | MailDropCopyStoppedResult;

/** The job-aware entry point in mail-drop-controller.ts, wired once so this file never imports
 * the module above it. A retry is, to copyToMailboxes, an ordinary copy narrowed to a `retry`
 * file set -- the same re-entrancy guard and job bookkeeping apply. */
type CopyEntryPoint = (arg: {
  targets: MailDropCopyTarget[];
  mode?: CopyMode;
  retry?: { retryId: string; targets: MailDropCopyTarget[]; files: Map<string, SavedRef[]> };
}) => Promise<CopyAnswer>;


//===========================
// Module state
//===========================

/** What the last copy could not land, held for the panel's retry button. Only for a copy the
 * picker ran itself: a job's batches are part 2, held in mail-drop-controller.ts's own
 * lastJobFailures instead. */
export let lastCopyFailures:
  | { retryId: string; serial: number; targets: TargetFailures<MailDropCopyTarget, SavedRef>[] }
  | null = null;

/** A job retry's copy failures, left by the tail of copy-run.ts's runCopyToMailboxes for
 * mail-drop-controller.ts's own retryFailedJob to take */
export let lastRunFailures: TargetFailures<MailDropCopyTarget, SavedRef>[] | null = null;

/** Set while a retry is under way, which copy-run.ts's own activeRun only covers once the copy
 * itself starts */
export let retryInFlight = false;

let copyEntry: CopyEntryPoint = async () => ({
  ok: false,
  copied: 0,
  skipped: 0,
  total: 0,
  accounts: [],
  error: 'maildrop: copy entry point not wired',
});


//===========================
// Exported functions
//===========================

export function setLastCopyFailures(v: typeof lastCopyFailures): void {
  lastCopyFailures = v;
}

export function setLastRunFailures(v: typeof lastRunFailures): void {
  lastRunFailures = v;
}

export function setCopyEntryPoint(fn: CopyEntryPoint): void {
  copyEntry = fn;
}

export function setRetryInFlight(v: boolean): void {
  retryInFlight = v;
}

/**
 * Fetches the mail the last copy could not land, to exactly where it was going
 *
 * @param arg the id the panel was given, and the mode the duplicate screen answered with
 * @returns what copyToMailboxes answers
 */
export async function retryFailedCopy(arg: {
  retryId: string;
  mode?: CopyMode;
}): Promise<CopyAnswer> {
  const { driving, active, copying } = jobDriverStatus();
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastCopyFailures,
    serial: dropSerial,
    jobDriving: driving,
    jobActive: active,
    pulling: activePull !== null,
    copying,
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
    return await copyEntry({
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
