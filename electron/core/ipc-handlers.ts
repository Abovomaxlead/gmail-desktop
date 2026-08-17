// Every channel the renderer can reach the main process on, in one table.
//
// The handlers here are deliberately thin: each one validates what arrived, calls the module
// that owns the job, and sends back what it returns. Where a handler grew a body of its own
// it was moved -- the label list and the mailbox copy live in mail-drop-controller, the
// picker size in mailto-controller -- because a channel name is not a home for logic.
//
// What comes down these channels is not all ours. IPC.WEB_NOTIFY_SHOW carries whatever
// Gmail's own page passed to the Notification constructor, so its fields are checked rather
// than trusted; an id of the wrong type would file a click under a name nothing can look up
// again.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { IPC, type MailDropCopyTarget } from './ipc';
import { OAUTH_CONFIG_PATH } from './paths';
import {
  activeTab,
  colors,
  currentLocale,
  downloadHistory,
  mainWindow,
  manager,
  oauthStatuses,
  oauthTokens,
  prefs,
  profiles,
  keyOf,
  reconnectAccounts,
  setSettingsPanelOpen,
  toastWindow,
  toasts,
  SESSION_PARTITION,
} from './runtime';
import { pushPrefs, pushProfiles, pushUnread, refreshBadge } from './broadcast';
import { type LanguagePref } from './locale';
import { type AppearancePatch, type PrefsStore } from './prefs-store';
import { addAccount, redetect, removeAccount } from '../accounts/detection-controller';
import { refreshDelegatedFromApi } from '../delegation/delegated-controller';
import {
  closeDropPreview,
  copyToMailboxes,
  dropPreviewItems,
  existingForCopyTargets,
  labelsForCopyTargets,
  mailDropFolder,
} from '../mail/mail-drop-controller';
import { type CopyMode } from '../mail/mail-copy';
import { applyComposeAskSize, settleComposeAsk } from '../compose/mailto-controller';
import { openSurfaceForAccount, showTestNotification } from '../windows/surface-opener';
import { syncCalendarViews } from '../windows/view-surfaces';
import { applyMinWindowSize, applyReneZoom, applyTitleBarOverlay } from '../windows/window-chrome';
import { rememberWebNotifySource } from '../toast/toast-activation';
import { showToast, toastAccountFor } from '../toast/toast-presenter';
import {
  hiddenNotificationText,
  playNotificationSound,
  refreshNotifyAllowed,
} from '../notify/notify-gating';
import {
  mergeNotificationsFromPanel,
  notificationPersist,
  notificationSilent,
} from '../notify/notification-policy';
import { notifyLog } from '../notify/notify-log';
import { type NotifiedMail } from '../notify/notify-match';
import { applyTraySetting, refreshTray, setSnooze } from '../menus/tray-setup';
import { popupNativeMenu } from '../menus/native-menu';
import { nativeLabels } from '../menus/native-labels';
import {
  applyAutoUpdateCheck,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  loadChangelog,
} from '../updates/update-controller';
import { checkOAuthHealth, clearPushRefusal, clearRefreshFailure } from '../auth/oauth-health-check';
import { oauthConfig } from '../auth/oauth-config';
import { connectAccount } from '../auth/oauth-flow';
import { checkOAuthConfigFile } from '../auth/oauth-config-file';
import { startMailSync, syncRunnerFor } from '../push/mail-sync-controller';
import { downloadFolder, knownDownloadPath } from '../system/session-setup';
import { requestDefaultMail, setAutoStart, setLaunchMinimized } from '../system/system-integration';
import { webNotifySourceKey, type ToastAction } from '../../renderer/lib/toast';
import type { NativeMenuItem } from '../../renderer/lib/native-menu';
import type { Surface } from '../windows/profile-view-manager';


//===========================
// Exported functions
//===========================

