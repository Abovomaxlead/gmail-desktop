// Finding out where a drag's mail already sits: the picker's own background scan, at the drop
// rather than at the click, and the narrower check copyToMailboxes runs at Kopieer against
// whichever labels are actually chosen.

import { IPC } from '../../core/ipc';
import type { MailDropCopyTarget } from '../../core/ipc';
import { dropOverlay, messageIndex, profiles, oauthTokens } from '../../core/runtime';
import { mapLimit } from '../../core/concurrency';
import { notifyLog } from '../../notify/notify-log';
import { oauthConfig } from '../../auth/oauth-config';
import { copyTargetEmails } from '../../auth/account-domain';
import { forceRefresh } from '../../auth/oauth-flow';
import { clearRefreshFailure, markRefreshFailed } from '../../auth/oauth-health-check';
import {
  delegatedTokenFor,
  forgetDelegatedToken,
  isDelegatedMailbox,
  mailboxRefusedText,
  mailboxToken,
} from '../../auth/mailbox-token';
import {
  GmailHttpError,
  fetchLabels,
  labelsHoldingMany,
  mailboxCanary,
  type AccountLabels,
} from '../../gmail/gmail-api';
import { JOB_BATCH_THREADS } from '../job/label-job';
import { SCRAPE_MAX_THREADS } from '../drag/label-drop';
import {
  duplicateChecks,
  existingSoFar,
  scanAnswer,
  type DuplicateHit,
  type ExistingResult,
  type MailboxScan,
  type ResolvedTreeLabels,
  type ScanOutcome,
} from './mail-copy';
import { emptyIndex, indexedScan, remember } from './message-index';
import { dropSerial, lastDropSaved, lastDropSource, type SavedRef } from '../drop-state';


//===========================
// Constants
//===========================

// Above this the picker says nothing about duplicates at all, so it is set above the most a
// single pull can produce -- one batch of a job, or a scrape's own ceiling for a label small
// enough not to be one. What makes a limit this high affordable is the batched query, ten
// Message-IDs per search instead of one, and that the scan runs from the drop rather than from
// the click, so its cost is paid while the window is still drawing.
const EXISTING_SCAN_LIMIT = Math.max(JOB_BATCH_THREADS, SCRAPE_MAX_THREADS);

const EXISTING_SCAN_CONCURRENCY = 4;


//===========================
// Module state
//===========================

/** What the last duplicate scan found, stamped with the choice it answered, so a second attempt
 * against the same targets does not ask Gmail the same question again. Read and written by
 * copyToMailboxes, which runs the narrower check at Kopieer; kept here beside the wider scan
 * that feeds it. */
export let lastScan: { key: string; hits: DuplicateHit[] } | null = null;

/** What the picker's own scan found, kept for the check at Kopieer, which asks a narrower
 * question about the same mail. Stamped with the drag it belongs to, so the next drag
 * ignores it rather than answering for the wrong mail. */
let lastExisting: { serial: number; byEmail: Map<string, MailboxScan> } | null = null;

/** The scan of the drag that is on screen, kept so the picker cannot start a second one. Its
 * answers sit in a map so a remembered one is replaced by Gmail's rather than counted twice. */
let existingScan: {
  serial: number;
  scanned: number;
  outcomes: Map<string, ScanOutcome>;
} | null = null;


//===========================
// Exported functions
//===========================

export function setLastScan(v: { key: string; hits: DuplicateHit[] } | null): void {
  lastScan = v;
}

/** Forgets the running scan, so the next drag's startExistingScan does not skip it as already
 * covered. Called when a retry hands the drag more files than the scan ever saw. */
export function resetExistingScan(): void {
  existingScan = null;
  lastExisting = null;
}

/**
 * Which of a drag's messages are already in the chosen mailboxes and labels
 *
 * @param targets
 * @param saved
 * @param onProgress moved on per mailbox, including one that could not be asked at all -- the
 *   bar counts checks rather than answers, so skipping it left the phase short of its own total
 * @param tally filled in for the log: how much of the check the picker's scan had already
 *   answered
 * @param resolved per mailbox what a dragged tree resolved to
 * @returns the messages that are already there, one entry per mailbox per label
 */
