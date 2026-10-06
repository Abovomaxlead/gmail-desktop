// Uploading the saved files into one mailbox, one file at a time underneath a shared budget.

import { readFile, stat } from 'node:fs/promises';
import type { MailDropCopyTarget } from '../../core/ipc';
import { messageIndex } from '../../core/runtime';
import { mapLimit, type UploadBudget } from '../../core/concurrency';
import { clearRefreshFailure, markRefreshFailed } from '../../auth/oauth-health-check';
import { forceRefresh } from '../../auth/oauth-flow';
import type { OAuthConfig } from '../../auth/google-oauth';
import type { OAuthStore } from '../../auth/oauth-store';
import { notifyLog } from '../../notify/notify-log';
import {
  GmailCancelledError,
  GmailHttpError,
  insertMayHaveLanded,
  insertMessage,
} from '../../gmail/gmail-api';
import {
  insertLabelIds,
  labelsForMessage,
  labelsStillNeeded,
  runThreadGroup,
  threadGroups,
  type CopyOutcomeKind,
  type ResolvedTreeLabels,
} from './mail-copy';
import { recordCopyJournalEntry } from './copy-journal';
import type { CopyRunId } from './copy-run-types';
import { remember } from './message-index';
import type { LogRecord } from '../pull/mail-archive';
import type { SavedRef } from '../drop-state';


//===========================
// Types
//===========================

/** What copying one file to one mailbox came to. Kept per file rather than appended as it
 * happens, so log.jsonl reads in the order of the drag and not in the order the uploads
 * finished. */
export interface CopyOutcome {
  /** Which of the four things became of this file. 'stopped' is the run ending rather than the
   * file failing, which is why it is a name here and not the absence of the other three. */
  kind: CopyOutcomeKind;
  /** The message of a 'failed' file, and of nothing else */
  error?: string;
  maybeLanded?: boolean;
  record?: LogRecord;
}


//===========================
// Exported functions
//===========================

/**
 * Copies the saved files into one mailbox
 *
 * @param arg
 * @returns {Promise<CopyOutcome[]>} one entry per file, in the order of the drag
 */
export async function copyToMailbox(arg: {
  cfg: OAuthConfig;
  tokens: OAuthStore;
  ts: string;
  target: MailDropCopyTarget;
  token: string;
  files: SavedRef[];
  index: Set<string>;
  /** How many uploads this mailbox may have going, shared out by perMailboxLimit */
  groupLimit: number;
  /** Room to upload, by size, shared with the other mailboxes of this copy */
  budget: UploadBudget;
  /** Identifies the journal a successful insert here is recorded in */
  runId: CopyRunId;
  journalRoot: string;
  /** Checked before each new conversation starts; copyOneFile checks it again per file */
  wait: () => Promise<'continue' | 'stop'>;
  /** Aborted the moment the run is told to stop, to sever whatever is already on the wire */
  signal: AbortSignal;
  /** Per mailbox, per Message-ID the labels a dragged tree resolved to. Empty for a flat
   * drag, where the labels are the target's own ticked ones. */
  resolved: ResolvedTreeLabels;
  /** This mailbox's own marker label for this run, created before the first file went out to
   * it. Folded into every insert's own labelIds -- see copyOneFile -- never applied after the
   * fact, so a severed insert can never land without it. */
  markerLabelId: string;
  /** The milliseconds one upload took, for the log */
  onInsert?: (ms: number) => void;
  /** Called once for every file this mailbox is through with, saying whether an insert landed.
   * The bar counts every call; the job line counts only the landings. */
  onDone: (landed: boolean) => void;
}): Promise<CopyOutcome[]> {
  const { cfg, tokens, ts, target, files, index, onDone } = arg;
  const outcomes = new Array<CopyOutcome>(files.length);
  let token = arg.token;

  // One refresh per mailbox however many uploads ran into the 401 together: each of them
  // asking for a fresh token would trade the expired one in four times over, and the later
  // answers would invalidate the token the earlier uploads just got.
  let refreshing: Promise<string | null> | null = null;
  const freshToken = async (used: string): Promise<string | null> => {
    if (token !== used) return token;
    refreshing ??= (async () => {
      const fresh = await forceRefresh(cfg, tokens, target.email);
      if (fresh) {
        token = fresh;
        clearRefreshFailure(target.email);
      } else {
        markRefreshFailed(target.email);
      }
      return fresh;
    })().finally(() => {
      refreshing = null;
    });
    return await refreshing;
  };

  await mapLimit(
    threadGroups(files),
    arg.groupLimit,
    async (group) =>
      runThreadGroup(
        group,
        async ({ ref, index: at }: { ref: SavedRef; index: number }, landedIn?: string) => {
          const { outcome, threadId, uploadMs } = await copyOneFile({
            ts,
            target,
            ref,
            index,
            landedIn,
            token: () => token,
            freshToken,
            budget: arg.budget,
            runId: arg.runId,
            journalRoot: arg.journalRoot,
            wait: arg.wait,
            signal: arg.signal,
            resolved: arg.resolved,
            markerLabelId: arg.markerLabelId,
          });
          // Only the upload itself. Timing the whole call would fold the wait for room into
          // the figure the diagnosis rests on, and make a copy look slower per mail the wider
          // it runs.
          if (uploadMs !== undefined) arg.onInsert?.(uploadMs);
          outcomes[at] = outcome;
          onDone(outcome.kind === 'copied');
          return { threadId: threadId ?? undefined };
        },
        arg.groupLimit,
      ),
    arg.wait,
  );
  return outcomes;
}

