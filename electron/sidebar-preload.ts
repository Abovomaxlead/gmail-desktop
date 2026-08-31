// The contextBridge surface of the sidebar page. That same page also runs as the
// modal overlay, told apart by the --gmd-overlay argument main sets on that view
// only. Preference patches are typed unknown on purpose: main revalidates them with
// the same readers it uses for the file on disk, so a wrong value falls back to a
// default there instead of being caught here. The renderer holds the real types.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MailDropFolderStatus } from './core/ipc';
import type { Surface } from '../renderer/lib/surfaces';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import type { ReconnectAccount } from './auth/oauth-health';
import type { OAuthStatusReport } from '../renderer/lib/oauth-status';
import type { HiddenAccount } from '../renderer/lib/hidden-accounts';
import type { RecentLabelUse } from '../renderer/app/recent-labels';


//===========================
// Types
//===========================

interface Profile {
  key: string;
  kind: 'authuser' | 'delegated';
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}


//===========================
// Constants
//===========================

// the same page runs as the modal overlay, told apart by the argument main sets on that
// view only
const isOverlay = process.argv.includes('--gmd-overlay');


//===========================
// Bridge
//===========================

contextBridge.exposeInMainWorld('desktop', {
  isOverlay,
  onProfilesChanged: (cb: (profiles: Profile[]) => void): void => {
    ipcRenderer.on(IPC.PROFILES_CHANGED, (_e, profiles) => cb(profiles));
  },
  onUnreadChanged: (cb: (counts: Record<string, number>) => void): void => {
    ipcRenderer.on(IPC.UNREAD_CHANGED, (_e, counts) => cb(counts));
  },
  switchSurface: (key: string, surface: Surface): void =>
    ipcRenderer.send(IPC.SWITCH_SURFACE, { key, surface }),
  onActiveChanged: (cb: (active: { key: string; surface: Surface } | null) => void): void => {
    ipcRenderer.on(IPC.ACTIVE_CHANGED, (_e, active) => cb(active));
  },
  getActive: (): Promise<{ key: string; surface: Surface } | null> =>
    ipcRenderer.invoke(IPC.ACTIVE_GET),
  redetect: (): void => ipcRenderer.send(IPC.REDETECT),
  addAccount: (): void => ipcRenderer.send(IPC.ADD_ACCOUNT),
  addDelegated: (): void => ipcRenderer.send(IPC.ADD_DELEGATED),
  setColor: (email: string, color: string): void =>
    ipcRenderer.send(IPC.SET_COLOR, { email, color }),
  removeAccount: (email: string): void => ipcRenderer.send(IPC.REMOVE_ACCOUNT, { email }),
  getHiddenAccounts: (): Promise<HiddenAccount[]> => ipcRenderer.invoke(IPC.HIDDEN_GET),
  unhideAccount: (email: string): void => ipcRenderer.send(IPC.UNHIDE_ACCOUNT, { email }),
  onHiddenAccounts: (cb: (arg: HiddenAccount[]) => void): void => {
    ipcRenderer.on(IPC.HIDDEN_CHANGED, (_e, arg) => cb(arg));
  },
  checkForUpdate: (): void => ipcRenderer.send(IPC.UPDATE_CHECK),
  downloadUpdate: (): void => ipcRenderer.send(IPC.UPDATE_DOWNLOAD),
  installUpdate: (): void => ipcRenderer.send(IPC.UPDATE_INSTALL),
  onUpdateStatus: (cb: (status: unknown) => void): void => {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_e, status) => cb(status));
  },
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  setTourActive: (active: boolean): void => ipcRenderer.send(IPC.TOUR_ACTIVE, { active }),
  isFirstRun: (): Promise<boolean> => ipcRenderer.invoke(IPC.TOUR_FIRST_RUN),
  setTourSeen: (v: boolean): void => ipcRenderer.send(IPC.SET_TOUR_SEEN, v),
  popupMenu: (items: NativeMenuItem[], anchor?: { x: number; y: number }): Promise<string | null> =>
    ipcRenderer.invoke(IPC.MENU_POPUP, items, anchor),
  onSettingsForceClose: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_CLOSE, () => cb());
  },
  // The section is optional: the tray and the toolbar send you to one, a plain reopen does not.
  onSettingsForceOpen: (cb: (section?: string) => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_OPEN, (_e, arg) => cb((arg as { section?: string })?.section));
  },
  sendFeedback: (input: { text: string; includeDiagnostics: boolean }): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FEEDBACK_COMPOSE, input),
  setAutoStart: (v: boolean): void => ipcRenderer.send(IPC.SET_AUTO_START, v),
  setLaunchMinimized: (v: boolean): void => ipcRenderer.send(IPC.SET_LAUNCH_MINIMIZED, v),
  setAppearance: (patch: unknown): void => ipcRenderer.send(IPC.SET_APPEARANCE, patch),
  setDownloadPrefs: (patch: unknown): void => ipcRenderer.send(IPC.SET_DOWNLOAD_PREFS, patch),
  setPhishing: (patch: unknown): void => ipcRenderer.send(IPC.SET_PHISHING, patch),
  setUpdatePrefs: (patch: unknown): void => ipcRenderer.send(IPC.SET_UPDATE_PREFS, patch),
  setAdvanced: (patch: unknown): void => ipcRenderer.send(IPC.SET_ADVANCED, patch),
  countLabelPurge: (
    email: string,
    label: string,
  ): Promise<
    | {
        handle: string;
        email: string;
        label: string;
        labels: { name: string; labelId: string; messages: number }[];
        total: number;
        capped: boolean;
      }
    | { error: string }
  > => ipcRenderer.invoke(IPC.LABEL_PURGE_COUNT, { email, label }),
  runLabelPurge: (
    handle: string,
    labels: string[],
  ): Promise<{ trashed: number; failed: number; error?: string }> =>
    ipcRenderer.invoke(IPC.LABEL_PURGE_RUN, { handle, labels }),
  setVerificationCodes: (patch: unknown): void =>
    ipcRenderer.send(IPC.SET_VERIFICATION_CODES, patch),
  getDownloadHistory: (): Promise<unknown> => ipcRenderer.invoke(IPC.DOWNLOAD_HISTORY_GET),
  clearDownloadHistory: (): void => ipcRenderer.send(IPC.DOWNLOAD_HISTORY_CLEAR),
  revealDownload: (path: string): void => ipcRenderer.send(IPC.DOWNLOAD_HISTORY_REVEAL, path),
  openDownload: (path: string): void => ipcRenderer.send(IPC.DOWNLOAD_HISTORY_OPEN, path),
  onDownloadHistoryChanged: (cb: () => void): void => {
    ipcRenderer.on(IPC.DOWNLOAD_HISTORY_CHANGED, () => cb());
  },
  onPlayNotificationSound: (cb: (arg: { name: string; volume: number }) => void): void => {
    ipcRenderer.on(IPC.NOTIFY_SOUND_PLAY, (_e, arg) => cb(arg));
  },
  setGoogleApps: (patch: unknown): void => ipcRenderer.send(IPC.SET_GOOGLE_APPS, patch),
  setNotificationExtras: (patch: unknown): void =>
    ipcRenderer.send(IPC.SET_NOTIFICATION_EXTRAS, patch),
  testNotification: (): void => ipcRenderer.send(IPC.NOTIFY_TEST),
  pickDownloadFolder: (): Promise<string> => ipcRenderer.invoke(IPC.DOWNLOAD_FOLDER_PICK),
  onPrefsChanged: (cb: (prefs: unknown) => void): void => {
    ipcRenderer.on(IPC.PREFS_CHANGED, (_e, p) => cb(p));
  },
  setAccountPref: (arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_PREF, arg),
  setAccountOrder: (emails: string[]): void =>
    ipcRenderer.send(IPC.SET_ACCOUNT_ORDER, { emails }),
  setNotifications: (arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void =>
    ipcRenderer.send(IPC.SET_NOTIFICATIONS, arg),
  setTheme: (theme: 'system' | 'light' | 'dark'): void => ipcRenderer.send(IPC.SET_THEME, theme),
  setLanguage: (v: 'system' | 'en' | 'nl'): void => ipcRenderer.send(IPC.SET_LANGUAGE, v),
  setNotificationOpen: (v: 'app' | 'window'): void => ipcRenderer.send(IPC.SET_NOTIFICATION_OPEN, v),
  setReneMode: (v: boolean): void => ipcRenderer.send(IPC.SET_RENE_MODE, v),
  requestDefaultMail: (): void => ipcRenderer.send(IPC.SET_DEFAULT_MAIL),
  onMailDropPreview: (cb: (arg: { items: unknown[]; tree?: unknown }) => void): void => {
    ipcRenderer.on(IPC.MAIL_DROP_PREVIEW, (_e, arg) => cb(arg));
  },
  closeMailDropPreview: (): void => ipcRenderer.send(IPC.MAIL_DROP_PREVIEW_CLOSE),
  getMailDropPreview: (): Promise<{ items: unknown[]; tree?: unknown }> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_PREVIEW_GET),
  getLabels: (): Promise<{ accounts: unknown[] }> => ipcRenderer.invoke(IPC.LABELS_GET),
  getRecentLabels: (): Promise<RecentLabelUse[]> => ipcRenderer.invoke(IPC.MAIL_DROP_RECENT_GET),
  getMailDropExisting: (): Promise<{
    accounts: unknown[];
    scanned: number;
    serial: number;
    answered: number;
  }> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_EXISTING_GET),
  onMailDropExisting: (
    cb: (arg: { accounts: unknown[]; scanned: number; serial: number; answered: number }) => void,
  ): void => {
    ipcRenderer.on(IPC.MAIL_DROP_EXISTING, (_e, arg) => cb(arg));
  },
  copyMailDrop: (
    targets: Array<{ email: string; labelIds: string[] }>,
    mode?: 'check' | 'new' | 'all',
  ): Promise<unknown> => ipcRenderer.invoke(IPC.MAIL_DROP_COPY, { targets, mode }),
  onMailDropCopyProgress: (cb: (arg: unknown) => void): void => {
    ipcRenderer.on(IPC.MAIL_DROP_COPY_PROGRESS, (_e, arg) => cb(arg));
  },
  controlMailDropCopy: (
    action: 'pause' | 'resume' | 'stop-keep' | 'stop-rollback-batch' | 'stop-rollback-job',
  ): Promise<unknown> => ipcRenderer.invoke(IPC.MAIL_DROP_COPY_CONTROL, { action }),
  getPendingOrphan: (): Promise<{
    runId: string;
    byMailbox: { email: string; inserted: number }[];
  } | null> => ipcRenderer.invoke(IPC.MAIL_DROP_ORPHAN_GET),
  decideOrphanRun: (runId: string, mode: 'keep' | 'rollback'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_ORPHAN_DECIDE, { runId, mode }),
  getPendingJob: (): Promise<{
    jobId: string;
    label: string;
    batch: number;
    batches: number;
    done: number;
    total: number;
    mode: 'new' | 'all';
  } | null> => ipcRenderer.invoke(IPC.MAIL_DROP_JOB_GET),
  decideJobRun: (
    jobId: string,
    choice: 'continue' | 'keep' | 'rollback',
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.MAIL_DROP_JOB_DECIDE, { jobId, choice }),
  onReconnectList: (cb: (arg: { accounts: ReconnectAccount[] }) => void): void => {
    ipcRenderer.on(IPC.OAUTH_RECONNECT_LIST, (_e, arg) => cb(arg));
  },
  getReconnectList: (): Promise<{ accounts: ReconnectAccount[] }> =>
    ipcRenderer.invoke(IPC.OAUTH_RECONNECT_GET),
  reconnectOAuth: (email: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.OAUTH_RECONNECT, { email }),
  getOAuthStatus: (): Promise<OAuthStatusReport> => ipcRenderer.invoke(IPC.OAUTH_STATUS_GET),
  importOAuthConfig: (): Promise<{ ok: boolean; invalid?: boolean }> =>
    ipcRenderer.invoke(IPC.OAUTH_CONFIG_IMPORT),
  onOAuthStatus: (cb: (arg: OAuthStatusReport) => void): void => {
    ipcRenderer.on(IPC.OAUTH_STATUS_CHANGED, (_e, arg) => cb(arg));
  },
  getMailDropFolder: (): Promise<MailDropFolderStatus> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_GET),
  pickMailDropFolder: (): Promise<MailDropFolderStatus> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_PICK),
  openMailDropFolder: (): void => ipcRenderer.send(IPC.MAIL_DROP_FOLDER_OPEN),
  onDefaultMailStatus: (cb: (isDefault: boolean) => void): void => {
    ipcRenderer.on(IPC.MAIL_DEFAULT_STATUS, (_e, v) => cb(Boolean(v)));
  },
  getChangelog: (): Promise<unknown> => ipcRenderer.invoke(IPC.CHANGELOG_GET),
  onComposeAccountAsk: (cb: (arg: unknown) => void): void => {
    ipcRenderer.on(IPC.COMPOSE_ACCOUNT_ASK, (_e, arg) => cb(arg));
  },
  pickComposeAccount: (index: number | null): void =>
    ipcRenderer.send(IPC.COMPOSE_ACCOUNT_PICK, index),
  reportComposeAccountSize: (size: { width: number; height: number }): void =>
    ipcRenderer.send(IPC.COMPOSE_ACCOUNT_SIZE, size),
  onToastState: (cb: (state: unknown) => void): void => {
    ipcRenderer.on(IPC.TOAST_STATE, (_e, state) => cb(state));
  },
  onToastHoverEnd: (cb: () => void): void => {
    ipcRenderer.on(IPC.TOAST_HOVER_END, () => cb());
  },
  toastReady: (): void => ipcRenderer.send(IPC.TOAST_READY),
  reportToastSize: (size: { width: number; height: number }): void =>
    ipcRenderer.send(IPC.TOAST_SIZE, size),
  activateToast: (id: string): void => ipcRenderer.send(IPC.TOAST_ACTIVATE, id),
  dismissToast: (id: string): void => ipcRenderer.send(IPC.TOAST_DISMISS, id),
  dismissAllToasts: (): void => ipcRenderer.send(IPC.TOAST_DISMISS_ALL),
  runToastAction: (arg: { id: string; action: 'archive' | 'read' }): void =>
    ipcRenderer.send(IPC.TOAST_ACTION, arg),
  setToastHovered: (hovered: boolean): void => ipcRenderer.send(IPC.TOAST_HOVER, hovered),
});
