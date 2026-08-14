// The mutable singletons the main process is built around: the window, the view manager,
// the stores, and the list of accounts everything else reads. Split out of main.ts so the
// modules that grew out of it can reach the same state without importing each other.
//
// Exported as live bindings with a setter each, rather than as fields on one object. That
// keeps every read site written the way it always was — `mainWindow?.webContents.send(...)`
// — while making every write a named call that can be found with a single grep. A binding
// with no setter is one nothing outside this file is allowed to replace.
//
// The rule that matters: read these at the moment you need them, never capture them when a
// module is constructed. Nearly all of it is born inside createWindow(), which runs again
// after the main window closes — a notification click reopens it — so anything holding the
// first window keeps a destroyed one for the rest of the session.

import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { accountKey, parseAccountKey, type AccountRef } from '../accounts/account-ref';
import { colorForIndex } from '../accounts/palette';
import { resolveLocale, type Locale } from './locale';
import { UnreadStore } from '../unread/unread-store';
import { PushCoverage } from '../push/push-coverage';
import type { ProfileViewManager, Profile } from '../windows/profile-view-manager';
import type { ColorStore } from '../accounts/color-store';
import type { RemovedStore } from '../accounts/removed-store';
import type { DelegatedStore } from '../delegation/delegated-store';
import type { PrefsStore } from './prefs-store';
import type { OAuthStore } from '../auth/oauth-store';
import type { HistoryStore } from '../gmail/history-store';
import type { DownloadHistoryStore } from '../system/download-history';
import type { AccountCacheStore, CachedAccount } from '../accounts/account-cache';
import type { OverlayView } from '../windows/overlay-view';
import type { ToastController } from '../toast/toast-controller';
import type { ToastWindow } from '../toast/toast-window';
import type { ReconnectAccount } from '../auth/oauth-health';
import type { AccountOAuthStatus } from '../../renderer/lib/oauth-status';


//===========================
// Types
//===========================

/** What startPushManager hands back, kept to the two calls main has ever made on it. */
export interface PushManagerHandle {
  stop(): void;
  refresh(): void;
}

/** One account's Gmail-API sync, as the push and timer paths both drive it. */
export interface SyncRunner {
  run(): Promise<void>;
}


//===========================
// Constants
//===========================

/** Every Google surface shares one session, so a sign-in in one view is a sign-in in all. */
export const SESSION_PARTITION = 'persist:google';


//===========================
// Module state
//===========================

export let mainWindow: BrowserWindow | null = null;
export let manager: ProfileViewManager | null = null;
export let prefs: PrefsStore | null = null;
export let colors: ColorStore | null = null;
export let removed: RemovedStore | null = null;
export let delegated: DelegatedStore | null = null;
export let oauthTokens: OAuthStore | null = null;
export let history: HistoryStore | null = null;
export let downloadHistory: DownloadHistoryStore | null = null;
export let accountCache: AccountCacheStore | null = null;
export let toasts: ToastController | null = null;
export let toastWindow: ToastWindow | null = null;

/** The overlays that float over the Gmail layer. Paired here because raiseOverlays is the
 * only thing that treats them as a group, and it has to know about both. */
export let dropOverlay: OverlayView | null = null;
export let reconnectBanner: OverlayView | null = null;

export let pushManager: PushManagerHandle | null = null;

/** The accounts this process has confirmed, own and delegated, in tab order. */
export const profiles: Profile[] = [];
export const unread = new UnreadStore();
export const coverage = new PushCoverage();
export const syncRunners = new Map<string, SyncRunner>();

/** Remembered accounts from the last run, shown as provisional tabs until detection
 * confirms them. Cleared once it settles. */
export let cachedAccounts: CachedAccount[] = [];
export let accountCacheLoaded = false;
export let seedOrder = new Map<string, number>();

export let isQuitting = false;
export let settingsPanelOpen = false;
export let detectionStarted = false;

export let reconnectAccounts: ReconnectAccount[] = [];
export let oauthStatuses: AccountOAuthStatus[] = [];
export let pendingMailto: string | null = null;
export let lastUpdateStatus: Record<string, unknown> = { state: 'idle' };


//===========================
// Exported functions
//===========================

export function setMainWindow(v: BrowserWindow | null): void {
  mainWindow = v;
}
export function setManager(v: ProfileViewManager | null): void {
  manager = v;
}
export function setPrefs(v: PrefsStore | null): void {
  prefs = v;
}
export function setColors(v: ColorStore | null): void {
  colors = v;
}
export function setRemoved(v: RemovedStore | null): void {
  removed = v;
}
export function setDelegated(v: DelegatedStore | null): void {
  delegated = v;
}
export function setOauthTokens(v: OAuthStore | null): void {
  oauthTokens = v;
}
export function setHistory(v: HistoryStore | null): void {
  history = v;
}
export function setDownloadHistory(v: DownloadHistoryStore | null): void {
  downloadHistory = v;
}
export function setAccountCache(v: AccountCacheStore | null): void {
  accountCache = v;
}
export function setToasts(v: ToastController | null): void {
  toasts = v;
}
export function setToastWindow(v: ToastWindow | null): void {
  toastWindow = v;
}
export function setDropOverlay(v: OverlayView | null): void {
  dropOverlay = v;
}
export function setReconnectBanner(v: OverlayView | null): void {
  reconnectBanner = v;
}
export function setPushManager(v: PushManagerHandle | null): void {
  pushManager = v;
}
export function setCachedAccounts(v: CachedAccount[]): void {
  cachedAccounts = v;
}
export function setAccountCacheLoaded(v: boolean): void {
  accountCacheLoaded = v;
}
export function setSeedOrder(v: Map<string, number>): void {
  seedOrder = v;
}
export function setIsQuitting(v: boolean): void {
  isQuitting = v;
}
export function setSettingsPanelOpen(v: boolean): void {
  settingsPanelOpen = v;
}
export function setDetectionStarted(v: boolean): void {
  detectionStarted = v;
}
export function setReconnectAccounts(v: ReconnectAccount[]): void {
  reconnectAccounts = v;
}
export function setOauthStatuses(v: AccountOAuthStatus[]): void {
  oauthStatuses = v;
}
export function setPendingMailto(v: string | null): void {
  pendingMailto = v;
}
export function setLastUpdateStatus(v: Record<string, unknown>): void {
  lastUpdateStatus = v;
}

/** Raised together whenever the manager attaches a view, which appends and therefore covers
 * whatever was there. Closed overlays ignore the call, so this needs no bookkeeping about
 * which is up. */
export function raiseOverlays(): void {
  dropOverlay?.raise();
  reconnectBanner?.raise();
}

export const authRef = (index: number): AccountRef => ({ kind: 'authuser', index });
export const keyOf = (p: Profile): string => accountKey(p.ref);
export const keyOfIndex = (index: number): string => accountKey(authRef(index));

/** -1 for a delegated profile, which has no authuser index of its own. */
export const authIdx = (p: Profile): number => (p.ref.kind === 'authuser' ? p.ref.index : -1);

/** Null for anything that is not one of the user's own accounts. */
export const idxOfKey = (key: string): number | null => {
  const parsed = parseAccountKey(key);
  return parsed.kind === 'authuser' ? parsed.index : null;
};

/** A stable colour for an address that has no remembered one, so the same mailbox is the
 * same colour on every machine rather than depending on the order it was detected in. */
export function colorForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return colorForIndex(Math.abs(h));
}

/** One place decides the language, so the panel, the context menu and the native dialogs
 * cannot disagree. */
export function currentLocale(): Locale {
  return resolveLocale(prefs?.getAll().language ?? 'system', app.getLocale());
}
