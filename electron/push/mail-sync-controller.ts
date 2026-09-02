// Keeping the mailboxes current over the Gmail API: the history cursor, the five-minute
// sweep, and the verification codes copied out of arriving mail.
//
// For an own account the page announces new mail and the API does not: the sweep is there
// so a code gets copied and the cursor stays fresh, and it owns the unread count because
// threadsUnread counts the whole mailbox while the page title counts one tab.
//
// A delegated mailbox is the exception. Gmail raises no desktop notification in a delegated
// view at all: notify.log holds weeks of "notification shim installed" for those views and
// not one "Gmail raised a notification", across fifteen moments where their unread count
// rose while the app ran. So for those mailboxes the page is not a quiet source, it is no
// source, and the API sweep below is the only one that can speak. It runs against a
// relay-minted token and touches no own account.

import { clipboard } from 'electron';
import {
  history,
  messageIndex,
  oauthTokens,
  prefs,
  profiles,
  syncRunners,
  currentLocale,
} from '../core/runtime';
import { delegatedTokenUrl } from '../auth/oauth-config';
import { withDelegatedToken, withTokenFor } from '../auth/mailbox-token';
import { hasScopes } from '../auth/google-oauth';
import {
  hiddenNotificationText,
  playNotificationSound,
  reportApiUnread,
} from '../notify/notify-gating';
import {
  notificationsAllowed,
  notificationPersist,
  notificationSilent,
} from '../notify/notification-policy';
import { notifyLog } from '../notify/notify-log';
import { showToast, toastAccountFor } from '../toast/toast-presenter';
import { nativeLabels } from '../menus/native-labels';
import { displayName } from '../mail/mail-archive';
import { remember } from '../mail/message-index';
import { extractPlainText } from '../mail/eml';
import { findVerificationCode, subjectSuggestsCode } from '../gmail/verification-code';
import {
  fetchHistoryPage,
  fetchInboxUnread,
  fetchMessageMeta,
  fetchMessageRaw,
  fetchProfileHistoryId,
  markMessageRead,
  trashMessage,
  GmailHttpError,
  type MessageMeta,
} from '../gmail/gmail-api';
import { createSyncRunner } from './push-sync';


//===========================
// Exported functions
//===========================

/**
 * Raises the card for one mail the API turned up
 *
 * Only a delegated mailbox gets here: nothing else can announce its mail, while an own
 * account is announced by the Gmail page itself.
 *
 * @param email
 * @param meta
 * @private
 */
function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs) return;
  const account = toastAccountFor(email);
  if (!account) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);

  notifyLog(`[notify] raise delegated ${email} thread=${meta.threadId}`);
  showToast({
    kind: 'mail',
    title: hidden.hiddenSender ?? (displayName(meta.from) || email),
    body: hidden.hiddenSubject ?? (meta.subject || L.noSubject),
    account,
    threadId: meta.threadId,
    messageId: meta.id,
    persist: notificationPersist(p, email),
  });
  if (!notificationSilent(p, email, 'mail')) playNotificationSound(p);
}

const handledCodeIds = new Set<string>();
const HANDLED_CODE_LIMIT = 500;

async function handleVerificationCode(
  email: string,
  meta: MessageMeta,
  withToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>,
): Promise<void> {
  const vc = prefs?.getAll().verificationCodes;
  if (!vc?.autoCopy) return;
  if (handledCodeIds.has(meta.id)) return;
  if (!subjectSuggestsCode(meta.subject)) return;
  try {
    const raw = await withToken((token) => fetchMessageRaw(token, meta.id));
    if (!raw) return;
    const code = findVerificationCode(
      { subject: meta.subject, body: extractPlainText(raw.toString('utf8')) },
      vc.confidence,
    );
    if (!code) return;
    clipboard.writeText(code);
    handledCodeIds.add(meta.id);
    if (handledCodeIds.size > HANDLED_CODE_LIMIT) {
      for (const id of [...handledCodeIds].slice(0, HANDLED_CODE_LIMIT / 2)) {
        handledCodeIds.delete(id);
      }
    }
    if (vc.markRead) await withToken((token) => markMessageRead(token, meta.id));
    if (vc.deleteAfter) await withToken((token) => trashMessage(token, meta.id));
  } catch (e) {
    console.warn(`[codes] could not handle a code for ${email}:`, e);
  }
}


/**
 * Notes the mail that just arrived, so the picker knows this mailbox holds it
 *
 * The headers were fetched for the notification anyway; the Message-ID rides along on that
 * same call, which is what makes knowing this free.
 *
 * @param email the mailbox it arrived in
 * @param arrivals what the sync turned up
 */
