// The contextBridge surface of the sidebar page. That same page also runs as the
// modal overlay, told apart by the --gmd-overlay argument main sets on that view
// only. Preference patches are typed unknown on purpose: main revalidates them with
// the same readers it uses for the file on disk, so a wrong value falls back to a
// default there instead of being caught here. The renderer holds the real types.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './core/ipc';
import type { Surface } from '../renderer/lib/surfaces';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import type { ReconnectAccount } from './auth/oauth-health';
import type { OAuthStatusReport } from '../renderer/lib/oauth-status';


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
  redetect: (): void => ipcRenderer.send(IPC.REDETECT),
  addAccount: (): void => ipcRenderer.send(IPC.ADD_ACCOUNT),
  addDelegated: (): void => ipcRenderer.send(IPC.ADD_DELEGATED),
  setColor: (email: string, color: string): void =>
    ipcRenderer.send(IPC.SET_COLOR, { email, color }),
  removeAccount: (email: string): void => ipcRenderer.send(IPC.REMOVE_ACCOUNT, { email }),
  checkForUpdate: (): void => ipcRenderer.send(IPC.UPDATE_CHECK),
  downloadUpdate: (): void => ipcRenderer.send(IPC.UPDATE_DOWNLOAD),
  installUpdate: (): void => ipcRenderer.send(IPC.UPDATE_INSTALL),
  onUpdateStatus: (cb: (status: unknown) => void): void => {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_e, status) => cb(status));
  },
  toggleSettings: (open: boolean): void => ipcRenderer.send(IPC.SETTINGS_TOGGLE, { open }),
  popupMenu: (items: NativeMenuItem[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.MENU_POPUP, items),
  onSettingsForceClose: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_CLOSE, () => cb());
  },
  onSettingsForceOpen: (cb: () => void): void => {
    ipcRenderer.on(IPC.SETTINGS_FORCE_OPEN, () => cb());
  },
  setAutoStart: (v: boolean): void => ipcRenderer.send(IPC.SET_AUTO_START, v),
  setLaunchMinimized: (v: boolean): void => ipcRenderer.send(IPC.SET_LAUNCH_MINIMIZED, v),
  setAppearance: (patch: unknown): void => ipcRenderer.send(IPC.SET_APPEARANCE, patch),
  setDownloadPrefs: (patch: unknown): void => ipcRenderer.send(IPC.SET_DOWNLOAD_PREFS, patch),
  setPhishing: (patch: unknown): void => ipcRenderer.send(IPC.SET_PHISHING, patch),
  setUpdatePrefs: (patch: unknown): void => ipcRenderer.send(IPC.SET_UPDATE_PREFS, patch),
  setAdvanced: (patch: unknown): void => ipcRenderer.send(IPC.SET_ADVANCED, patch),
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
  onMailDropPreview: (cb: (arg: { items: unknown[] }) => void): void => {
    ipcRenderer.on(IPC.MAIL_DROP_PREVIEW, (_e, arg) => cb(arg));
  },
  closeMailDropPreview: (): void => ipcRenderer.send(IPC.MAIL_DROP_PREVIEW_CLOSE),
  getMailDropPreview: (): Promise<{ items: unknown[] }> =>
    ipcRenderer.invoke(IPC.MAIL_DROP_PREVIEW_GET),
  getLabels: (): Promise<{ accounts: unknown[] }> => ipcRenderer.invoke(IPC.LABELS_GET),
  copyMailDrop: (
    targets: Array<{ email: string; labelIds: string[] }>,
    mode?: 'check' | 'new' | 'all',
  ): Promise<unknown> => ipcRenderer.invoke(IPC.MAIL_DROP_COPY, { targets, mode }),
  onMailDropCopyProgress: (cb: (arg: unknown) => void): void => {
    ipcRenderer.on(IPC.MAIL_DROP_COPY_PROGRESS, (_e, arg) => cb(arg));
  },
  onReconnectList: (cb: (arg: { accounts: ReconnectAccount[] }) => void): void => {
    ipcRenderer.on(IPC.OAUTH_RECONNECT_LIST, (_e, arg) => cb(arg));
  },
  getReconnectList: (): Promise<{ accounts: ReconnectAccount[] }> =>
    ipcRenderer.invoke(IPC.OAUTH_RECONNECT_GET),
  reconnectOAuth: (email: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.OAUTH_RECONNECT, { email }),
  getOAuthStatus: (): Promise<OAuthStatusReport> => ipcRenderer.invoke(IPC.OAUTH_STATUS_GET),
  // Picks a google-oauth.json and installs it, for a machine that has none. `invalid` is
  // absent when the picker was simply cancelled, which is not a failure to report.
  importOAuthConfig: (): Promise<{ ok: boolean; invalid?: boolean }> =>
    ipcRenderer.invoke(IPC.OAUTH_CONFIG_IMPORT),
  // Pushed after every health check. Paired with the get above because main may have sent
  // a list before the settings panel existed — the same reason the reconnect page does both.
  onOAuthStatus: (cb: (arg: OAuthStatusReport) => void): void => {
    ipcRenderer.on(IPC.OAUTH_STATUS_CHANGED, (_e, arg) => cb(arg));
  },
  getMailDropFolder: (): Promise<string> => ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_GET),
  pickMailDropFolder: (): Promise<string> => ipcRenderer.invoke(IPC.MAIL_DROP_FOLDER_PICK),
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
  // Main watching the cursor leave the stack, which is the one way the page can learn
  // that a hover ended when the pointer left the window without an event to say so.
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
