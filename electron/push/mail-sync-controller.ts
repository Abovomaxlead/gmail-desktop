// Keeping the mailboxes current over the Gmail API: the history cursor, the five-minute
// sweep, the verification codes copied out of arriving mail, and the relay push that is
// switched off but still wired.
//
// Two sources could announce new mail and only one may -- with the relay off, that is the
// page. The API side keeps running either way, since it is how a code gets copied and how
// the cursor stays fresh.

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

const RELAY_PUSH_ENABLED: boolean = false;

const apiSyncSince = new Map<string, number>();

const API_SYNC_MS = 5 * 60_000;
let apiSyncTimer: ReturnType<typeof setInterval> | null = null;

function startApiSync(): void {
  const wanted = new Set(pushableEmails());
  for (const email of apiSyncSince.keys()) if (!wanted.has(email)) apiSyncSince.delete(email);
  for (const email of wanted) {
    if (apiSyncSince.has(email)) continue;
    apiSyncSince.set(email, Date.now());
    void syncRunnerFor(email)?.run();
  }
  if (apiSyncTimer || wanted.size === 0) return;
  apiSyncTimer = setInterval(() => {
    for (const email of apiSyncSince.keys()) void syncRunnerFor(email)?.run();
  }, API_SYNC_MS);
}

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