function rememberArrivals(email: string, arrivals: MessageMeta[]): void {
  const withId = arrivals.filter((m) => m.messageId);
  if (withId.length === 0) return;
  if (!messageIndex) return;
  const now = Date.now();
  const index = messageIndex.load();
  for (const meta of withId) remember(index, meta.messageId, email, ['INBOX'], now);
  messageIndex.save(now);
}

export function syncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  if (!history) return null;

  const withToken = withTokenFor(email);
  if (!withToken) return null;

  const runner = createSyncRunner({
    client: {
      profileHistoryId: () => withToken((t) => fetchProfileHistoryId(t)),
      historyPage: (start, pageToken) => withToken((t) => fetchHistoryPage(t, start, pageToken)),
      messageMeta: (id) => withToken((t) => fetchMessageMeta(t, id)),
      inboxUnread: () => withToken((t) => fetchInboxUnread(t)),
    },
    cursor: {
      get: () => history!.get(email),
      set: (id) => history!.set(email, id),
    },
    coveredSince: () => apiSyncSince.get(email) ?? null,
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      for (const meta of outcome.notify) void handleVerificationCode(email, meta, withToken);
      rememberArrivals(email, outcome.notify);
    },
    onError: (e) => console.warn(`[sync] sync failed for ${email}:`, e),
  });
  syncRunners.set(email, runner);
  return runner;
}

// The own accounts the API may be asked about: signed in, with a token wide enough.
function ownAccounts(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}

// When the sweep of each own account began. Mail already sitting there is not news, so this
// is what keeps the first sweep from copying a code out of a week-old message.
const apiSyncSince = new Map<string, number>();

const API_SYNC_MS = 5 * 60_000;
let apiSyncTimer: ReturnType<typeof setInterval> | null = null;

function startApiSync(): void {
  const wanted = new Set(ownAccounts());
  for (const email of apiSyncSince.keys()) if (!wanted.has(email)) apiSyncSince.delete(email);
  for (const email of wanted) {
    if (apiSyncSince.has(email)) continue;
    apiSyncSince.set(email, Date.now());
    void syncRunnerFor(email)?.run();
  }
  stopApiSyncWhenEmpty();
  if (apiSyncTimer || wanted.size === 0) return;
  apiSyncTimer = setInterval(() => {
    for (const email of apiSyncSince.keys()) void syncRunnerFor(email)?.run();
  }, API_SYNC_MS);
}

/**
 * Stops the five-minute sweep once no own account is left to sweep
 *
 * The last account leaving takes the clock with it, or it keeps ticking over an empty map
 * for the rest of the session -- and a later account would find a timer that is already
 * "started" and never be swept at all.
 *
 * @private
 */
function stopApiSyncWhenEmpty(): void {
  if (apiSyncSince.size > 0 || !apiSyncTimer) return;
  clearInterval(apiSyncTimer);
  apiSyncTimer = null;
}


//===========================
// Delegated mailboxes
//===========================

// Faster than the own-account sweep, because it is not a safety net behind a page that
// already notified -- it is the only thing watching. It was a minute, on the reasoning
// that a minute reads as "the app told me"; the number was never the quota talking, and
// the quota turns out to have nothing to say about it either way.
//
// An idle sweep is one history.list, which is 2 units, and the allowance is per mailbox
// rather than shared: the token belongs to the delegated mailbox, so twenty of them spend
// twenty separate allowances. Four sweeps a minute is 8 units of a published 15,000 --
// and still only 0.13% of the 6,000 this project would get on the table published on
// 1 May 2026. Nothing about this interval is priced by Gmail.
//
// What does scale with it is the relay while it is down, since a failed mint is not
// cached and every sweep asks again; and the sweeps of all mailboxes landing in one tick,
// because their tokens were stamped together and so expire together. Both are survivable
// four times a minute and are the reason this is not tighter still.
/** Exported for the tests, which advance fake timers by exactly one sweep: a mirrored
 * literal there went on reading as one sweep long after this stopped being a minute. */
export const DELEGATED_SYNC_MS = 15_000;

// When the watch on each mailbox began. Mail already sitting there is not news, so this is
// what keeps the first sweep quiet -- support@ holding twenty-seven unread must not raise
// twenty-seven cards. createSyncRunner asks for it as coveredSince and compares it against
// the moment Gmail stamped each message with.
const delegatedSince = new Map<string, number>();

// The last complaint made about each mailbox, so a relay that is down says so once instead
// of once a sweep for as long as the app runs.
const delegatedComplaint = new Map<string, string>();

let delegatedTimer: ReturnType<typeof setInterval> | null = null;
let noRelaySaid = false;

/**
 * The delegated mailboxes the API can be asked about
 *
 * @returns the addresses, or none at all when this machine has no relay to ask
 * @private
 */