export async function findDuplicates(
  targets: MailDropCopyTarget[],
  saved: SavedRef[],
  onProgress: (done: number, total: number) => void,
  tally?: { checks: number; reused: number; asked: number },
  resolved: ResolvedTreeLabels = new Map(),
  /** False on a retry: the picker's scan predates the first copy and cannot answer for it */
  useScan = true,
  /** Narrows the questions to the pairs a retry is about to send */
  only?: (email: string, messageId: string) => boolean,
): Promise<DuplicateHit[]> {
  const checks = duplicateChecks(targets, saved, resolved).filter(
    (c) => !only || only(c.email, c.messageId),
  );

  // The scan behind the picker asked the wider question — which labels hold this message —
  // so most of these are already answered. What it did not cover, because the mailbox
  // refused or the drag was too big to scan, is still asked here.
  const scan = useScan && lastExisting?.serial === dropSerial ? lastExisting.byEmail : null;
  const answers = checks.map((check) => scanAnswer(scan, check));
  const open = checks.filter((_, i) => answers[i] === null);

  let done = checks.length - open.length;
  if (tally) {
    tally.checks = checks.length;
    tally.reused = checks.length - open.length;
    tally.asked = open.length;
  }
  if (open.length > 0) {
    const tokens = new Map<string, string>();
    for (const email of new Set(open.map((c) => c.email))) {
      const got = await mailboxToken(email);
      if (got.ok) tokens.set(email, got.token);
    }

    // One question per mailbox rather than one per label per message: labelsHoldingMany asks
    // which labels hold each mail, which is the wider question, so the per-label answers fall
    // out of it. Same shape the picker's own scan produces, so scanAnswer reads both.
    const fresh = new Map<string, MailboxScan>();
    await mapLimit([...new Set(open.map((c) => c.email))], EXISTING_SCAN_CONCURRENCY, async (email) => {
      const mine = open.filter((c) => c.email === email);
      const token = tokens.get(email);
      if (!token) {
        // Counted before the return: the total is checks, not answers, so a mailbox nobody could
        // ask still has to move the bar or "Controleren" never reaches its own end
        done += mine.length;
        onProgress(done, checks.length);
        return;
      }
      const ids = [...new Set(mine.map((c) => c.messageId))];
      try {
        const canary = await mailboxCanary(token).catch(() => '');
        const found = await labelsHoldingMany(token, ids, canary);
        fresh.set(email, new Map(found.map((m) => [m.messageId, m.labelIds])));
      } catch (e) {
        console.warn(`[maildrop] could not check ${email} for duplicates at copy time:`, e);
      }
      done += mine.length;
      onProgress(done, checks.length);
    });

    // A mailbox that could not be asked answers false, which is what the per-check version did
    // when its request threw: better to copy a mail twice than to skip one that is not there.
    for (const [i, answer] of answers.entries()) {
      if (answer === null) answers[i] = scanAnswer(fresh, checks[i]) ?? false;
    }
  }

  return checks.filter((_, i) => answers[i] === true);
}

/**
 * The labels of the mailboxes this app can reach
 *
 * @param source the mailbox to leave out, empty to offer them all
 * @returns one entry per mailbox, in sidebar order, with its own error where the labels
 *   could not be read
 * @private
 */
async function labelsForMailboxes(source: string): Promise<{ accounts: AccountLabels[] }> {
  const cfg = oauthConfig();

  const targetable = copyTargetEmails(profiles, source);
  if (!cfg || !oauthTokens) {
    return {
      accounts: targetable.map((email) => ({ email, labels: [], error: 'Niet gekoppeld' })),
    };
  }

  const tokens = oauthTokens;
  const accounts: AccountLabels[] = await mapLimit(targetable, 4, async (email) => {
    const got = await mailboxToken(email);
    if (!got.ok) return { email, labels: [], error: got.error };
    const token = got.token;
    try {
      return { email, labels: await fetchLabels(token) };
    } catch (e) {

      const refused = e instanceof GmailHttpError && (e.status === 401 || e.status === 403);
      if (e instanceof GmailHttpError) {
        console.warn(
          `[labels] ${email} (${isDelegatedMailbox(email) ? 'delegated' : 'own'}) HTTP ${e.status}: ${e.message}`,
        );
      }

      let fresh: string | null = null;
      if (refused && isDelegatedMailbox(email)) {
        forgetDelegatedToken(email);
        const again = await delegatedTokenFor(email);
        fresh = again.ok ? again.token : null;
      } else if (refused) {
        fresh = await forceRefresh(cfg, tokens, email);
      }
      if (fresh) {
        try {
          const labels = await fetchLabels(fresh);
          if (!isDelegatedMailbox(email)) clearRefreshFailure(email);
          return { email, labels };
        } catch (e2) {

          if (e2 instanceof GmailHttpError && (e2.status === 401 || e2.status === 403)) {
            console.warn(`[labels] ${email} HTTP ${e2.status} even after a fresh token: ${e2.message}`);
            return { email, labels: [], error: mailboxRefusedText(email) };
          }
          return { email, labels: [], error: (e2 as Error).message };
        }
      }
      if (refused) {
        if (!isDelegatedMailbox(email)) markRefreshFailed(email);
        return { email, labels: [], error: mailboxRefusedText(email) };
      }
      return { email, labels: [], error: (e as Error).message };
    }
  });
  return { accounts };
}

/** The label lists the copy window offers, one column per mailbox that may be copied into.
 *
 * The mailbox the drag came out of is left out: mail is not copied to where it already sits. */
