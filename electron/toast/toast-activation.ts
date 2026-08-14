// What happens when a notification card is clicked, and the two buttons on it.
//
// A click has to answer "which mail was this", and the answer depends on which of the two
// notification paths raised the card. A card from the relay carries the thread id already.
// A card from Gmail's own page carries nothing, so three answers are tried in order of how
// sure each is: the API knows exactly which mail it was; failing that the source view is
// asked, which matches the subject against whatever rows it is rendering, a guess; failing
// that the account is opened, which at least lands in the right mailbox.
//
// The API lookup runs only on a click, never on arrival, so mail nobody opens costs nothing.
// It is also on a short deadline, because the person is waiting and the page's own lookup is
// still there behind it.

import { shell } from 'electron';
import { IPC } from '../core/ipc';
import { mapLimit } from '../core/concurrency';
import {
  authRef,
  idxOfKey,
  isQuitting,
  keyOf,
  mainWindow,
  manager,
  prefs,
  profiles,
  setDetectionStarted,
  setSettingsPanelOpen,
  settingsPanelOpen,
} from '../core/runtime';
import { showAccount } from '../windows/view-surfaces';
import { openFullThreadWindow } from '../compose/compose-window';
import { withTokenFor } from '../auth/mailbox-token';
import { forgetDownloadClickPath, takeDownloadClickAction } from '../system/session-setup';
import { notifyLog } from '../notify/notify-log';
import { pickNotifiedMessage, type NotifiedMail } from '../notify/notify-match';
import {
  archiveMessage,
  fetchMessageMeta,
  fetchRecentInboxIds,
  markMessageRead,
  type MessageMeta,
} from '../gmail/gmail-api';
import type { Surface } from '../windows/profile-view-manager';
import type { Toast, ToastAction } from '../../renderer/lib/toast';


//===========================
// Types
//===========================

/** The two things above this module that a click can reach. The main window is rebuilt by
 * a click that arrives after it closed, and an update or error card opens the settings
 * panel; both belong to the window layer, which wires the click handlers in the first
 * place. */
export interface ToastActivationHooks {
  reopenWindow(): void;
  openSettingsPanel(): void;
}


//===========================
// Module state
//===========================

let hooks: ToastActivationHooks = { reopenWindow: () => {}, openSettingsPanel: () => {} };


//===========================
// Exported functions
//===========================

export function setToastActivationHooks(h: ToastActivationHooks): void {
  hooks = h;
}

// What a notification Gmail's page raised was, kept for as long as its card is up.
//
// The text is here rather than only in the page because it is what identifies the mail
// again: the API is asked first, and it is asked about this sender and this subject —
// unfolded and unreplaced, which is not what the card ended up showing when the privacy
// settings are on. The view is kept alongside for when the API cannot answer, since its
// DOM is the older lookup and still the fallback. Keyed by webNotifySourceKey rather than
// by the page-side id alone, which is only unique within one view; the page-side id is
// kept as well, because that is the name the page itself will recognise on the way back.
const webNotifySources = new Map<
  string,
  { wc: Electron.WebContents; pageId: string; email: string; notified: NotifiedMail }
>();

/** Remembers what a card raised from Gmail's own page was about, for as long as it is up. */
export function rememberWebNotifySource(
  key: string,
  source: { wc: Electron.WebContents; pageId: string; email: string; notified: NotifiedMail },
): void {
  webNotifySources.set(key, source);
}

export function activateNotification(
  accountKey: string,
  surface: Surface,
  threadId?: string,
  subject?: string,
): void {
  const idx = idxOfKey(accountKey);
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (isQuitting) return;
    setDetectionStarted(false);
    hooks.reopenWindow();
    return;
  }
  if (!profiles.some((p) => keyOf(p) === accountKey)) return;
  if (threadId && surface === 'mail') manager?.markNotificationClickHandled(accountKey, 'mail');
  const windowMode = prefs?.getAll().notificationOpen === 'window';
  // No thread id here means the lookup could not identify the mail — the view was on
  // another label, or showing a conversation, so there was no list to match the subject
  // against. The subject itself is still a lead, and Gmail's own search follows it; only
  // when there is not even that does the click settle for the account.
  notifyLog(
    `[notify] activate ${accountKey} surface=${surface} thread=${threadId ?? 'none'} subject=${JSON.stringify(subject ?? '')} mode=${windowMode ? 'window' : 'inline'}`,
  );
  // A window of its own means exactly that: popOutThread borrows the mail view to reach
  // Gmail's pop-out button and then puts it back, so the main window is not left showing
  // the message as well.
  if (threadId && surface === 'mail' && windowMode) {
    // The subject travels with it because the pop-out has to wait for Gmail to actually
    // arrive on the thread, and the title is the only place the page says it has.
    void manager?.popOutThread(accountKey, threadId, subject).then((ok) => {
      if (!ok && idx != null) openFullThreadWindow(idx, threadId);
    });
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (settingsPanelOpen) {
    setSettingsPanelOpen(false);
    mainWindow?.webContents.send(IPC.SETTINGS_FORCE_CLOSE);
  }
  if (idx != null) showAccount(authRef(idx), surface);
  if (surface !== 'mail') return;
  if (threadId) manager?.openMailThread(accountKey, threadId);
  else if (subject) manager?.openMailSearch(accountKey, subject);
}

