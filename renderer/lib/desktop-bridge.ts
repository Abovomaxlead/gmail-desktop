// The bridge the sidebar preload attaches to `window.desktop`, and the shapes it carries.
//
// The Prefs, UpdateState and DownloadRecord shapes are copied from electron/ rather than
// imported, because an `import type` from the main process pulls Electron into the renderer
// bundle. The mail-drop payload shapes below are the opposite: they already live in
// electron/core/ipc.ts and electron/mail/copy/mail-copy.ts, declared once and imported here,
// because those files carry no Electron-specific types of their own.
//
// Declared in renderer/lib rather than in a page, so every page that needs `window.desktop`
// -- the bar, the settings panel, the mail-drop picker, the toast window -- reaches it
// without importing another page's module.

import type { Surface } from './surfaces';
import type { WindowTabs } from './window-tabs';
import type { DelegatedPickerAsk } from './delegated-picker';
import type { HiddenAccount } from './hidden-accounts';
import type { NativeMenuItem } from './native-menu';
import type { ReleaseNotesAsk } from './release-notes';
import type { ComposeAccountAsk } from './compose-account';
import type { LabelPurgeCount, LabelPurgeResult } from './label-purge';
import type { RecentLabelUse } from './recent-labels';
import type { ReconnectAccount } from './reconnect';
import type { OAuthStatusReport } from './oauth-status';
import type { ChangelogVersion } from './changelog-types';
import type { ToastAction, ToastState } from './toast';
import type { PendingJob, PendingOrphan } from './maildrop-copy';
import type {
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyTarget,
  MailDropExisting,
  MailDropFolderStatus,
  MailDropPreview,
  MailDropPreviewItem,
} from '../../electron/core/ipc';
import type { CopyMode } from '../../electron/mail/copy/mail-copy';


//===========================
// Types
//===========================

export interface Profile {
  key: string;
  kind: 'authuser' | 'delegated';
  index: number;
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  hasCalendar: boolean;
  order?: number;
  label?: string;
  provisional?: boolean;
  hasMail?: boolean;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'no-release'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AccountPref {
  order?: number;
  label?: string;
  zoom?: number;
  notify?: boolean;
  calendarNotify?: boolean;
  badgeCount?: boolean;
  notifySound?: boolean;
  notifyPersist?: boolean;
}
export interface Prefs {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean };
  autoStart: boolean;
  launchMinimized: boolean;
  theme: 'system' | 'light' | 'dark';
  notificationOpen: 'app' | 'window';
  notifications: {
    dnd: boolean;
    dndUntil?: number;
    quietHours: { enabled: boolean; start: string; end: string };
    showSender: boolean;
    showSubject: boolean;
    sound: boolean;
    soundName: string;
    volume: number;
    googleApps: boolean;
  };
  accounts: Record<string, AccountPref>;
  mailDrop: { folder: string };
  appearance: {
    showUnreadBadges: boolean;
    tray: { enabled: boolean; selectUnreadOnClick: boolean; color: 'system' | 'light' | 'dark' };
    restrictMinWindowSize: boolean;
  };
  downloads: {
    folder: string;
    saveAsDialog: boolean;
    openFolderWhenDone: boolean;
    notify: boolean;
    notifyClick: DownloadClickAction;
  };
  phishing: { confirmExternalLinks: boolean; trustedHosts: string[] };
  updates: { autoCheck: boolean; notify: boolean; allowPrerelease?: boolean };
  googleApps: {
    openInApp: boolean;
    alwaysNewWindow: boolean;
    excluded: string[];
    showAccountLabel: boolean;
    showAccountColor: boolean;
    pinned: string[];
  };
  verificationCodes: {
    autoCopy: boolean;
    confidence: 'medium' | 'high';
    markRead: boolean;
    deleteAfter: boolean;
  };
  advanced: { hardwareAcceleration: boolean; lowMemory?: boolean };
  tour: { seen: boolean };
  reneMode: boolean;
  language: 'system' | 'en' | 'nl';
  locale: 'en' | 'nl';
}

export interface DownloadRecord {
  filename: string;
  path: string;
  url: string;
  bytes: number;
  startedAt: number;
  state: 'completed' | 'cancelled' | 'interrupted';
}