export async function labelsForCopyTargets(): Promise<{ accounts: AccountLabels[] }> {
  return labelsForMailboxes(lastDropSource);
}

/** Every mailbox with its labels, the last drag included.
 *
 * Label cleanup picks a mailbox to empty a label in, so it has no source to exclude. Sharing
 * the copy window's list hid the user's own mailbox for the rest of the session after one drag,
 * and only a restart -- which clears lastDropSource -- brought it back. */
export async function labelsForEveryMailbox(): Promise<{ accounts: AccountLabels[] }> {
  return labelsForMailboxes('');
}

/** What the picker draws, from the answers that have landed so far. Also refreshes what the
 * check at Kopieer reuses, since that is the same fold. */
function existingSnapshot(): ExistingResult {
  if (!existingScan) return { accounts: [], scanned: 0, serial: dropSerial, answered: 0 };
  const { result, byEmail } = existingSoFar(
    [...existingScan.outcomes.values()],
    existingScan.scanned,
    existingScan.serial,
  );
  // Updated on every answer, not only at the end: press Kopieer while the scan is running and
  // the mailboxes that did answer cost no requests, the rest are asked as they always were.
  lastExisting = { serial: existingScan.serial, byEmail };
  return result;
}

/**
 * Starts asking where the drag's mail already sits, at the drop rather than at the click
 *
 * The warning belongs before the choice: the check at Kopieer only looks at labels already
 * ticked, so "already there, under another label" arrived too late. Waiting for the picker to
 * open only moved that wait in front of the user, so the drop starts it and every mailbox
 * that answers is pushed straight to the window.
 *
 * One search per mailbox per message rather than one per label — the same two requests
 * whether the mailbox has four labels or four hundred.
 */
export function startExistingScan(): void {
  if (existingScan?.serial === dropSerial) return;

  const files = lastDropSaved.filter((f) => f.messageId.trim());
  const targetable = copyTargetEmails(profiles, lastDropSource);
  const tooBig = files.length > EXISTING_SCAN_LIMIT;
  if (tooBig) {
    notifyLog(`[maildrop] ${files.length} mails is too many to check for duplicates`);
  }
  const state = {
    serial: dropSerial,
    // 0 says "not looked up", which the picker draws differently from "found nothing"
    scanned: tooBig ? 0 : files.length,
    outcomes: new Map<string, ScanOutcome>(),
  };
  existingScan = state;
  if (files.length === 0 || tooBig || targetable.length === 0) return;

  const answered = (outcome: ScanOutcome) => {
    // A scan can outlive the drop that started it; the one on screen is the only one that
    // may still draw.
    if (existingScan !== state) return;
    // One answer per mailbox: Gmail's replaces a remembered one rather than joining it, or the
    // same mail would be counted twice under the same label.
    if (state.outcomes.get(outcome.email)?.provisional === false && outcome.provisional) return;
    state.outcomes.set(outcome.email, outcome);
    dropOverlay?.send(IPC.MAIL_DROP_EXISTING, existingSnapshot());
  };

  // Before a single request goes out: what the app has already seen. For a mail it copied
  // there itself that is the answer Gmail is about to give, so the warning is on screen while
  // the scan is still starting.
  const messageIds = files.map((f) => f.messageId);
  const index = messageIndex?.load() ?? emptyIndex();
  for (const email of targetable) {
    const found = indexedScan(index, messageIds, email, Date.now());
    if (found.length > 0) answered({ email, found, provisional: true });
  }

  // Nobody awaits this: the picker is sent every answer as it lands and asks for the rest
  // itself. That makes the mailbox loop the only place an error can still surface, so it
  // catches per mailbox and reports that mailbox as unchecked.
  void mapLimit(targetable, EXISTING_SCAN_CONCURRENCY, async (email) => {
    try {
      const got = await mailboxToken(email);
      if (!got.ok) return answered({ email, found: null });
      // A mail of this mailbox's own, to prove the batched query was understood. Without one
      // labelsHoldingMany asks per message, which is what this always did.
      const canary = await mailboxCanary(got.token).catch(() => '');
      const found = await labelsHoldingMany(got.token, messageIds, canary);
      answered({ email, found, provisional: false });
      for (const m of found) {
        if (m.labelIds.length > 0) remember(index, m.messageId, email, m.labelIds, Date.now());
      }
      messageIndex?.save(Date.now());
    } catch (e) {
      console.warn(`[maildrop] could not check ${email} for duplicates:`, e);
      answered({ email, found: null, error: 'Kon niet controleren' });
    }
  });
}

/** Where the last drag's mail already sits, as far as the scan has got. The picker asks once
 * when it opens, because it may well have opened after the first answers landed, and is sent
 * the rest as they come in. */
export function existingForCopyTargets(): ExistingResult {
  startExistingScan();
  return existingSnapshot();
}