// What a card was holding while it was on screen, released when it leaves by any route
// other than a click. A click consumes them itself, in activateToast; nothing consumed
// them on the other four routes, so a dismissed relayed card left an entry in
// webNotifySources pinning a live WebContents — in a map Gmail's page can grow in a loop —
// and a dismissed download card left its path behind. Wired to the controller's onDiscard
// rather than called from each site, because the collapse into a summary is a departure no
// call site sees.
export function forgetToastResources(toast: Toast): void {
  if (toast.webNotifyId) webNotifySources.delete(toast.webNotifyId);
  if (toast.kind === 'download' && toast.threadId) forgetDownloadClickPath(toast.threadId);
}

/** How much of the inbox is fetched to recognise one notification in, and how long that is
 * allowed to take before the click goes on without it. The click is a person waiting, so
 * the deadline is short and missing it is not an error: the page's own lookup is still
 * there, and it is what used to answer alone. */
const NOTIFY_LOOKUP_MESSAGES = 8;
const NOTIFY_LOOKUP_TIMEOUT_MS = 2500;

/** Resolves to `fallback` if `work` has not finished in time, and lets a rejection resolve
 * the same way: nothing here is worth failing a click over. */
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

/** Which mail the notification was about, asked of the Gmail API.
 *
 * A handful of the newest inbox messages, their sender and subject, and the match made
 * against the text the notification drew. That is one list request and a few metadata ones
 * — only ever on a click, never on arrival, so mail nobody opens costs nothing.
 *
 * Delegated mailboxes have no token of their own and fall out at the first line, which is
 * correct: for those the page's DOM is the only lookup there has ever been. */
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

/** A card raised from Gmail's own notification was clicked.
 *
 * Three answers, in order of how sure each one is. The API knows exactly which mail it was
 * and hands back its thread id. Failing that the source view is asked, which matches the
 * subject against whatever rows it is rendering — a guess, and the reason this order is
 * this way round. Failing that too, the account is opened, which at least lands in the
 * right mailbox.
 *
 * The source is dropped before any of it: whichever answer wins, this card is spent, and a
 * second click cannot arrive on a card the stack has already removed. */
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
      notifyLog(`[notify] click ${key}: the api says thread=${found.threadId}`);
      activateNotification(toast.account.key, 'mail', found.threadId, source.notified.subject);
      return;
    }
    // The page-side id goes back, never the key we filed it under: the page's own map is
    // keyed by the name it made up, and knows nothing about which WebContents it is.
    if (!source.wc.isDestroyed()) {
      notifyLog(`[notify] click ${key}: the api did not recognise it, asking the view`);
      source.wc.send(IPC.WEB_NOTIFY_CLICK, source.pageId);
      return;
    }
  }
  // Nothing left that could resolve the thread. Showing the account beats swallowing the
  // click.
  notifyLog(`[notify] click ${key}: no source and no match, opening the account`);
  if (toast.account) activateNotification(toast.account.key, 'mail');
}

export function activateToast(toast: Toast): void {
  if (toast.webNotifyId) {
    void openNotifiedThread(toast);
    return;
  }
  if (toast.kind === 'mail' && toast.account) {
    activateNotification(toast.account.key, 'mail', toast.threadId);
    return;
  }
  if (toast.kind === 'download' && toast.threadId) {
    const action = takeDownloadClickAction(toast.threadId);
    if (action === 'open-file') void shell.openPath(toast.threadId);
    else if (action === 'show-in-folder') shell.showItemInFolder(toast.threadId);
    return;
  }
  if (toast.kind === 'update' || toast.kind === 'error') {
    hooks.openSettingsPanel();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// Archive and mark-read from the card. The card is already gone by the time this runs —
// the controller removes it before calling — because a button that leaves its card sitting
// there while a request is in flight invites a second click on the same message. A failure
// is logged and not surfaced: the mail is still in the inbox, which is the same state the
// user would have been in had they never clicked.
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