export function registerIpc(): void {
  ipcMain.on(IPC.SWITCH_SURFACE, (_e, arg: { key: string; surface: Surface }) => {
    const p = profiles.find((x) => keyOf(x) === arg.key);
    if (!p) return;
    openSurfaceForAccount(p.ref, arg.surface);
  });
  ipcMain.on(IPC.REDETECT, () => redetect());
  ipcMain.on(IPC.ADD_ACCOUNT, () => addAccount());
  // "Look for delegated mailboxes" now asks the relay instead of reading Gmail's account
  // menu, so it no longer has to bring account 0 to the front and put it back: nothing is
  // read from a page. Whatever it finds is added straight away rather than offered as a
  // suggestion — the app is not guessing any more, it is being told, and there is nothing
  // for the user to confirm about a delegation Google has already recorded.
  ipcMain.on(IPC.ADD_DELEGATED, () => {
    void refreshDelegatedFromApi({ asked: true });
  });
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) p.color = arg.color;
    pushProfiles();
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    setSettingsPanelOpen(arg.open);
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  ipcMain.handle(IPC.MENU_POPUP, (e, items: NativeMenuItem[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    return popupNativeMenu(win, items);
  });
  ipcMain.on(IPC.SET_AUTO_START, (_e, v: boolean) => setAutoStart(v));
  ipcMain.on(IPC.SET_LAUNCH_MINIMIZED, (_e, v: boolean) => setLaunchMinimized(v));
  ipcMain.on(IPC.SET_APPEARANCE, (_e, patch: AppearancePatch) => {
    if (!prefs) return;
    prefs.setAppearance(patch ?? {});
    if (patch?.tray?.enabled !== undefined || patch?.tray?.color !== undefined) applyTraySetting();
    if (patch?.restrictMinWindowSize !== undefined) applyMinWindowSize();
    if (patch?.showUnreadBadges !== undefined) {
      refreshBadge();
      pushUnread();
    }
    pushPrefs();
  });
  ipcMain.on(IPC.SET_DOWNLOAD_PREFS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setDownloads((patch ?? {}) as Parameters<PrefsStore['setDownloads']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_PHISHING, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setPhishing((patch ?? {}) as Parameters<PrefsStore['setPhishing']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_UPDATE_PREFS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setUpdates((patch ?? {}) as Parameters<PrefsStore['setUpdates']>[0]);
    applyAutoUpdateCheck();
    pushPrefs();
  });
  ipcMain.on(IPC.SET_ADVANCED, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setAdvanced((patch ?? {}) as Parameters<PrefsStore['setAdvanced']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_EXTRAS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setNotificationExtras((patch ?? {}) as Parameters<PrefsStore['setNotificationExtras']>[0]);
    refreshNotifyAllowed();
    pushPrefs();
  });
  ipcMain.on(IPC.SET_VERIFICATION_CODES, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setVerificationCodes((patch ?? {}) as Parameters<PrefsStore['setVerificationCodes']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_GOOGLE_APPS, (_e, patch: unknown) => {
    if (!prefs) return;
    prefs.setGoogleApps((patch ?? {}) as Parameters<PrefsStore['setGoogleApps']>[0]);
    pushPrefs();
  });
  ipcMain.on(IPC.NOTIFY_TEST, () => showTestNotification());
  // Whatever a page has to say about itself. Tagged with the account when the sender is one
  // of the mail views, since "Gmail raised a notification" is only half an answer without
  // knowing which mailbox said it.
  ipcMain.on(IPC.VIEW_LOG, (e, message: unknown) => {
    if (typeof message !== 'string' || !message) return;
    const key = manager?.keyForWebContents(e.sender) ?? null;
    const who = profiles.find((p) => keyOf(p) === key)?.email ?? key ?? `view ${e.sender.id}`;
    notifyLog(`[view ${who}] ${message.slice(0, 300)}`);
  });
  // The page is listening and wants the stack. This is the handshake that matters; the
  // did-finish-load one is kept because it costs nothing and covers a page that somehow
  // never asks.
  ipcMain.on(IPC.TOAST_READY, () => toasts?.markReady());
  ipcMain.on(IPC.TOAST_SIZE, (_e, size: { width: number; height: number }) =>
    toasts?.applySize(size.width, size.height),
  );
  ipcMain.on(IPC.TOAST_ACTIVATE, (_e, id: string) =>
    id === 'summary' ? toasts?.activateSummary() : toasts?.activate(id),
  );
  ipcMain.on(IPC.TOAST_DISMISS, (_e, id: string) => toasts?.dismiss(id));
  ipcMain.on(IPC.TOAST_DISMISS_ALL, () => toasts?.dismissAll());
  ipcMain.on(IPC.TOAST_ACTION, (_e, arg: { id: string; action: ToastAction }) =>
    toasts?.runAction(arg.id, arg.action),
  );
  ipcMain.on(IPC.TOAST_HOVER, (_e, hovered: boolean) => toasts?.setHovered(Boolean(hovered)));
  // Gmail raised a notification in one of its views. The account comes from which view
  // sent it, never from the page, and the privacy replacement is applied here so that one
  // place decides it for both notification paths. Push-covered accounts never get here:
  // notificationsAllowed already told that view to keep quiet.
  ipcMain.on(IPC.WEB_NOTIFY_SHOW, (e, arg: { id: string; title: string; body: string }) => {
    if (!prefs) return;
    // The id is template-stringified into the source key, so any type would be accepted
    // and would file the click under a name nothing can look up again. Checked the same
    // way profile-view-manager checks NOTIFICATION_ACTIVATE's thread id, and for the same
    // reason: what is on the other end of this channel is Google's page, not ours.
    if (typeof arg?.id !== 'string') {
      notifyLog(`[notify] a view raised a notification with a ${typeof arg?.id} id — dropped`);
      return;
    }
    const accountKey = manager?.keyForWebContents(e.sender) ?? null;
    const profile = accountKey ? profiles.find((p) => keyOf(p) === accountKey) : undefined;
    // Both of these are silent losses, and both have a cause worth naming: a view the
    // manager no longer recognises (it was discarded, or it is a pop-out), or an account
    // that has since been removed.
    if (!profile) {
      notifyLog(
        `[notify] a notification arrived from a view with no account (key=${accountKey ?? 'unknown'}) — dropped`,
      );
      return;
    }
    const p = prefs.getAll();
    const hidden = hiddenNotificationText(p);
    const L = nativeLabels(currentLocale(), p.reneMode === true);
    const sourceKey = webNotifySourceKey(e.sender.id, arg.id);
    // Kept as Gmail wrote it, which is not what the card will show: the privacy settings
    // may replace both lines below, and the API is asked about the mail, not about the
    // card. Coerced because this is Google's page on the other end and `title: string` is
    // the signature, not a promise.
    const notified: NotifiedMail = { sender: String(arg.title ?? ''), subject: String(arg.body ?? '') };
    rememberWebNotifySource(sourceKey, { wc: e.sender, pageId: arg.id, email: profile.email, notified });
    // The other path: Gmail's own page, which sends no thread id, so a click has to work
    // out which mail this was — the API first, the page's DOM after. Paired with the line
    // whichever of the two answered writes on that click.
    notifyLog(
      `[notify] raise web ${profile.email} src=${sourceKey} subject=${JSON.stringify(notified.subject.slice(0, 60))}` +
        ` persist=${notificationPersist(p, profile.email)} silent=${notificationSilent(p, profile.email, 'mail')}` +
        `${hidden.hiddenSender || hidden.hiddenSubject ? ' (text hidden by the privacy settings)' : ''}`,
    );
    showToast({
      kind: 'mail',
      title: hidden.hiddenSender ?? arg.title,
      body: hidden.hiddenSubject ?? (arg.body || L.noSubject),
      account: toastAccountFor(profile.email),
      webNotifyId: sourceKey,
      persist: notificationPersist(p, profile.email),
    });
    if (!notificationSilent(p, profile.email, 'mail')) playNotificationSound(p);
    // Gmail's page just said mail arrived, which is the one thing the relay was subscribed
    // to hear. So the API side is told the same way: the sync that copies a verification
    // code and moves the history cursor runs now, rather than up to five minutes from now.
    void syncRunnerFor(profile.email)?.run();
  });
  ipcMain.handle(IPC.DOWNLOAD_FOLDER_PICK, async () => {
    const current = downloadFolder();
    const res = await dialog.showOpenDialog({
      title: 'Downloads',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return current;
    prefs?.setDownloads({ folder: res.filePaths[0] });
    pushPrefs();
    return res.filePaths[0];
  });
  ipcMain.handle(IPC.DOWNLOAD_HISTORY_GET, () => downloadHistory?.all() ?? []);
  ipcMain.on(IPC.DOWNLOAD_HISTORY_CLEAR, () => {
    downloadHistory?.clear();
    mainWindow?.webContents.send(IPC.DOWNLOAD_HISTORY_CHANGED);
  });
  ipcMain.on(IPC.DOWNLOAD_HISTORY_REVEAL, (_e, path: unknown) => {
    if (typeof path === 'string' && knownDownloadPath(path)) shell.showItemInFolder(path);
  });
  ipcMain.on(IPC.DOWNLOAD_HISTORY_OPEN, (_e, path: unknown) => {
    if (typeof path === 'string' && knownDownloadPath(path)) void shell.openPath(path);
  });
  ipcMain.on(IPC.SET_DEFAULT_MAIL, () => requestDefaultMail());
  ipcMain.handle(IPC.MAIL_DROP_PREVIEW_GET, () => dropPreviewItems());
  ipcMain.on(IPC.MAIL_DROP_PREVIEW_CLOSE, () => closeDropPreview());
  ipcMain.handle(IPC.LABELS_GET, () => labelsForCopyTargets());
  ipcMain.handle(IPC.MAIL_DROP_EXISTING_GET, () => existingForCopyTargets());
  ipcMain.handle(IPC.MAIL_DROP_COPY, (_e, arg: { targets: MailDropCopyTarget[]; mode?: CopyMode }) =>
    copyToMailboxes(arg),
  );
  // The bar asks once it is listening, because ACTIVE_CHANGED for the first view is sent
  // from did-finish-load — before the React tree that would hear it has mounted.
  ipcMain.handle(IPC.ACTIVE_GET, () => activeTab());
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
  ipcMain.handle(IPC.OAUTH_STATUS_GET, () => ({
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  }));
  // Setting the machine up from inside the app, because the alternative is what happened:
  // an install where nothing links and nothing says why, fixed by someone else copying a
  // file into AppData. The file is written through byte for byte — see oauth-config-file.ts
  // for why rebuilding it from the fields we validate would quietly break push.
  ipcMain.handle(IPC.OAUTH_CONFIG_IMPORT, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    let checked;
    try {
      checked = checkOAuthConfigFile(readFileSync(res.filePaths[0], 'utf8'));
    } catch {
      // Unreadable is the same answer as unusable to whoever picked it.
      return { ok: false, invalid: true };
    }
    if (!checked.ok) return { ok: false, invalid: true };
    try {
      mkdirSync(dirname(OAUTH_CONFIG_PATH), { recursive: true });
      writeFileSync(OAUTH_CONFIG_PATH, checked.text, 'utf8');
    } catch (e) {
      console.warn('[oauth] could not write the config:', e);
      return { ok: false, invalid: true };
    }
    // Nothing caches the config — oauthConfig() re-reads it — so the app is linkable from
    // here on. The health check republishes the statuses, which turns every account into a
    // Verbinden button, and the API sync can start now that there is a token to sign with.
    void checkOAuthHealth();
    startMailSync();
    return { ok: true };
  });
  ipcMain.handle(IPC.OAUTH_RECONNECT, async (_e, arg: { email: string }) => {
    const cfg = oauthConfig();
    if (!cfg || !oauthTokens || !mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'Koppeling niet ingesteld' };
    }
    const result = await connectAccount(mainWindow, SESSION_PARTITION, cfg, oauthTokens, arg.email);
    if (!result.ok) return result;
    clearRefreshFailure(arg.email);
    clearPushRefusal(arg.email);
    void checkOAuthHealth();
    startMailSync();
    return { ok: true };
  });
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_GET, () => mailDropFolder());
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_PICK, async () => {
    const current = mailDropFolder();
    if (!mainWindow || mainWindow.isDestroyed()) return current;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return current;
    prefs?.setMailDropFolder(res.filePaths[0]);
    return res.filePaths[0];
  });
  ipcMain.on(IPC.MAIL_DROP_FOLDER_OPEN, () => {
    const dir = mailDropFolder();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
    }
    void shell.openPath(dir);
  });
  ipcMain.on(IPC.SET_SNOOZE, (_e, minutes: number | null) => setSnooze(minutes));
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }) => {
    const patch: Record<string, unknown> = {};
    if ('label' in arg) patch.label = arg.label;
    if ('notify' in arg) patch.notify = arg.notify;
    if ('calendarNotify' in arg) patch.calendarNotify = arg.calendarNotify;
    if ('badgeCount' in arg) patch.badgeCount = arg.badgeCount;
    if ('notifySound' in arg) patch.notifySound = arg.notifySound;
    if ('notifyPersist' in arg) patch.notifyPersist = arg.notifyPersist;
    prefs!.setAccount(arg.email, patch);
    pushProfiles();
    pushPrefs();
    refreshNotifyAllowed();
    startMailSync();
    syncCalendarViews();
    refreshBadge();
  });
  ipcMain.on(IPC.SET_ACCOUNT_ORDER, (_e, arg: { emails: string[] }) => {
    prefs!.setOrder(arg.emails);
    pushProfiles();
  });
  ipcMain.on(
    IPC.SET_NOTIFICATIONS,
    (_e, arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }) => {
      prefs!.setNotifications(mergeNotificationsFromPanel(prefs!.getAll().notifications, arg));
      pushPrefs();
      refreshNotifyAllowed();
      refreshTray();
    },
  );
  ipcMain.on(IPC.SET_THEME, (_e, theme: 'system' | 'light' | 'dark') => {
    prefs!.setTheme(theme);
    pushPrefs();
    applyTitleBarOverlay();
    // The stack is its own window, so pushPrefs does not reach it: it draws from the state
    // the controller sends and nothing else. A card already on screen when the theme is
    // switched would otherwise keep the old one until it is dismissed.
    toasts?.refresh();
  });
  ipcMain.on(IPC.SET_LANGUAGE, (_e, v: LanguagePref) => {
    if (v !== 'system' && v !== 'en' && v !== 'nl') return;
    prefs!.setLanguage(v);
    pushPrefs();
    toasts?.refresh();
  });
  ipcMain.on(IPC.SET_NOTIFICATION_OPEN, (_e, v: 'app' | 'window') => {
    prefs!.setNotificationOpen(v);
    pushPrefs();
  });
  ipcMain.on(IPC.SET_RENE_MODE, (_e, v: boolean) => {
    prefs!.setReneMode(v === true);
    applyReneZoom();
    pushPrefs();
    // applyReneZoom only reaches the main window and the profile views. The toast window
    // is created lazily and then lives for the session, so it has to be told separately,
    // and refresh() on its own is not enough: re-sending the stack makes the page lay out
    // again but the CSS did not change, so it reports the same numbers into a window whose
    // factor moved underneath them.
    toastWindow?.applyZoom();
    toasts?.refresh();
  });
  ipcMain.handle(IPC.CHANGELOG_GET, () => loadChangelog());
  // One handler for the life of the app, not `ipcMain.once` per open: a `once` listener
  // left registered by a cancelled dialog would answer the next one instead, a bug that
  // only shows up on the third mailto:.
  ipcMain.on(IPC.COMPOSE_ACCOUNT_PICK, (_e, index: number | null) => {
    settleComposeAsk(typeof index === 'number' ? index : null);
  });
  ipcMain.on(IPC.COMPOSE_ACCOUNT_SIZE, (e, size: { width: number; height: number }) =>
    applyComposeAskSize(e.sender, size.width, size.height),
  );
}

