// What happens when a notification card is clicked, and the two buttons on it.
//
// A relay card carries its thread id already. A card from Gmail's own page carries nothing,
// so three answers are tried in order of how sure each is: the API knows exactly; the source
// view matches the subject against the rows it is rendering, a guess; and failing both, the
// account is opened, which at least lands in the right mailbox.
//
// The API lookup runs only on a click, so mail nobody opens costs nothing, and on a short
// deadline, since the person is waiting and the page's own lookup is still behind it.

import { shell } from 'electron';
import { IPC } from '../core/ipc';
import { bringToFront } from '../windows/window-focus';
import { mapLimit } from '../core/concurrency';
import {
  currentLocale,
  idxOfKey,
  keyOf,
  mainWindow,
  manager,
  prefs,
  profiles,
  setSettingsPanelOpen,
  settingsPanelOpen,
} from '../core/runtime';
import { openSurfaceForAccount } from '../windows/surface-opener';
import { openFullThreadWindow } from '../compose/compose-window';
import { withTokenFor } from '../auth/mailbox-token';
import { forgetDownloadClickPath, takeDownloadClickAction } from '../system/session-setup';
import { notifyLog } from '../notify/notify-log';
import { pickNotifiedMessage, type NotifiedMail } from '../notify/notify-match';
import { hiddenNotificationText, playNotificationSound } from '../notify/notify-gating';
import { notificationPersist, notificationSilent } from '../notify/notification-policy';
import {
  archiveMessage,
  fetchMessageMeta,
  fetchRecentInboxIds,
  markMessageRead,
  type MessageMeta,
} from '../gmail/gmail-api';
import { surfacesForRef } from '../../renderer/lib/surfaces';
import { nativeLabels } from '../menus/native-labels';
import { showToast, toastAccountFor } from './toast-presenter';
import { syncRunnerFor } from '../push/mail-sync-controller';
import type { Profile, Surface } from '../windows/profile-view-manager';
import { webNotifySourceKey, type Toast, type ToastAction } from '../../renderer/lib/toast';


//===========================
// Types
//===========================

/** The one thing above this module that a click can reach: an update or error card opens the
 * settings panel, which belongs to the window layer that wires the click handlers in the
 * first place.
 *
 * The section is optional because only a card that knows where it is going names one: the
 * list of sections belongs to the renderer, so it travels as a string. */
export interface ToastActivationHooks {
  openSettingsPanel(section?: string): void;
  /** Opens the mail-drop panel on a finished job's report, which lives in the mail layer */
  openJobReport(): void;
}


//===========================
// Module state
//===========================

let hooks: ToastActivationHooks = { openSettingsPanel: () => {}, openJobReport: () => {} };


//===========================
// Exported functions
//===========================

export function setToastActivationHooks(h: ToastActivationHooks): void {
  hooks = h;
}

const webNotifySources = new Map<
  string,
  { wc: Electron.WebContents; pageId: string; email: string; notified: NotifiedMail }
>();

export function rememberWebNotifySource(
  key: string,
  source: { wc: Electron.WebContents; pageId: string; email: string; notified: NotifiedMail },
): void {
  webNotifySources.set(key, source);
}

/**
 * Builds and raises the toast for a notification Gmail's own page raised, remembering the
 * source so a click on it can find the message again
 *
 * @param profile the account the notification came from
 * @param wc the view's web contents, kept so a click can look the message back up
 * @param arg the page's own notification: its id, title, body and persistence request
 */
export function showWebNotification(
  profile: Profile,
  wc: Electron.WebContents,
  arg: { id: string; title: string; body: string; requireInteraction?: boolean },
): void {
  const p = prefs?.getAll();
  if (!p) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const sourceKey = webNotifySourceKey(wc.id, arg.id);
  const notified: NotifiedMail = { sender: String(arg.title ?? ''), subject: String(arg.body ?? '') };
  rememberWebNotifySource(sourceKey, { wc, pageId: arg.id, email: profile.email, notified });
  // The page's own word wins over the per-account default, in one direction only: it may
  // keep a card up, never take one down. Google Agenda marks every event reminder this
  // way, and six seconds of a reminder is the same as no reminder -- there is no badge and
  // no list to find it back in afterwards, the way there is for mail.
  const persist = notificationPersist(p, profile.email) || arg.requireInteraction === true;
  notifyLog(
    `[notify] raise web ${profile.email} src=${sourceKey} subject=${JSON.stringify(notified.subject.slice(0, 60))}` +
      ` persist=${persist}${arg.requireInteraction === true ? ' (the page asked for it)' : ''}` +
      ` silent=${notificationSilent(p, profile.email, 'mail')}` +
      `${hidden.hiddenSender || hidden.hiddenSubject ? ' (text hidden by the privacy settings)' : ''}`,
  );
  showToast({
    kind: 'mail',
    title: hidden.hiddenSender ?? arg.title,
    body: hidden.hiddenSubject ?? (arg.body || L.noSubject),
    account: toastAccountFor(profile.email),
    webNotifyId: sourceKey,
    persist,
  });
  if (!notificationSilent(p, profile.email, 'mail')) playNotificationSound(p);
  void syncRunnerFor(profile.email)?.run();
}

