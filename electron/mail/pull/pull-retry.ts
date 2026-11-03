// Fetching again exactly what a pull could not, so a few failed conversations are not a reason
// to drag the whole label or the whole selection a second time.
//
// Shares pull-controller.ts's own lock, reporter and failure memory: a retry is the same pull
// as the first attempt, narrowed to the rows that lost, and rememberPullFailures is what turns
// its own leftovers into the next retry's offer.

import { mapLimit } from '../../core/concurrency';
import type { MailDropPreviewItem } from '../../core/ipc';
import { manager } from '../../core/runtime';
import { notifyLog } from '../../notify/notify-log';
import { replaceRows } from '../../../renderer/lib/failure-list';
import { ALREADY_COPIED_TEXT, retryRefusal } from '../copy/copy-failures';
import { BUSY_TEXT, dropOutcome } from '../drag/dropzone';
import { resetExistingScan, setLastScan, startExistingScan } from '../copy/duplicate-scan';
import {
  activePull,
  copiedSerial,
  dropSerial,
  lastDropPreview,
  lastDropSaved,
  setLastDropPreview,
  setLastDropSaved,
  type SavedRef,
} from '../drop-state';
import { fetchThreadSlice, saveOneThread, writeCollected, type ThreadReadCache } from './pull-collect';
import {
  DRAG_THREAD_LIMIT,
  jobDriverStatus,
  lastPullFailures,
  mailDropFolder,
  pullReporter,
  rememberPullFailures,
  withPullLock,
  type PullFailureHeld,
} from './pull-controller';


//===========================
// Exported functions
//===========================

/**
 * Fetches the conversations the last pull could not, and adds them to the drag
 *
 * @param arg the id the panel was given
 * @returns the preview rows with the retried ones in place, and a new id for what still failed
 */
export async function retryFailedPull(arg: {
  retryId: string;
}): Promise<{ ok: true; items: MailDropPreviewItem[]; pullRetryId?: string } | { ok: false; error: string }> {
  const { driving, active, copying } = jobDriverStatus();
  const refused = retryRefusal({
    wanted: arg?.retryId ?? '',
    held: lastPullFailures,
    serial: dropSerial,
    jobDriving: driving,
    jobActive: active,
    pulling: activePull !== null,
    copying,
  });
  if (refused || !lastPullFailures) return { ok: false, error: refused ?? 'Niets om opnieuw op te halen' };
  // The picker this retry returns to would offer Kopieer for the whole drag again
  if (copiedSerial === dropSerial) return { ok: false, error: ALREADY_COPIED_TEXT };
  const held = lastPullFailures;
  const ts = new Date().toISOString();
  const root = mailDropFolder();
  let next: MailDropPreviewItem[] = [];
  let added: SavedRef[] = [];
  let cancelled = false;
  let logWarning: MailDropPreviewItem | null = null;

  // No await between the refusal and the lock: a second press is refused by one or the other
  const ran = await withPullLock(held.acctKey, async () => {
    // This retry's own gate: a stale hold can hand activePull to the next drag mid-retry
    const mine = activePull;
    const report = pullReporter();
    if (held.from.kind === 'drag') {
      const cache: ThreadReadCache = new Map();
      const rows = held.from.rows;
      let pulled = 0;
      report(0, rows.length);
      const results = await mapLimit(
        rows,
        DRAG_THREAD_LIMIT,
        async (row) => {
          const one = await saveOneThread(
            ts,
            held.account,
            root,
            row.threadId,
            held.authuser,
            held.ik,
            row.message ?? null,
            row.messageUnknown ?? false,
            cache,
          );
          pulled += 1;
          report(pulled, rows.length);
          return one;
        },
        mine?.wait,
      );
      if (mine?.stopped()) {
        cancelled = true;
        return;
      }
      next = rows.map((row, i) => ({ ...row, saved: results[i]?.count ?? 0, error: results[i]?.error }));
      added = results.flatMap((r) => r?.saved ?? []);
      return;
    }
    const fetched = await fetchThreadSlice(held.account, held.from.threads, report);
    // A stop leaves holes that fetchThreadSlice drops, so the rows would no longer line up
    if (mine?.stopped()) {
      cancelled = true;
      return;
    }
    if (fetched === null) {
      next = held.from.threads.map((t) => ({
        threadId: t.threadId,
        subject: t.subject,
        saved: 0,
        error: 'Geen toegang tot dit postvak',
      }));
      return;
    }
    // No change to lastDropTree: memberCounts already counted these, failed or not
    const written = await writeCollected(ts, held.account, root, held.from.label, fetched, []);
    next = written.items;
    added = written.saved;
    // The same row the first pull shows; without a conversation it is never offered again
    if (written.logError) {
      logWarning = {
        threadId: '',
        subject: 'Niet in het logboek gezet',
        saved: 0,
        error: `Logboek niet bijgeschreven: ${written.logError}`,
      };
    }
  });
  if (!ran) return { ok: false, error: BUSY_TEXT };
  if (cancelled) return { ok: false, error: 'Opnieuw ophalen geannuleerd' };
  // A long retry can outlive the lock, and the drag that took over must not receive its files
  if (dropSerial !== held.serial || lastPullFailures !== held) {
    notifyLog('[maildrop] retry fetch discarded: another drag took its place');
    return { ok: false, error: 'Deze lijst is verlopen. Sleep de mail opnieuw.' };
  }

  setLastDropSaved([...lastDropSaved, ...added]);
  const items = [...replaceRows(lastDropPreview, held.at, next), ...(logWarning ? [logWarning] : [])];
  setLastDropPreview(items);
  setLastScan(null);
  // startExistingScan skips a drag it already scanned, and this one now has more files
  resetExistingScan();
  startExistingScan();
  const rows = items.slice(0, held.rowCount).map((i) => i.saved);
  manager?.sendDropResult(held.acctKey, dropOutcome(rows, items.find((i) => i.error)?.error));
  const pullRetryId = rememberPullFailures(items, {
    acctKey: held.acctKey,
    account: held.account,
    authuser: held.authuser,
    ik: held.ik,
    rowCount: held.rowCount,
    from: (at) => stillFailing(held.from, held.at, at),
  });
  notifyLog(`[maildrop] retry fetched ${added.length} of ${held.at.length} failed conversation(s)`);
  return { ok: true, items, ...(pullRetryId ? { pullRetryId } : {}) };
}


//===========================
// Helper functions
//===========================

/**
 * The part of a held retry that failed again
 *
 * Every position still failing is one of the positions retried, since the other rows already
 * had mail, so each maps back to its own entry in the held list.
 *
 * @param from what the retry fetched, one entry per position in `tried`
 * @param tried the positions the retry fetched
 * @param still the positions that failed again
 * @returns the same kind of source, narrowed to `still`
 */
function stillFailing(
  from: PullFailureHeld['from'],
  tried: number[],
  still: number[],
): PullFailureHeld['from'] {
  const slots = still.map((i) => tried.indexOf(i)).filter((slot) => slot >= 0);
  if (from.kind === 'drag') return { kind: 'drag', rows: slots.map((slot) => from.rows[slot]) };
  return { kind: 'label', label: from.label, threads: slots.map((slot) => from.threads[slot]) };
}