/**
 * Copies one saved file into one mailbox
 *
 * @param arg
 * @returns {Promise<{outcome: CopyOutcome, threadId?: string}>} the thread it landed in, for
 *   the rest of its conversation to be filed under
 */
export async function copyOneFile(arg: {
  ts: string;
  target: MailDropCopyTarget;
  ref: SavedRef;
  index: Set<string>;
  landedIn?: string;
  token: () => string;
  freshToken: (used: string) => Promise<string | null>;
  budget: UploadBudget;
  runId: CopyRunId;
  journalRoot: string;
  wait: () => Promise<'continue' | 'stop'>;
  signal: AbortSignal;
  /** Per mailbox, per Message-ID the labels a dragged tree resolved to. Empty for a flat
   * drag, where the labels are the target's own ticked ones. */
  resolved: ResolvedTreeLabels;
  markerLabelId: string;
}): Promise<{ outcome: CopyOutcome; threadId?: string; uploadMs?: number }> {
  const { ts, target, ref, index, landedIn } = arg;
  const { file, messageId } = ref;

  const wanted = labelsForMessage(target, messageId, arg.resolved);
  const labelIds = labelsStillNeeded(index, target.email, wanted, messageId);
  if (labelIds.length === 0) return { outcome: { kind: 'skipped' } };

  // Checked before the budget is ever asked for room: a file paused here has reserved
  // nothing, so it costs the mailboxes still running nothing either. Checking after
  // budget.run had already claimed had started would hold that room hostage for as long as
  // the pause lasts.
  if ((await arg.wait()) === 'stop') return { outcome: { kind: 'stopped' } };

  // Asked before the file is read, so the room is reserved before the memory is taken rather
  // than after
  let size = 0;
  try {
    size = (await stat(file)).size;
  } catch {
    // A file whose size cannot be read reserves nothing and takes its chances: refusing to copy
    // a mail over a failed stat is worse than uploading it outside the budget
  }

  return await arg.budget.run(size, async () => {
    const from = Date.now();
    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch {
      const error = `Kan ${file} niet lezen`;
      return {
        outcome: {
          kind: 'failed',
          error,
          record: { ts, account: target.email, threadId: '', file, error },
        },
      };
    }

    try {
      const used = arg.token();
      // The marker rides the same multipart POST as the real labels -- never a follow-up
      // modify call to add it afterwards, which would reopen exactly the window a cancel-safe
      // copy exists to close. It never reaches the journal or the outcome record below: both
      // stay exactly what the user asked for (`labelIds`), and the marker is tracked only by
      // the run's own journal header (see MarkerLabel). UNREAD travels the same way: mail that
      // was unread in the mailbox it came from arrives unread in the one it was copied to.
      const withMarker = insertLabelIds(labelIds, arg.markerLabelId, arg.ref.unread);
      const insert = (t: string, thread?: string) =>
        insertMessage(t, raw, withMarker, thread, arg.signal);
      let inserted: { id: string | null; threadId: string | null };
      try {
        inserted = await insert(used, landedIn);
      } catch (e) {
        if (e instanceof GmailHttpError && e.status === 400 && landedIn) {
          console.warn(`[maildrop] ${file} does not fit in thread ${landedIn}, inserted on its own`);
          inserted = await insert(used);
        } else {
          if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
          const fresh = await arg.freshToken(used);
          if (!fresh) throw new Error('Verbinding verlopen');
          inserted = await insert(fresh, landedIn);
        }
      }
      // The one thing about a duplicate this app can know for certain: it put it there. Free,
      // exact, and it is the mail the next drag is most likely to ask about. Asked to be written
      // as well, per insert and coalesced by the store's own debounce -- without that this whole
      // copy only reached disk through the quit flush.
      if (messageIndex) {
        remember(messageIndex.load(), messageId, target.email, labelIds, Date.now());
        messageIndex.save(Date.now());
      }
      // Gmail's own id, not the Message-ID header above: this is the only key a later
      // rollback may trash by, since a header can also match mail that was already there.
      if (inserted.id) {
        // Deliberate, not an oversight: the insert already landed and is reported as copied
        // regardless of what happens to this line. What is lost when it fails is narrow and
        // already accounted for -- this one message cannot be offered for rollback later --
        // not a reason to fail an insert that really happened. Logged rather than only
        // warned to the console, since a share dropping this write is worth being able to
        // see later, not only while someone happens to be watching devtools.
        const journalError = recordCopyJournalEntry(arg.journalRoot, {
          runId: arg.runId,
          email: target.email,
          gmailId: inserted.id,
          threadId: inserted.threadId ?? undefined,
          labelIds,
        });
        if (journalError) {
          notifyLog(`[maildrop] could not append a line to the rollback journal: ${journalError}`);
        }
      }
      return {
        outcome: {
          kind: 'copied',
          record: {
            ts,
            account: target.email,
            threadId: inserted.threadId ?? inserted.id ?? '',
            file,
            bytes: raw.length,
            copy: { to: target.email, labels: labelIds, ok: true },
          },
        },
        threadId: inserted.threadId ?? undefined,
        uploadMs: Date.now() - from,
      };
    } catch (e) {
      if (e instanceof GmailCancelledError) {
        // Deliberate, not a failure: this upload was severed because the run was told to
        // stop, not because Gmail refused it. Nothing needs recording here any more -- if this
        // insert landed before the socket was cut, it landed with the marker already on it
        // (insertLabelIds above), so the run's own end-of-run sweep finds it by label
        // membership. There is no ambiguous state left to reconcile.
        return { outcome: { kind: 'stopped' }, uploadMs: Date.now() - from };
      }
      const error = (e as Error).message;
      // Timed as well: an upload that was refused still spent its time on the wire, and leaving
      // it out would flatter the figure.
      return {
        outcome: {
          kind: 'failed',
          error,
          maybeLanded: insertMayHaveLanded(e),
          record: {
            ts,
            account: target.email,
            threadId: '',
            file,
            error,
            copy: { to: target.email, labels: labelIds, ok: false, error },
          },
        },
        uploadMs: Date.now() - from,
      };
    }
  });
}