function delegatedMailboxes(): string[] {
  const rows = profiles.filter((profile) => profile.kind === 'delegated').map((p) => p.email);
  if (rows.length > 0 && !delegatedTokenUrl()) {
    // Said once per session. Without the relay there is no token, without a token no sweep,
    // and the mailbox is then as quiet as one nobody writes to -- which is the confusion this
    // whole thing exists to end, so it may not be silent about being silent.
    if (!noRelaySaid) {
      noRelaySaid = true;
      notifyLog(
        `[notify] no relay configured; ${rows.length} delegated mailbox(es) cannot announce anything`,
      );
    }
    return [];
  }
  return rows;
}

/**
 * The runner that watches one delegated mailbox
 *
 * Everything is the own-account runner except three things: the token comes from the relay,
 * the unread count is not asked for -- the page title already carries it -- and this runner
 * raises the cards itself, because for this mailbox there is nothing else that could
 * announce the same mail.
 *
 * @param email
 * @returns the runner, kept in syncRunners like every other, or null with no history store
 * @private
 */
function delegatedSyncRunnerFor(email: string): { run(): Promise<void> } | null {
  const existing = syncRunners.get(email);
  if (existing) return existing;
  if (!history) return null;

  const withToken = withDelegatedToken(email);
  const runner = createSyncRunner({
    client: {
      profileHistoryId: () => withToken((t) => fetchProfileHistoryId(t)),
      historyPage: (start, pageToken) => withToken((t) => fetchHistoryPage(t, start, pageToken)),
      messageMeta: (id) => withToken((t) => fetchMessageMeta(t, id)),
      inboxUnread: async () => null,
    },
    cursor: {
      get: () => history!.get(email),
      set: (id) => history!.set(email, id),
    },
    coveredSince: () => delegatedSince.get(email) ?? null,
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      for (const meta of outcome.notify) notifyNewMail(email, meta);
      if (outcome.notify.length > 0) delegatedComplaint.delete(email);
    },
    onError: (e) => complainAbout(email, e),
  });
  syncRunners.set(email, runner);
  return runner;
}

/**
 * Writes down why a delegated mailbox could not be read, once per reason
 *
 * A mailbox that cannot be reached notifies exactly as silently as one with no mail, which
 * is the failure this whole thing exists to end -- so it has to leave a line. The same line
 * every sweep would bury the log, so only a changed reason is written.
 *
 * @param email
 * @param e whatever the runner threw, usually the relay's own sentence
 * @private
 */
function complainAbout(email: string, e: unknown): void {
  const reason = e instanceof Error ? e.message : String(e);
  if (delegatedComplaint.get(email) === reason) return;
  delegatedComplaint.set(email, reason);
  notifyLog(`[notify] delegated mailbox ${email} could not be read: ${reason}`);
}

/**
 * Starts and stops watching, following whatever delegated mailboxes are on screen
 *
 * Called again whenever that list changes, and idempotent per mailbox: an address already
 * being watched keeps the moment its watch began, or every added mailbox would silence the
 * ones already there.
 *
 * @private
 */
function startDelegatedSync(): void {
  const wanted = new Set(delegatedMailboxes());
  for (const email of delegatedSince.keys()) if (!wanted.has(email)) stopMailboxSync(email);
  for (const email of wanted) {
    if (delegatedSince.has(email)) continue;
    delegatedSince.set(email, Date.now());
    notifyLog(
      `[notify] delegated mailbox ${email} is now read every ${DELEGATED_SYNC_MS / 1000} seconds`,
    );
    void delegatedSyncRunnerFor(email)?.run();
  }
  if (delegatedTimer || wanted.size === 0) return;
  delegatedTimer = setInterval(() => {
    for (const email of delegatedSince.keys()) void delegatedSyncRunnerFor(email)?.run();
  }, DELEGATED_SYNC_MS);
}

/**
 * Stops watching one mailbox and forgets everything held about it
 *
 * @param email
 */
export function stopMailboxSync(email: string): void {
  syncRunners.delete(email);
  delegatedSince.delete(email);
  delegatedComplaint.delete(email);
  apiSyncSince.delete(email);
  // The last mailbox leaving takes the clock with it, or it keeps ticking over an empty map
  // for the rest of the session -- and a later mailbox would find a timer that is already
  // "started" and never be swept at all.
  if (delegatedSince.size === 0 && delegatedTimer) {
    clearInterval(delegatedTimer);
    delegatedTimer = null;
  }
  stopApiSyncWhenEmpty();
}


//===========================
// Starting
//===========================

export function startMailSync(): void {
  startApiSync();
  startDelegatedSync();
}
