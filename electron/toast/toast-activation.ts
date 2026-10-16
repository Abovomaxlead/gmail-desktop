// What happens when a notification card is clicked, and the two buttons on it.
//
// A relay card carries its thread id already. A card from Gmail's own page carries nothing,
// so three answers are tried in order of how sure each is: the API knows exactly; the source
// view matches the subject against the rows it is rendering, a guess; and failing both, the
// account is opened, which at least lands in the right mailbox.
//
// For mail the API lookup runs when the card is raised, since the card shows the sender's
// address and the first lines of the mail, and its answer is kept for the click. It runs on a
// short deadline both times: the card is waiting, and the page's own lookup is behind it.

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
import { hostOf } from '../system/link-guard';
import { senderAddress } from '../mail/pull/mail-archive';
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

interface WebNotifySource {
  wc: Electron.WebContents;
  pageId: string;
  email: string;
  notified: NotifiedMail;
  /** The message the API matched when the card was raised, so a click need not ask again */
  found?: MessageMeta;
}

const webNotifySources = new Map<string, WebNotifySource>();

export function rememberWebNotifySource(key: string, source: WebNotifySource): void {
  webNotifySources.set(key, source);
}

/**
 * Builds and raises the toast for a notification Gmail's own page raised, remembering the
 * source so a click on it can find the message again
 *
 * The page says only the sender's name and the subject. The card leads with the sender's
 * address and shows the first lines of the mail, which only the API knows -- so for mail the
 * message is looked up first, on the same short deadline a click uses. A lookup that fails or
 * runs late costs nothing but those two lines: the card goes up with what the page said.
 * Agenda reminders come through here too, from the calendar view; they are not looked up and
 * get no inbox line.
 *
 * @param profile the account the notification came from
 * @param wc the view's web contents, kept so a click can look the message back up
 * @param arg the page's own notification: its id, title, body and sender picture
 */
export async function showWebNotification(
  profile: Profile,
  wc: Electron.WebContents,
  arg: { id: string; title: string; body: string; icon?: unknown },
): Promise<void> {
  const p = prefs?.getAll();
  if (!p) return;
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const sourceKey = webNotifySourceKey(wc.id, arg.id);
  const notified: NotifiedMail = { sender: String(arg.title ?? ''), subject: String(arg.body ?? '') };
  const isMail = !wc.isDestroyed() && hostOf(wc.getURL()) === 'mail.google.com';
  // Nothing to look up when the privacy settings hide both lines it would fill in.
  const wanted = isMail && (hidden.hiddenSender === undefined || hidden.hiddenSubject === undefined);
  const found = wanted
    ? await withDeadline(lookupNotifiedMessage(profile.email, notified), NOTIFY_LOOKUP_TIMEOUT_MS, null)
    : null;
  rememberWebNotifySource(sourceKey, {
    wc,
    pageId: arg.id,
    email: profile.email,
    notified,
    ...(found ? { found } : {}),
  });
  // Agenda reminders follow the same per-account "persist" switch as mail: the page's own
  // requireInteraction is ignored, so a reminder fades after a few seconds unless the
  // account is set to keep its notifications up.
  const persist = notificationPersist(p, profile.email);
  // The picture is the sender's face, so it goes wherever the sender's name goes.
  const senderAvatarUrl = hidden.hiddenSender === undefined ? senderPicture(arg.icon) : undefined;
  // The body of the mail is as private as its subject, so it is hidden by the same switch.
  const preview = hidden.hiddenSubject === undefined ? found?.snippet : undefined;
  notifyLog(
    `[notify] raise web ${profile.email} src=${sourceKey} subject=${JSON.stringify(notified.subject.slice(0, 60))}` +
      ` persist=${persist}` +
      ` silent=${notificationSilent(p, profile.email, 'mail')}` +
      ` picture=${senderAvatarUrl ? new URL(senderAvatarUrl).host : 'none'}` +
      ` lookup=${!wanted ? 'skipped' : found ? 'found' : 'none'}` +
      `${hidden.hiddenSender || hidden.hiddenSubject ? ' (text hidden by the privacy settings)' : ''}`,
  );
  showToast({
    kind: 'mail',
    title: hidden.hiddenSender ?? (senderAddress(found?.from ?? '') || arg.title),
    body: hidden.hiddenSubject ?? (found?.subject || arg.body || L.noSubject),
    account: toastAccountFor(profile.email),
    webNotifyId: sourceKey,
    ...(senderAvatarUrl ? { senderAvatarUrl } : {}),
    ...(preview ? { preview } : {}),
    ...(isMail ? { inbox: profile.email } : {}),
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
    const found =
      source.found ??
      (await withDeadline(lookupNotifiedMessage(source.email, source.notified), NOTIFY_LOOKUP_TIMEOUT_MS, null));
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


//===========================
// Helper functions
//===========================

/**
 * The sender's picture from a page notification, when it is one the toast window can load
 *
 * The value comes straight out of Google's page, so only a plain https address passes.
 *
 * @param icon what the page set as the notification's icon
 * @returns the address, or undefined when there is none worth showing
 */
function senderPicture(icon: unknown): string | undefined {
  if (typeof icon !== 'string' || icon === '') return undefined;
  try {
    return new URL(icon).protocol === 'https:' ? icon : undefined;
  } catch {
    return undefined;
  }
}