export type DownloadClickAction = 'show-in-folder' | 'open-file' | 'nothing';

interface DesktopBridge {
  onProfilesChanged(cb: (profiles: Profile[]) => void): void;
  onUnreadChanged(cb: (counts: Record<string, number>) => void): void;
  onActiveChanged(cb: (active: { key: string; surface: Surface } | null) => void): void;
  getActive(): Promise<{ key: string; surface: Surface } | null>;
  switchSurface(key: string, surface: Surface): void;
  onWindowTabs(cb: (tabs: WindowTabs) => void): void;
  getWindowTabs(): Promise<WindowTabs>;
  onTabDragState(cb: (state: { dragging: boolean }) => void): void;
  tabDragStart(key: string): void;
  tabDragEnd(dropped: boolean): void;
  tabDropped(): void;
  detachTab(key: string): void;
  tabToMainWindow(key: string): void;
  redetect(): void;
  addAccount(): void;
  addDelegated(): void;
  onDelegatedPickerAsk(cb: (ask: DelegatedPickerAsk) => void): void;
  pickDelegated(emails: string[]): void;
  closeDelegatedPicker(): void;
  setColor(email: string, color: string): void;
  removeAccount(email: string): void;
  getHiddenAccounts(): Promise<HiddenAccount[]>;
  unhideAccount(email: string): void;
  onHiddenAccounts(cb: (hidden: HiddenAccount[]) => void): void;
  toggleSettings(open: boolean): void;
  popupMenu(items: NativeMenuItem[], anchor?: { x: number; y: number }): Promise<string | null>;
  onSettingsForceClose(cb: () => void): void;
  onSettingsForceOpen(cb: (section?: string) => void): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  onReleaseNotes(cb: (ask: ReleaseNotesAsk) => void): void;
  closeReleaseNotes(): void;
  /** Resolves to whether a compose window opened, which is what lets the panel decide
   * between clearing the box and leaving the text where it is. */
  sendFeedback(input: { text: string; includeDiagnostics: boolean }): Promise<boolean>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  setAutoStart(v: boolean): void;
  setLaunchMinimized(v: boolean): void;
  setAppearance(patch: {
    showUnreadBadges?: boolean;
    tray?: { enabled?: boolean; selectUnreadOnClick?: boolean };
    restrictMinWindowSize?: boolean;
  }): void;
  setDownloadPrefs(patch: {
    folder?: string;
    saveAsDialog?: boolean;
    openFolderWhenDone?: boolean;
    notify?: boolean;
    notifyClick?: DownloadClickAction;
  }): void;
  setPhishing(patch: { confirmExternalLinks?: boolean; trustedHosts?: string[] }): void;
  setUpdatePrefs(patch: {
    autoCheck?: boolean;
    notify?: boolean;
    allowPrerelease?: boolean;
  }): void;
  setAdvanced(patch: { hardwareAcceleration?: boolean; lowMemory?: boolean }): void;
  countLabelPurge(email: string, label: string): Promise<LabelPurgeCount | { error: string }>;
  runLabelPurge(handle: string, labels: string[]): Promise<LabelPurgeResult>;
  setTourActive(active: boolean): void;
  isFirstRun(): Promise<boolean>;
  setTourSeen(v: boolean): void;
  setVerificationCodes(patch: {
    autoCopy?: boolean;
    confidence?: 'medium' | 'high';
    markRead?: boolean;
    deleteAfter?: boolean;
  }): void;
  getDownloadHistory(): Promise<DownloadRecord[]>;
  clearDownloadHistory(): void;
  revealDownload(path: string): void;
  openDownload(path: string): void;
  onDownloadHistoryChanged(cb: () => void): void;
  onPlayNotificationSound(cb: (arg: { name: string; volume: number }) => void): void;
  setGoogleApps(patch: {
    openInApp?: boolean;
    alwaysNewWindow?: boolean;
    excluded?: string[];
    showAccountLabel?: boolean;
    showAccountColor?: boolean;
    pinned?: string[];
  }): void;
  setNotificationExtras(patch: {
    showSender?: boolean;
    showSubject?: boolean;
    sound?: boolean;
    soundName?: string;
    volume?: number;
    googleApps?: boolean;
  }): void;
  testNotification(): void;
  pickDownloadFolder(): Promise<string>;
  onPrefsChanged(cb: (prefs: Prefs) => void): void;
  setAccountPref(arg: { email: string; label?: string; notify?: boolean; calendarNotify?: boolean; badgeCount?: boolean; notifySound?: boolean; notifyPersist?: boolean }): void;
  setAccountOrder(emails: string[]): void;
  setNotifications(arg: { dnd: boolean; quietHours: { enabled: boolean; start: string; end: string } }): void;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  setLanguage(v: 'system' | 'en' | 'nl'): void;
  setNotificationOpen(v: 'app' | 'window'): void;
  setReneMode(v: boolean): void;
  requestDefaultMail(): void;
  onMailDropPreview(cb: (arg: MailDropPreview) => void): void;
  closeMailDropPreview(): void;
  getMailDropPreview(): Promise<MailDropPreview>;
  getLabels(opts?: {
    everyMailbox?: boolean;
  }): Promise<{ accounts: { email: string; labels: { id: string; name: string }[]; error?: string }[] }>;
  getRecentLabels(): Promise<RecentLabelUse[]>;
  getMailDropExisting(): Promise<MailDropExisting>;
  onMailDropExisting(cb: (arg: MailDropExisting) => void): void;
  copyMailDrop(
    targets: MailDropCopyTarget[],
    mode?: CopyMode,
  ): Promise<MailDropCopyResult>;
  retryMailDropCopy(retryId: string, mode?: CopyMode): Promise<MailDropCopyResult>;
  retryMailDropPull(
    retryId: string,
  ): Promise<{ ok: true; items: MailDropPreviewItem[]; pullRetryId?: string } | { ok: false; error: string }>;
  retryMailDropJob(retryId: string, mode?: CopyMode): Promise<MailDropCopyResult>;
  onMailDropCopyProgress(cb: (arg: MailDropCopyProgress) => void): void;
  controlMailDropCopy(
    action: 'pause' | 'resume' | 'stop-keep' | 'stop-rollback-batch' | 'stop-rollback-job',
  ): Promise<{ ok: boolean; error?: string }>;
  getPendingOrphan(): Promise<PendingOrphan | null>;
  decideOrphanRun(runId: string, mode: 'keep' | 'rollback'): Promise<{ ok: boolean }>;
  getPendingJob(): Promise<PendingJob | null>;
  decideJobRun(jobId: string, choice: 'continue' | 'keep' | 'rollback'): Promise<{ ok: boolean }>;
  onReconnectList(cb: (arg: { accounts: ReconnectAccount[] }) => void): void;
  getReconnectList(): Promise<{ accounts: ReconnectAccount[] }>;
  reconnectOAuth(email: string): Promise<{ ok: boolean; error?: string }>;
  getOAuthStatus(): Promise<OAuthStatusReport>;
  onOAuthStatus(cb: (arg: OAuthStatusReport) => void): void;
  importOAuthConfig(): Promise<{ ok: boolean; invalid?: boolean }>;
  getMailDropFolder(): Promise<MailDropFolderStatus>;
  pickMailDropFolder(): Promise<MailDropFolderStatus>;
  openMailDropFolder(): void;
  onDefaultMailStatus(cb: (isDefault: boolean) => void): void;
  getChangelog(): Promise<ChangelogVersion[]>;
  onComposeAccountAsk(cb: (arg: ComposeAccountAsk) => void): void;
  pickComposeAccount(index: number | null): void;
  reportComposeAccountSize(size: { width: number; height: number }): void;
  onToastState(cb: (state: ToastState) => void): void;
  toastReady(): void;
  onToastHoverEnd(cb: () => void): void;
  reportToastSize(size: { width: number; height: number }): void;
  activateToast(id: string): void;
  dismissToast(id: string): void;
  dismissAllToasts(): void;
  runToastAction(arg: { id: string; action: ToastAction }): void;
  setToastHovered(hovered: boolean): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
