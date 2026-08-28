// Building the main window and everything hung off it: the view manager, the toast stack,
// and the handlers that keep them in step with the window's life.
//
// This runs more than once -- a notification click after the window closed rebuilds it, and
// so does 'activate' on macOS. Everything it creates is published to the runtime rather than
// held here, and every callback below reads the live binding, so a second window replaces
// what they see. The locals are for this pass only.
//
// One ordering matters: the toast controller is built after the window it belongs to and
// torn down with it.

import { BrowserWindow, nativeTheme, screen } from 'electron';
import { app } from 'electron';
import { join } from 'node:path';
import { watch } from 'node:fs';
import { IPC } from '../core/ipc';
import { DEV_URL, ICON_PATH, PRELOAD_PATH, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from '../core/rene';
import { PrefsStore } from '../core/prefs-store';
import {
  accountCacheLoaded,
  coverage,
  currentLocale,
  detectionStarted,
  idxOfKey,
  isQuitting,
  keyOf,
  lastUpdateStatus,
  mainWindow,
  manager,
  prefs,
  profiles,
  raiseOverlays,
  setAccountCache,
  setAccountCacheLoaded,
  setCachedAccounts,
  setColors,
  setDelegated,
  setDetectionStarted,
  setDownloadHistory,
  setHidden,
  setHistory,
  setMessageIndex,
  setMainWindow,
  setManager,
  setOauthTokens,
  setPrefs,
  setSeedOrder,
  setSettingsPanelOpen,
  setToastWindow,
  setToasts,
  toasts,
  unread,
} from '../core/runtime';
import { pushProfiles, pushPrefs, pushUnread, pushDefaultMailStatus, refreshBadge } from '../core/broadcast';
import { ProfileViewManager } from './profile-view-manager';
import { clampBoundsToDisplays } from './window-bounds';
import { isDarkTheme, overlayOptions, supportsOverlay, windowBackground } from './titlebar';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  applyReneZoom,
  cancelPendingBoundsSave,
  handleInput,
  saveWindowBounds,
  scheduleSaveBounds,
} from './window-chrome';
import { ToastWindow } from '../toast/toast-window';
import { ToastController } from '../toast/toast-controller';
import { drainToSystem, repairToastStack } from '../toast/toast-presenter';
import { activateNotification, activateToast, forgetToastResources, runToastAction } from '../toast/toast-activation';
import { cancelComposeAsk } from '../compose/mailto-controller';
import { onIdentity, startDetection } from '../accounts/detection-controller';
import { loadDelegatedProfiles, startDelegatedUrlRefreshOnce } from '../delegation/delegated-controller';
import { handleMailDrop } from '../mail/mail-drop-controller';
import { checkOAuthHealth } from '../auth/oauth-health-check';
import { notificationSilent } from '../notify/notification-policy';
import { notifyLog, openNotifyLog } from '../notify/notify-log';
import { ColorStore } from '../accounts/color-store';
import { AccountCacheStore, rememberedOrder } from '../accounts/account-cache';
import { DelegatedStore } from '../delegation/delegated-store';
import { HiddenStore } from '../accounts/hidden-store';
import { OAuthStore, type ProtectResult } from '../auth/oauth-store';
import { dropDisallowedTokens, isAllowedAccount } from '../auth/account-domain';
import { HistoryStore } from '../gmail/history-store';
import { MessageIndexStore } from '../mail/message-index';
import { DownloadHistoryStore } from '../system/download-history';
import { shouldHideOnClose } from '../menus/tray-controller';
import type { KeyInput } from '../menus/shortcuts';


//===========================
// Module state
//===========================

/** Only the first window of the session honours 'start minimised'; one rebuilt by a
 * notification click is being opened on purpose. */
let firstWindow = true;


//===========================
// Exported functions
//===========================

function watchPreloadForReload(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(PRELOAD_PATH, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => manager?.reloadAll(), 250);
    });
  } catch {
  }
}

//===========================
// The main window
//===========================