export function activateNotification(
  accountKey: string,
  surface: Surface,
  threadId?: string,
  subject?: string,
  messageId?: string,
): void {
  const idx = idxOfKey(accountKey);
  // A click shows the window that is there; it never builds one. Without a window there is
  // nothing to open the mail in, and the card has already been taken off the stack.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const profile = profiles.find((p) => keyOf(p) === accountKey);
  if (!profile) return;
  if (threadId && surface === 'mail') manager?.markNotificationClickHandled(accountKey, 'mail');
  const windowMode = prefs?.getAll().notificationOpen === 'window';

  notifyLog(
    `[notify] activate ${accountKey} surface=${surface} thread=${JSON.stringify(threadId ?? 'none')} message=${JSON.stringify(messageId ?? 'none')} subject=${JSON.stringify(subject ?? '')} mode=${windowMode ? 'window' : 'inline'}`,
  );

  if (threadId && surface === 'mail' && windowMode) {

    void manager?.popOutThread(accountKey, threadId, subject, messageId).then((ok) => {
      if (!ok && idx != null) openFullThreadWindow(idx, threadId, messageId);
    });
    return;
  }
  if (mainWindow) {
    bringToFront(mainWindow);
  }
  if (settingsPanelOpen) {
    setSettingsPanelOpen(false);
    mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
  }
  // The profile's own ref, never one rebuilt from the index: a delegated mailbox has no
  // index, so idx is null for it and the mailbox that raised the card would stay off screen
  // while the thread opened in a view nobody was looking at.
  //
  // Which is not the same as deciding where it lands: a card from Calendar or Chat opens
  // that app, and an app the user sent to the browser belongs in the browser here too, so
  // this goes through the same funnel as the button in the bar. Mail is exempt inside it.
  if (surfacesForRef(profile.ref).includes(surface)) openSurfaceForAccount(profile.ref, surface);
  if (surface !== 'mail') return;
  if (threadId) manager?.openMailThread(accountKey, threadId, messageId);
  else if (subject) manager?.openMailSearch(accountKey, subject);
}

export function forgetToastResources(toast: Toast): void {
  if (toast.webNotifyId) webNotifySources.delete(toast.webNotifyId);
  if (toast.kind === 'download' && toast.threadId) forgetDownloadClickPath(toast.threadId);
}

const NOTIFY_LOOKUP_MESSAGES = 8;
const NOTIFY_LOOKUP_TIMEOUT_MS = 2500;

function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    const settle = (value: T): void => {
      clearTimeout(timer);
      resolve(value);
    };
    void work.then(settle, () => settle(fallback));
  });
}

async function lookupNotifiedMessage(
  email: string,
  notified: NotifiedMail,
): Promise<MessageMeta | null> {
  const withToken = withTokenFor(email);
  if (!withToken) return null;
  try {
    const ids = await withToken((t) => fetchRecentInboxIds(t, NOTIFY_LOOKUP_MESSAGES));
    const metas = await mapLimit(ids, 4, (id) => withToken((t) => fetchMessageMeta(t, id)));
    return pickNotifiedMessage(
      metas.filter((m): m is MessageMeta => m !== null),
      notified,
    );
  } catch (e) {
    notifyLog(`[notify] api lookup failed for ${email}: ${(e as Error).message}`);
    return null;
  }
}

async function openNotifiedThread(toast: Toast): Promise<void> {
  const key = toast.webNotifyId!;
  const source = webNotifySources.get(key);
  webNotifySources.delete(key);
  if (source) {
    const found = await withDeadline(
      lookupNotifiedMessage(source.email, source.notified),
      NOTIFY_LOOKUP_TIMEOUT_MS,
      null,
    );
    if (found && toast.account) {
      notifyLog(`[notify] click ${key}: the api says thread=${found.threadId} message=${found.id}`);
      activateNotification(
        toast.account.key,
        'mail',
        found.threadId,
        source.notified.subject,
        found.id,
      );
      return;
    }

    if (!source.wc.isDestroyed()) {
      notifyLog(`[notify] click ${key}: the api did not recognise it, asking the view`);
      source.wc.send(IPC.WEB_NOTIFY_CLICK, source.pageId);
      return;
    }
  }

  notifyLog(`[notify] click ${key}: no source and no match, opening the account`);
  if (toast.account) activateNotification(toast.account.key, 'mail');
}

export function activateToast(toast: Toast): void {
  if (toast.webNotifyId) {
    void openNotifiedThread(toast);
    return;
  }
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId, undefined, toast.messageId);
    return;
  }
  if (toast.kind === 'download' && toast.threadId) {
    const action = takeDownloadClickAction(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
  // Named, because getting the user to the new version is the whole point of this card and
  // openSettingsPanel without a section leaves the panel wherever it last was.
  if (toast.kind === 'update') {
    hooks.openSettingsPanel('updates');
    return;
  }
  // Deliberately unnamed. This card is raised when adding an account failed, so Updates
  // would be the wrong place to send it.
  if (toast.kind === 'error') {
    hooks.openSettingsPanel();
    return;
  }
  if (toast.kind === 'maildrop') {
    hooks.openJobReport();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    bringToFront(mainWindow);
  }
}

export async function runToastAction(toast: Toast, action: ToastAction): Promise<void> {
  const email = toast.account?.email;
  const messageId = toast.messageId;
  if (!email || !messageId) return;
  const withToken = withTokenFor(email);
  if (!withToken) return;
  try {
    if (action === 'archive') await withToken((t) => archiveMessage(t, messageId));
    else await withToken((t) => markMessageRead(t, messageId));
  } catch (e) {
    console.warn(`[toast] ${action} failed for ${email}:`, e);
  }
}
