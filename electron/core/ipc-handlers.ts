// Every channel the renderer can reach the main process on, in one table.
//
// The handlers stay thin: validate what arrived, call the module that owns the job, send
// back what it returns. What comes down these channels is not all ours — WEB_NOTIFY_SHOW
// carries whatever Gmail's page passed the Notification constructor, so it is checked.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
import { IPC, type MailDropCopyControlAction, type MailDropCopyTarget } from './ipc';
import type { CopyStopMode } from '../mail/copy-run-types';
import { writeFileAtomic } from './json-store';
import { OAUTH_CONFIG_PATH } from './paths';
import { SESSION_PARTITION } from './session-partition';
import { activeTab, colors, currentLocale, downloadHistory, hidden, mainWindow, manager, oauthStatuses, oauthTokens, prefs, profiles, keyOf, recentLabels, reconnectAccounts, setSettingsPanelOpen, settingsPanelOpen, startedWithoutAccounts, toastWindow, toasts } from './runtime';
import { pushPrefs, pushProfiles, pushUnread, refreshBadge } from './broadcast';
import { type LanguagePref } from './locale';
import { type AccountPref, type AppearancePatch, type PrefsStore } from './prefs-store';
import { addAccount, redetect, removeAccount, unhideAccount } from '../accounts/detection-controller';
import {
  applyDelegatedPick,
  closeDelegatedPicker,
  openDelegatedPicker,
} from '../delegation/delegated-picker';
import {
  cancelMailDropPull,
  closeDropPreview,
  controlCopyRun,
  copyToMailboxes,
  decideJobRun,
  decideOrphanRun,
  dropPreviewItems,
  existingForCopyTargets,
  labelsForCopyTargets,
  mailDropFolder,
  mailDropStatus,
  pendingJobDecision,
  pendingOrphanDecision,
} from '../mail/mail-drop-controller';
import { countLabelForPurge, purgeCountedLabel } from '../mail/label-purge-controller';
import { type CopyMode } from '../mail/mail-copy';
import { applyComposeAskSize, settleComposeAsk } from '../compose/mailto-controller';
import { openFeedbackCompose } from '../feedback/feedback-controller';
import { openSurfaceForAccount, showTestNotification } from '../windows/surface-opener';
import { applyViewBudget, syncCalendarViews } from '../windows/view-surfaces';
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
import { applyTraySetting, refreshTray } from '../menus/tray-setup';
import { popupNativeMenu, type MenuAnchor } from '../menus/native-menu';
import { nativeLabels } from '../menus/native-labels';
import {
  applyAutoUpdateCheck,
  applyUpdateChannel,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  loadChangelog,
} from '../updates/update-controller';
import { checkOAuthHealth, clearRefreshFailure } from '../auth/oauth-health-check';
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
  ipcMain.on(IPC.ADD_DELEGATED, () => openDelegatedPicker());
  ipcMain.on(IPC.DELEGATED_PICK, (_e, arg: { emails: string[] }) => {
    applyDelegatedPick(Array.isArray(arg?.emails) ? arg.emails : []);
  });
  ipcMain.on(IPC.DELEGATED_PICK_CLOSE, () => closeDelegatedPicker());
  ipcMain.on(IPC.SET_COLOR, (_e, arg: { email: string; color: string }) => {
    colors!.set(arg.email, arg.color);
    const p = profiles.find((x) => x.email === arg.email);
    if (p) p.color = arg.color;
    pushProfiles();
  });
  ipcMain.on(IPC.REMOVE_ACCOUNT, (_e, arg: { email: string }) => removeAccount(arg.email));
  ipcMain.handle(IPC.HIDDEN_GET, () => hidden?.list() ?? []);
  ipcMain.on(IPC.UNHIDE_ACCOUNT, (_e, arg: { email: string }) => unhideAccount(arg.email));
  ipcMain.on(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.on(IPC.UPDATE_INSTALL, () => installUpdate());
  ipcMain.on(IPC.SETTINGS_TOGGLE, (_e, arg: { open: boolean }) => {
    setSettingsPanelOpen(arg.open);
    if (arg.open) manager?.hideAll();
    else manager?.showActive();
  });
  // The tour draws in the renderer page, and the Gmail views are painted on top of it, so
  // they have to be out of the way or the tour is invisible. Same two calls the settings
  // panel makes. The settingsPanelOpen guard is what stops a tour that ends while the panel
  // happens to be open from painting Gmail over the panel.
  ipcMain.on(IPC.TOUR_ACTIVE, (_e, arg: { active: boolean }) => {
    // Logged because the one way this feature fails is invisibly: the tour draws in the
    // renderer page and every Gmail view is painted over it, so a hide that does not arrive
    // looks exactly like a tour that never started.
    console.info(`[tour] views ${arg.active ? 'hidden' : 'shown'}`);
    if (arg.active) manager?.hideAll();
    else if (!settingsPanelOpen) manager?.showActive();
  });
  // Asked rather than pushed: the renderer can ask whenever it is ready, so there is no race
  // between this answer and the first profiles push. Logged for the same reason the line above
  // is: a tour that never arms is indistinguishable from a tour that never triggers.
  ipcMain.handle(IPC.TOUR_FIRST_RUN, () => {
    console.info(`[tour] first run: ${startedWithoutAccounts}`);
    return startedWithoutAccounts;
  });
  ipcMain.on(IPC.SET_TOUR_SEEN, (_e, v: boolean) => {
    if (!prefs) return;
    prefs.setTour({ seen: v });
    pushPrefs();
  });
  ipcMain.handle(IPC.MENU_POPUP, (e, items: NativeMenuItem[], anchor?: MenuAnchor) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    return popupNativeMenu(win, items, anchor);
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
    const next = (patch ?? {}) as Parameters<PrefsStore['setUpdates']>[0];
    prefs.setUpdates(next);
    applyUpdateChannel();
    applyAutoUpdateCheck();
    pushPrefs();
    // Switching channel is worth answering straight away: turning prereleases on with a beta
    // already published should show it now, not at the next half-hourly check.
    if (typeof next.allowPrerelease === 'boolean') checkForUpdate({ background: true });
  });
  ipcMain.handle(IPC.FEEDBACK_COMPOSE, (_e, input: unknown) => {
    const { text, includeDiagnostics } = (input ?? {}) as {
      text?: unknown;
      includeDiagnostics?: unknown;
    };
    return openFeedbackCompose({
      text: typeof text === 'string' ? text : '',
      includeDiagnostics: includeDiagnostics === true,
    });
  });
  ipcMain.on(IPC.SET_ADVANCED, (_e, patch: unknown) => {
    if (!prefs) return;
    const next = (patch ?? {}) as Parameters<PrefsStore['setAdvanced']>[0];
    prefs.setAdvanced(next);
    // Hardware acceleration needs a restart; the memory setting does not, so it is applied
    // here rather than left until the next launch.
    if (next.lowMemory !== undefined) applyViewBudget();
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
  ipcMain.on(IPC.VIEW_LOG, (e, message: unknown) => {
    if (typeof message !== 'string' || !message) return;
    const key = manager?.keyForWebContents(e.sender) ?? null;
    const who = profiles.find((p) => keyOf(p) === key)?.email ?? key ?? `view ${e.sender.id}`;
    notifyLog(`[view ${who}] ${message.slice(0, 300)}`);
  });
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

  ipcMain.on(IPC.WEB_NOTIFY_SHOW, (e, arg: { id: string; title: string; body: string }) => {
    if (!prefs) return;

    if (typeof arg?.id !== 'string') {
      notifyLog(`[notify] a view raised a notification with a ${typeof arg?.id} id — dropped`);
      return;
    }
    const accountKey = manager?.keyForWebContents(e.sender) ?? null;
    const profile = accountKey ? profiles.find((p) => keyOf(p) === accountKey) : undefined;
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
    const notified: NotifiedMail = { sender: String(arg.title ?? ''), subject: String(arg.body ?? '') };
    rememberWebNotifySource(sourceKey, { wc: e.sender, pageId: arg.id, email: profile.email, notified });
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
  ipcMain.on(IPC.MAIL_DROP_PULL_CANCEL, () => cancelMailDropPull());
  ipcMain.handle(IPC.LABELS_GET, () => labelsForCopyTargets());
  ipcMain.handle(IPC.LABEL_PURGE_COUNT, (_e, arg: { email: string; label: string }) =>
    countLabelForPurge(arg.email, arg.label),
  );
  ipcMain.handle(IPC.LABEL_PURGE_RUN, (_e, arg: { handle: string; labels: string[] }) =>
    purgeCountedLabel(arg.handle, arg.labels),
  );
  ipcMain.handle(IPC.MAIL_DROP_EXISTING_GET, () => existingForCopyTargets());
  ipcMain.handle(IPC.MAIL_DROP_RECENT_GET, () => recentLabels?.today() ?? []);
  ipcMain.handle(IPC.MAIL_DROP_COPY, (_e, arg: { targets: MailDropCopyTarget[]; mode?: CopyMode }) =>
    copyToMailboxes(arg),
  );
  ipcMain.handle(IPC.MAIL_DROP_COPY_CONTROL, (_e, arg: { action: MailDropCopyControlAction }) =>
    controlCopyRun(arg?.action),
  );
  ipcMain.handle(IPC.MAIL_DROP_ORPHAN_GET, () => pendingOrphanDecision());
  ipcMain.handle(IPC.MAIL_DROP_ORPHAN_DECIDE, (_e, arg: { runId: string; mode: CopyStopMode }) =>
    decideOrphanRun(arg?.runId, arg?.mode),
  );
  ipcMain.handle(IPC.MAIL_DROP_JOB_GET, () => pendingJobDecision());
  ipcMain.handle(
    IPC.MAIL_DROP_JOB_DECIDE,
    (_e, arg: { jobId: string; choice: 'continue' | 'keep' | 'rollback' }) =>
      decideJobRun(arg.jobId, arg.choice),
  );
  ipcMain.handle(IPC.ACTIVE_GET, () => activeTab());
  ipcMain.handle(IPC.OAUTH_RECONNECT_GET, () => ({ accounts: reconnectAccounts }));
  ipcMain.handle(IPC.OAUTH_STATUS_GET, () => ({
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  }));
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
      return { ok: false, invalid: true };
    }
    if (!checked.ok) return { ok: false, invalid: true };
    try {
      writeFileAtomic(OAUTH_CONFIG_PATH, checked.text);
    } catch (e) {
      console.warn('[oauth] could not write the config:', e);
      return { ok: false, invalid: true };
    }
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
    void checkOAuthHealth();
    startMailSync();
    return { ok: true };
  });
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_GET, () => mailDropStatus());
  ipcMain.handle(IPC.MAIL_DROP_FOLDER_PICK, async () => {
    const current = mailDropStatus();
    if (!mainWindow || mainWindow.isDestroyed()) return current;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath: current.folder,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return current;
    prefs?.setMailDropFolder(res.filePaths[0]);
    const picked = mailDropStatus();
    // In the log as well as on the page: the page says it while it is open, and this is the
    // record of when the mail started leaving the machine again.
    if (picked.remote) {
      notifyLog(`[maildrop] chosen folder is on a network or sync location: ${picked.folder}`);
    }
    return picked;
  });
  ipcMain.on(IPC.MAIL_DROP_FOLDER_OPEN, () => {
    const dir = mailDropFolder();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
    }
    void shell.openPath(dir);
  });
  const ACCOUNT_PREF_KEYS = [
    'label',
    'notify',
    'calendarNotify',
    'badgeCount',
    'notifySound',
    'notifyPersist',
  ] as const;
  ipcMain.on(IPC.SET_ACCOUNT_PREF, (_e, arg: { email: string } & Partial<AccountPref>) => {
    const patch: Partial<AccountPref> = {};
    for (const key of ACCOUNT_PREF_KEYS) {
      if (key in arg) (patch as Record<string, unknown>)[key] = arg[key];
    }
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

    toastWindow?.applyZoom();
    toasts?.refresh();
  });
  ipcMain.handle(IPC.CHANGELOG_GET, () => loadChangelog());
  ipcMain.on(IPC.COMPOSE_ACCOUNT_PICK, (_e, index: number | null) => {
    settleComposeAsk(typeof index === 'number' ? index : null);
  });
  ipcMain.on(IPC.COMPOSE_ACCOUNT_SIZE, (e, size: { width: number; height: number }) =>
    applyComposeAskSize(e.sender, size.width, size.height),
  );
}

