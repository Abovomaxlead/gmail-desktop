// Keeping the mailboxes current over the Gmail API: the history cursor, the five-minute
// sweep, the verification codes copied out of arriving mail, and the relay push that is
// switched off but still wired.
//
// Two sources could announce new mail and only one may. Push coverage is what tells a Gmail
// view to keep quiet, so an account the relay delivers for is an account whose page stops
// notifying -- and with the relay off, the page is the one that speaks. The API side below
// keeps running either way, because it is how a code gets copied and how the cursor stays
// fresh, neither of which the relay was ever the point of.

import { clipboard } from 'electron';
import {
  coverage,
  history,
  pushManager,
  oauthTokens,
  prefs,
  profiles,
  setPushManager,
  syncRunners,
  currentLocale,
  type SyncRunner,
} from '../core/runtime';
import { accessTokenFor, forceRefresh } from '../auth/oauth-flow';
import { oauthConfig, pushConfig } from '../auth/oauth-config';
import { withTokenFor } from '../auth/mailbox-token';
import {
  checkOAuthHealth,
  clearPushRefusal,
  clearRefreshFailure,
  markRefreshFailed,
  notePushRefused,
  scheduleOAuthHealthCheck,
} from '../auth/oauth-health-check';
import { hasScopes } from '../auth/google-oauth';
import {
  hiddenNotificationText,
  playNotificationSound,
  refreshNotifyAllowed,
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
  watchMailbox,
  GmailHttpError,
  type MessageMeta,
} from '../gmail/gmail-api';
import { startPushManager } from './push-manager';
import { createSyncRunner } from './push-sync';


//===========================
// Exported functions
//===========================

function notifyNewMail(email: string, meta: MessageMeta): void {
  if (!prefs) return;
  if (!coverage.has(email)) return;
  const account = toastAccountFor(email);
  if (!account) return;
  const p = prefs.getAll();
  const now = new Date();
  if (!notificationsAllowed(p, email, now, 'mail')) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  // Which of the two notification paths raised a card decides how exact its click can be,
  // and nothing downstream records it. This one is push: the thread id comes from the Gmail
  // API and is the mail itself, so a click that still lands wrong is about opening, not
  // about finding.
  notifyLog(`[notify] raise push ${email} thread=${meta.threadId}`);
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
      { subject: meta.subject, body: extractPlainText(raw.toString('utf8')), from: meta.from },
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
    console.warn(`[codes] kon geen code afhandelen voor ${email}:`, e);
  }
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
    coveredSince: () => coverage.since(email) ?? apiSyncSince.get(email) ?? null,
    isExpiredCursor: (e) => e instanceof GmailHttpError && e.status === 404,
    onOutcome: (outcome) => {
      reportApiUnread(email, outcome.unread);
      // Only the relay's own mail cards go here. With it off, this same sync still runs —
      // on a timer and on every notification Gmail's page raises — and a card per message
      // would be a second card for mail the page has already announced. What the sync is
      // for then is the line below it: the code in the mail, and a cursor that moved.
      if (RELAY_PUSH_ENABLED) for (const meta of outcome.notify) notifyNewMail(email, meta);
      for (const meta of outcome.notify) void handleVerificationCode(email, meta, withToken);
    },
    onError: (e) => console.warn(`[sync] sync mislukte voor ${email}:`, e),
  });
  syncRunners.set(email, runner);
  return runner;
}

function pushableEmails(): string[] {
  if (!oauthTokens) return [];
  return profiles
    .filter((p) => p.kind === 'authuser')
    .map((p) => p.email)
    .filter((email) => {
      const token = oauthTokens!.get(email);
      return token !== undefined && hasScopes(token);
    });
}

/** Whether the relay drives new mail.
 *
 * Off, and the notifications come from Gmail's own page instead — the shim in preload.ts,
 * raising the same cards through the same stack. The two cannot both run: push coverage is
 * what tells a view to keep quiet, so an account the relay delivers for is an account whose
 * page stops notifying, and turning this back on turns that back on with it. Every line the
 * relay needs is still here and still tested; what it has never had on this machine is a
 * relayUrl and a pushTopic in the config file, without which startRelayPush() returned on
 * the spot anyway — this only says so out loud.
 *
 * The API side below does not hang on it. That keeps running either way, because it is how
 * a verification code gets copied and how the history cursor stays fresh, neither of which
 * the relay was ever the point of. */
const RELAY_PUSH_ENABLED: boolean = false;

/** When the API sync started watching this mailbox. The same question push answers with its
 * coverage moment — mail older than this was already in the inbox and must stay quiet — but
 * deliberately not the same answer. Coverage means "the relay delivers for this account",
 * and it delivers for none; writing this into it would tell every mail view to go silent on
 * behalf of a sync that raises no notifications at all, and the app would go quiet. */
const apiSyncSince = new Map<string, number>();

/** Slow on purpose. Every notification from the page runs a sync of its own the moment it
 * arrives, so this is only the net underneath: mail that notified nobody — quiet hours, an
 * account with notifications off, a category Gmail keeps to itself — whose code still
 * deserves copying and whose history id still has to move. */
const API_SYNC_MS = 5 * 60_000;
let apiSyncTimer: ReturnType<typeof setInterval> | null = null;

/** The API half, without a relay to start it. Idempotent, and called from everywhere
 * startMailSync is: accounts arrive, are removed, or get a token long after they appeared. */
function startApiSync(): void {
  const wanted = new Set(pushableEmails());
  for (const email of apiSyncSince.keys()) if (!wanted.has(email)) apiSyncSince.delete(email);
  for (const email of wanted) {
    if (apiSyncSince.has(email)) continue;
    // Set before the first run, never after: that run writes the baseline cursor, and a
    // moment stamped afterwards would place every message it just skipped in the future.
    apiSyncSince.set(email, Date.now());
    void syncRunnerFor(email)?.run();
  }
  if (apiSyncTimer || wanted.size === 0) return;
  apiSyncTimer = setInterval(() => {
    for (const email of apiSyncSince.keys()) void syncRunnerFor(email)?.run();
  }, API_SYNC_MS);
}

/** Everything that keeps the mailboxes current: the API sync always, the relay only while
 * it is switched on. */
export function startMailSync(): void {
  startApiSync();
  if (!RELAY_PUSH_ENABLED) return;
  startRelayPush();
}

function startRelayPush(): void {
  if (pushManager) {
    pushManager.refresh();
    return;
  }
  const config = pushConfig();
  if (!config) return;
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return;

  const started = startPushManager({
    config,
    accounts: pushableEmails,
    accessToken: (email) => accessTokenFor(cfg, oauthTokens!, email),
    refreshToken: async (email) => {
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (fresh) clearRefreshFailure(email);
      else markRefreshFailed(email);
      return fresh;
    },
    armWatch: async (email) => {
      const token = await accessTokenFor(cfg, oauthTokens!, email);
      if (!token) return false;
      try {
        return (await watchMailbox(token, config.pushTopic)) !== null;
      } catch (e) {
        console.warn(`[push] watch mislukte voor ${email}:`, e);
        return false;
      }
    },
    onSync: (email) => void syncRunnerFor(email)?.run(),
    onCoverage: (email, covered) => {
      if (covered) {
        coverage.cover(email);
        if (clearPushRefusal(email)) scheduleOAuthHealthCheck();
      } else coverage.drop(email);
      refreshNotifyAllowed();
    },
    onFatal: (email, code) => {
      console.warn(`[push] push definitief uit voor ${email} (code ${code})`);
      if (code === 4401) {
        notePushRefused(email);
        void checkOAuthHealth();
      }
    },
  });
  setPushManager(started);
}