export function createWindow(): void {
  openNotifyLog(join(app.getPath('userData'), 'notify.log'));
  notifyLog(`[notify] --- app start, ${app.getVersion()}${DEV_URL ? ' (dev)' : ''} ---`);

  const store = new PrefsStore(join(app.getPath('userData'), 'prefs.json'));
  setPrefs(store);
  const stored = store.getAll().window;
  const bounds = clampBoundsToDisplays(
    { width: stored.width, height: stored.height, x: stored.x, y: stored.y },
    screen.getAllDisplays().map((d) => ({ bounds: d.bounds })),
  );
  const frameless = supportsOverlay(process.platform)
    ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: overlayOptions(
          store.getAll().theme,
          nativeTheme.shouldUseDarkColors,
          store.getAll().reneMode,
        ),
      }
    : {};
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: windowBackground(store.getAll().theme, nativeTheme.shouldUseDarkColors),
    icon: ICON_PATH,
    minWidth: store.getAll().appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_WIDTH,
    minHeight: store.getAll().appearance.restrictMinWindowSize === false ? 0 : MIN_WINDOW_HEIGHT,
    ...frameless,
    webPreferences: { preload: SIDEBAR_PRELOAD_PATH, contextIsolation: true },
  });
  setMainWindow(win);
  if (stored.maximized) win.maximize();
  if (firstWindow && store.getAll().launchMinimized) win.minimize();
  firstWindow = false;
  win.on('show', refreshBadge);
  win.on('restore', refreshBadge);

  win.on('focus', () => void pushDefaultMailStatus());
  setColors(new ColorStore(join(app.getPath('userData'), 'colors.json')));
  const tokens = new OAuthStore(join(app.getPath('userData'), 'google-tokens.json'));

  setOauthTokens(tokens);
  reportTokenProtection(tokens.protect());

  const dropped = dropDisallowedTokens(tokens);

  if (dropped.length > 0) console.warn('[oauth] unlinked, outside the allowed domain:', dropped);
  setHistory(new HistoryStore(join(app.getPath('userData'), 'gmail-history.json')));
  setMessageIndex(new MessageIndexStore(join(app.getPath('userData'), 'message-index.json')));
  setDownloadHistory(new DownloadHistoryStore(join(app.getPath('userData'), 'downloads.json')));
  setDelegated(new DelegatedStore(join(app.getPath('userData'), 'delegated.json')));
  setHidden(new HiddenStore(join(app.getPath('userData'), 'hidden.json')));

  const cache = new AccountCacheStore(join(app.getPath('userData'), 'accounts.json'));

  setAccountCache(cache);
  if (!accountCacheLoaded) {
    setAccountCacheLoaded(true);
    const remembered = cache.list();
    setCachedAccounts(remembered);
    setSeedOrder(rememberedOrder(remembered));
  }
  const views = new ProfileViewManager(
    win,
    PRELOAD_PATH,
    (accountKey, count) => {
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      if (email && coverage.has(email)) return;
      unread.report(accountKey, count);
      pushUnread();
      refreshBadge();
    },
    (accountKey, surface, threadId, subject, messageId) =>
      activateNotification(accountKey, surface, threadId, subject, messageId),
    (accountKey, identity) => {
      const idx = idxOfKey(accountKey);
      if (idx != null) onIdentity(idx, identity);
    },
    (_accountKey, input) => handleInput(input),
    (accountKey) => {
      if (prefs?.getAll().reneMode) return RENE_ZOOM_LEVEL;
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? prefs!.getAccount(email).zoom ?? 0 : 0;
    },
    (accountKey) => {
      const email = profiles.find((p) => keyOf(p) === accountKey)?.email;
      return email ? notificationSilent(prefs!.getAll(), email, 'mail') : false;
    },
    () => prefs?.getAll().notificationOpen ?? 'app',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    (acctKey, payload) => void handleMailDrop(acctKey, payload),
    () => raiseOverlays(),

    (acctKey) => {
      const email = profiles.find((p) => keyOf(p) === acctKey)?.email;
      return email ? isAllowedAccount(email) : null;
    },
  );
  setManager(views);

  const stack = new ToastWindow(
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/toasts` : 'app://bundle/toasts.html',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    () => toasts?.markReady(),
    () => {
      if (!repairToastStack()) drainToSystem();
    },
  );
  setToastWindow(stack);
  const controller = new ToastController({
    window: stack,
    locale: () => currentLocale(),
    reneMode: () => prefs?.getAll().reneMode === true,
    dark: () => isDarkTheme(prefs?.getAll().theme ?? 'system', nativeTheme.shouldUseDarkColors),
    now: () => Date.now(),
    onActivate: (toast) => activateToast(toast),
    onActivateSummary: (accountKey) => {
      if (accountKey) activateNotification(accountKey, 'mail');
      else if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onAction: (toast, action) => void runToastAction(toast, action),
    onDiscard: (toast) => forgetToastResources(toast),
  });
  setToasts(controller);
  win.on('closed', () => {
    toasts?.destroy();
    setToasts(null);
    setToastWindow(null);
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/');

  if (DEV_URL) watchPreloadForReload();

  setInterval(() => void checkOAuthHealth(), 5 * 60 * 1000);

  win.webContents.on('did-finish-load', () => {
    loadDelegatedProfiles();
    pushProfiles();
    pushPrefs();
    void pushDefaultMailStatus();
    startDelegatedUrlRefreshOnce();
    applyReneZoom();
    mainWindow?.webContents.send(IPC.UPDATE_STATUS, { ...lastUpdateStatus, currentVersion: app.getVersion() });
    if (!detectionStarted) {
      setDetectionStarted(true);
      startDetection();
    }
  });

  win.on('close', (e) => {
    if (shouldHideOnClose({ isQuitting, platform: process.platform })) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
  win.on('close', saveWindowBounds);
  win.on('closed', () => {
    cancelPendingBoundsSave();
    setMainWindow(null);
    cancelComposeAsk();
  });

  win.on('hide', () => cancelComposeAsk());

  win.webContents.on('before-input-event', (_e, input) => {
    handleInput(input as unknown as KeyInput);
  });
}

/**
 * Brings the settings panel up, optionally on one section
 *
 * @param section a section name from the renderer's nav, or nothing to leave the panel where
 *   the user last had it. Typed loosely on purpose: the list of sections belongs to the
 *   renderer and main has no business importing it.
 */
export function openSettingsPanel(section?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  setSettingsPanelOpen(true);
  manager?.hideAll();
  mainWindow.webContents.send(IPC.SETTINGS_FORCE_OPEN, { section });
}


//===========================
// Helper functions
//===========================

/**
 * Records what the token file turned out to be, and warns when it is not protected
 *
 * @param result what protect() found on disk
 * @private
 */
function reportTokenProtection(result: ProtectResult): void {
  if (result === 'sealed') notifyLog('[oauth] token file encrypted with the platform keystore');
  if (result === 'unavailable') {
    notifyLog('[oauth] no keystore on this platform, so the token file stays plain text');
  }
  if (result === 'unreadable') {
    notifyLog('[oauth] the token file was sealed elsewhere; the accounts need linking again');
  }
}
