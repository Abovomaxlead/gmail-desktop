// The Electron main process: window and tray, per-account views and sessions, account
// detection, notifications, downloads, drag-to-save, Gmail-API sync and every IPC
// handler. The pure decisions live in the small modules beside this file.
//
// Ordering that breaks if moved: disableHardwareAcceleration and the WSL
// software-rendering switch must run before app 'ready' (hence the throwaway PrefsStore
// up there, and no inverse call to re-enable); the 'session-created' and context-menu
// hooks must be registered before createWindow; the nativeTheme listener is registered
// once at startup, not in createWindow, which runs again after a notification click and
// would leak a listener each time; and setAppUserModelId is required or Windows
// silently drops Gmail's notifications.
//
// Other traps: DownloadItem.getStartTime() returns seconds, not milliseconds;
// accounts.json is never written empty, as empty usually means detection has confirmed
// nothing yet; a view left at setVisible(false) counts as occluded and Gmail then never
// builds its message list, hence the one-off warm-up; each account has exactly one
// unread source at a time (labels.get under push, page title otherwise) or the number
// oscillates; and reveal/open accept only paths already in the download log.

import { app, BrowserWindow, protocol, net, ipcMain, session, Menu, screen, dialog, shell, nativeTheme } from 'electron';
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, watch } from 'node:fs';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ProfileViewManager, type Profile, type Surface } from './windows/profile-view-manager';
import { SURFACES, SURFACE_CONFIG, surfacesForRef } from '../renderer/lib/surfaces';
import { accountKey, type AccountRef } from './accounts/account-ref';
import { type LanguagePref } from './core/locale';
import { DelegatedStore } from './delegation/delegated-store';
import { AccountCacheStore, rememberedOrder } from './accounts/account-cache';
import {
  DEV_URL,
  ICON_PATH,
  OAUTH_CONFIG_PATH,
  PRELOAD_PATH,
  RENDERER_DIST,
  SIDEBAR_PRELOAD_PATH,
} from './core/paths';
import { startMailSync, syncRunnerFor } from './push/mail-sync-controller';
import {
  activateNotification,
  activateToast,
  forgetToastResources,
  rememberWebNotifySource,
  runToastAction,
  setToastActivationHooks,
} from './toast/toast-activation';
import {
  closeDropPreview,
  copyToMailboxes,
  dropPreviewItems,
  handleMailDrop,
  labelsForCopyTargets,
  mailDropFolder,
} from './mail/mail-drop-controller';
import {
  loadDelegatedProfiles,
  maybeStartDelegatedApiScan,
  refreshDelegatedFromApi,
  startDelegatedUrlRefreshOnce,
} from './delegation/delegated-controller';
import {
  setViewSurfaceHooks,
  showAccount,
  syncCalendarViews,
  warmAccount,
} from './windows/view-surfaces';
import {
  oauthConfig,
} from './auth/oauth-config';
import {
  checkOAuthHealth,
  clearPushRefusal,
  clearRefreshFailure,
  scheduleOAuthHealthCheck,
} from './auth/oauth-health-check';
import {
  attachSessionHandlers,
  downloadFolder,
  knownDownloadPath,
} from './system/session-setup';
import {
  hiddenNotificationText,
  playNotificationSound,
  refreshNotifyAllowed,
  resetSoundThrottle,
  setNotifyGatingHooks,
  startNotifyTimer,
} from './notify/notify-gating';
import {
  drainToSystem,
  repairToastStack,
  showToast,
  toastAccountFor,
} from './toast/toast-presenter';
import {
  applyTraySetting,
  refreshTray,
  setSnooze,
  setTrayHooks,
} from './menus/tray-setup';
import {
  applyAutoUpdateCheck,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  loadChangelog,
  setUpdateHooks,
  setupUpdater,
} from './updates/update-controller';
import {
  pushActive,
  pushDefaultMailStatus,
  pushPrefs,
  pushProfiles,
  pushUnread,
  refreshBadge,
  setOnProfilesPushed,
} from './core/broadcast';
import {
  SESSION_PARTITION,
  accountCache,
  accountCacheLoaded,
  activeTab,
  activeView,
  authIdx,
  authRef,
  colors,
  coverage,
  currentLocale,
  delegated,
  detectionStarted,
  downloadHistory,
  history,
  idxOfKey,
  isQuitting,
  keyOf,
  keyOfIndex,
  lastUpdateStatus,
  mainWindow,
  manager,
  oauthStatuses,
  oauthTokens,
  pendingMailto,
  prefs,
  profiles,
  pushManager,
  raiseOverlays,
  reconnectAccounts,
  removed,
  setAccountCache,
  setAccountCacheLoaded,
  setCachedAccounts,
  setColors,
  setDelegated,
  setDetectionStarted,
  setDownloadHistory,
  setHistory,
  setIsQuitting,
  setMainWindow,
  setManager,
  setOauthTokens,
  setPendingMailto,
  setPrefs,
  setRemoved,
  setSeedOrder,
  setSettingsPanelOpen,
  setToastWindow,
  setToasts,
  syncRunners,
  toastWindow,
  toasts,
  unread,
} from './core/runtime';
import { ColorStore } from './accounts/color-store';
import { RemovedStore } from './accounts/removed-store';
import {
  PrefsStore,
  type AppearancePatch,
} from './core/prefs-store';
import { hostOf, needsLinkConfirm, unwrapRedirect } from './system/link-guard';
import { clampBoundsToDisplays, grownToMinimum } from './windows/window-bounds';
import { colorForIndex } from './accounts/palette';
import { planNext } from './accounts/detection-planner';
import { addAccountUrl } from './gmail/google-urls';
import { popupNativeMenu } from './menus/native-menu';
import type { NativeMenuItem } from '../renderer/lib/native-menu';
import { nativeLabels } from './menus/native-labels';
import {
  IPC,
  type MailDropCopyTarget,
} from './core/ipc';
import {
  type CopyMode,
} from './mail/mail-copy';
import { shouldHideOnClose } from './menus/tray-controller';
import { resolveShortcut, type KeyInput } from './menus/shortcuts';
import { openCompose } from './compose/compose-window';
import { parseMailto, extractMailtoFromArgv, type MailtoFields } from './mail/mailto';
import type { ComposeAccountAsk, ComposeAccountChoice } from '../renderer/lib/compose-account';
import {
  MAIL_APP_NAME,
  registerMailClient,
} from './system/mail-client-registration';
import {
  notificationsAllowed,
  notificationSilent,
  notificationPersist,
  mergeNotificationsFromPanel,
  sessionPermissionAllowed,
} from './notify/notification-policy';
import { notifyLog, openNotifyLog } from './notify/notify-log';
import { RENE_ZOOM_FACTOR, RENE_ZOOM_LEVEL } from './core/rene';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE, LABELS_NL } from './menus/context-menu';
import { attachExternalLinkHandling, setExternalOpener } from './system/external-links';
import { googleAppTarget } from './gmail/google-apps-open';
import { DownloadHistoryStore } from './system/download-history';
import { isDarkTheme, overlayOptions, supportsOverlay, supportsOverlayUpdate, windowBackground } from './windows/titlebar';
import { ComposePicker } from './compose/compose-picker';
import {
  openComposeAccountWindow,
  resizeAndShowComposeAccountWindow,
} from './compose/compose-account-window';
import { ToastWindow } from './toast/toast-window';
import { ToastController } from './toast/toast-controller';
import { webNotifySourceKey, type ToastAction } from '../renderer/lib/toast';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from './system/app-scheme';
import { checkOAuthConfigFile } from './auth/oauth-config-file';
import {
  stopWatch,
} from './gmail/gmail-api';
import { type NotifiedMail } from './notify/notify-match';
import { OAuthStore } from './auth/oauth-store';
import { connectAccount } from './auth/oauth-flow';
import { dropDisallowedTokens, isAllowedAccount } from './auth/account-domain';
import { HistoryStore } from './gmail/history-store';


//===========================
// Startup switches
//===========================

if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

try {
  const early = new PrefsStore(join(app.getPath('userData'), 'prefs.json')).getAll();
  if (early.advanced.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch {
}


//===========================
// Constants
//===========================

// The floor the "do not make it too small" switch enforces. Height matters as much as
// width: the topbar is 40px (80 in Rene mode) and everything below it is the mail view,
// so without a minimum height the window can be squashed to a bare strip of chrome.
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

// how long an account probe waits for the page to say who it belongs to
const PROBE_TIMEOUT_MS = 16000;

//===========================
// Module state
//===========================

let composeAccountWindow: BrowserWindow | null = null;
const composePicker = new ComposePicker<ComposeAccountAsk, string>({
  open: (ask) => showComposeAccountWindow(ask),
  close: () => closeComposeAccountWindow(),
  redispatch: (url) => void dispatchMailto(url),
});

const seenEmails = new Set<string>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;
let visibleProbe: number | null = null;


//===========================
// App protocol
//===========================

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { ...APP_SCHEME_PRIVILEGES } },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return net.fetch(pathToFileURL(join(RENDERER_DIST, rel)).toString());
  });
}


//===========================
// Tabs, detection and cache
//===========================

function settleDetection(): void {
  probingIndex = null;
  setCachedAccounts([]);
  pushProfiles();
  maybeStartDelegatedApiScan();
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  probingIndex = index;
  manager?.ensureView(authRef(index), 'mail', false);
  clearProbeTimer();
  if (index > 0) {
    probeTimer = setTimeout(() => {
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      settleDetection();
    }, PROBE_TIMEOUT_MS);
  }
}

function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  if (profiles.some((p) => authIdx(p) === index)) return;

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(keyOfIndex(index), 'mail');
    if (manager?.activeKey() == null && profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    probe(index + 1);
    return;
  }

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    if (isVisibleAdd) {
      visibleProbe = null;
      void addAccountAfterConsent(index, identity, decision.stop);
      return;
    }
    registerAccount(index, identity);
    if (manager?.activeKey() == null) {
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail');
    if (isVisibleAdd) {
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
  else if (identity?.email) settleDetection();
}

function registerAccount(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
): void {
  seenEmails.add(identity.email);
  const dup = profiles.findIndex(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === identity.email.toLowerCase(),
  );
  if (dup !== -1) {
    for (const surface of SURFACES) manager?.discardView(keyOf(profiles[dup]), surface);
    profiles.splice(dup, 1);
  }
  const color = colors!.get(identity.email) ?? colorForIndex(index);
  const profile: Profile = {
    ref: authRef(index),
    kind: 'authuser',
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    color,
  };
  profiles.push(profile);
  profiles.sort((a, b) => authIdx(a) - authIdx(b));
  pushProfiles();
  refreshNotifyAllowed();
  startMailSync();
  syncCalendarViews();
  warmAccount(profile);
}

async function addAccountAfterConsent(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
  stopProbing: boolean,
): Promise<void> {
  const email = identity.email;
  const cfg = oauthConfig();
  // An address outside the work domain is added without ever being asked for consent. Asking
  // and being refused would land in the branch below, which throws the view away — so a
  // private mailbox someone signed into would not be readable here at all. It is readable;
  // it is only never linked to the API.
  const needsConsent =
    isAllowedAccount(email) &&
    cfg !== null &&
    oauthTokens !== null &&
    !oauthTokens.get(email) &&
    !!mainWindow &&
    !mainWindow.isDestroyed();

  if (needsConsent) {
    const result = await connectAccount(mainWindow!, SESSION_PARTITION, cfg!, oauthTokens!, email);
    if (!result.ok) {
      manager?.discardView(keyOfIndex(index), 'mail');
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
      const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
      showToast({
        kind: 'error',
        title: L.accountNotAddedTitle,
        body: L.accountNotAddedBody(email, result.error),
        persist: true,
      });
      if (prefs) playNotificationSound(prefs.getAll());
      if (!stopProbing) probe(index + 1);
      else settleDetection();
      return;
    }
  }

  registerAccount(index, identity);
  switchSurface(index, 'mail');
  if (!stopProbing) probe(index + 1);
  else settleDetection();
}

function removeAccount(email: string): void {
  removed!.add(email);
  accountCache?.remove(email);
  const stopToken = oauthTokens?.get(email)?.accessToken;
  if (stopToken) void stopWatch(stopToken).catch(() => undefined);
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
  oauthTokens?.remove(email);
  const profile = profiles.find((p) => p.email === email);
  if (!profile) {
    pushProfiles();
    return;
  }
  if (profile.kind === 'delegated') delegated?.remove(email);
  const wasActive = manager?.activeKey() === keyOf(profile);
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  unread.forget(keyOf(profile));
  for (const surface of SURFACES) manager?.discardView(keyOf(profile), surface);
  pushProfiles();
  pushUnread();
  refreshBadge();
  startMailSync();
  // profiles[0] is not necessarily openable: authIdx returns -1 for every delegated
  // profile, so a mailbox known only by address (no mailUrl yet) sorts ahead of every
  // authuser account and would otherwise be handed to showAccount, which now refuses it —
  // leaving the window showing nothing at all where a removal used to always land on
  // something. Pick the first profile that actually has a mail surface instead.
  if (wasActive) {
    const next = profiles.find((p) => surfacesForRef(p.ref).includes('mail'));
    if (next) showAccount(next.ref, 'mail');
    // Nothing left to show. Say so, or the bar keeps the tab that was just removed lit.
    else pushActive();
  }
}


//===========================
// Compose and mailto
//===========================

// One window per ask, destroyed on settle: reuse would carry the previous recipient into
// an unrelated next question for no gain, since the picker is short-lived. The module
// variable is nulled before the window is destroyed, so a stale instance can never be
// left behind to wedge the feature, and the `closed` that destroying triggers finds the
// resolver already cleared and harmlessly no-ops.
function closeComposeAccountWindow(): void {
  const win = composeAccountWindow;
  composeAccountWindow = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function showComposeAccountWindow(ask: ComposeAccountAsk): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  closeComposeAccountWindow();
  const win = openComposeAccountWindow(
    mainWindow,
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/compose-account` : 'app://bundle/compose-account.html',
    ask.accounts.length,
    prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1,
  );
  composeAccountWindow = win;
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.COMPOSE_ACCOUNT_ASK, ask);
  });
  win.on('closed', () => {
    if (composeAccountWindow === win) composeAccountWindow = null;
    composePicker.settle(null);
  });
}

function chooseComposeAccount(fields: MailtoFields, mailtoUrl: string): Promise<number | null> {
  const authusers = profiles.filter((p) => p.ref.kind === 'authuser');
  if (authusers.length === 0) return Promise.resolve(null);
  if (authusers.length === 1) return Promise.resolve(authIdx(authusers[0]));
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);

  const accounts: ComposeAccountChoice[] = authusers.map((p) => ({
    index: authIdx(p),
    email: p.email,
    label: prefs?.getAccount(p.email).label ?? p.name ?? p.email,
    color: p.color,
    avatarUrl: p.avatarUrl,
  }));
  const ask: ComposeAccountAsk = {
    to: fields.to,
    subject: fields.subject,
    accounts,
    locale: currentLocale(),
    reneMode: prefs?.getAll().reneMode === true,
  };

  return composePicker.ask(ask, mailtoUrl);
}

async function dispatchMailto(mailtoUrl: string): Promise<void> {
  const fields = parseMailto(mailtoUrl);
  if (!fields) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  const ready = manager?.activeKey() != null && profiles.some((p) => p.ref.kind === 'authuser');
  if (!ready) {
    setPendingMailto(mailtoUrl);
    return;
  }
  const index = await chooseComposeAccount(fields, mailtoUrl);
  if (index == null) return;
  openComposeWindow(index, fields);
}

function flushPendingMailto(): void {
  if (!pendingMailto) return;
  if (manager?.activeKey() == null) return;
  const url = pendingMailto;
  setPendingMailto(null);
  void dispatchMailto(url);
}


//===========================
// Window, zoom and shortcuts
//===========================

function switchSurface(index: number, surface: Surface): void {
  showAccount(authRef(index), surface);
}

function startDetection(): void {
  switchSurface(0, 'mail');
}

function redetect(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1);
}

function addAccount(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(authRef(nextIndex), 'mail', true, addAccountUrl());
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !prefs) return;
  const maximized = mainWindow.isMaximized();
  const b = mainWindow.getNormalBounds();
  prefs.setWindow({ width: b.width, height: b.height, x: b.x, y: b.y, maximized });
}
function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

function handleInput(input: KeyInput): void {
  const action = resolveShortcut(input);
  if (!action) return;
  if (action.type === 'devtools') {
    manager?.toggleDevTools();
  } else if (action.type === 'reload') {
    manager?.reloadActive();
  } else if (action.type === 'switch') {
    const ordered = [...profiles].sort((a, b) => (a.order ?? authIdx(a)) - (b.order ?? authIdx(b)));
    const target = ordered[action.n - 1];
    if (target) showAccount(target.ref, 'mail');
  } else if (action.type === 'compose') {
    const activeKey = manager?.activeKey();
    const active = activeKey ? idxOfKey(activeKey) : null;
    if (active != null) openComposeWindow(active);
  } else if (action.type === 'zoom') {
    if (prefs?.getAll().reneMode) return;
    const activeKey = manager?.activeKey();
    if (activeKey == null) return;
    const current = manager!.getActiveZoomLevel();
    const level = action.dir === 'reset' ? 0 : current + (action.dir === 'in' ? 0.5 : -0.5);
    const clamped = Math.max(-3, Math.min(3, level));
    manager!.setZoomForKey(activeKey, clamped);
    const email = profiles.find((p) => keyOf(p) === activeKey)?.email;
    if (email) prefs!.setAccount(email, { zoom: clamped });
  }
}

function applyTitleBarOverlay(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  if (!supportsOverlayUpdate(process.platform)) return;
  const p = prefs.getAll();
  mainWindow.setTitleBarOverlay(
    overlayOptions(p.theme, nativeTheme.shouldUseDarkColors, p.reneMode),
  );
}

function applyReneZoom(): void {
  if (!prefs || !mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs.getAll().reneMode;
  mainWindow.webContents.setZoomFactor(on ? RENE_ZOOM_FACTOR : 1);
  applyTitleBarOverlay();
  for (const p of profiles) {
    manager?.setZoomForKey(keyOf(p), on ? RENE_ZOOM_LEVEL : prefs.getAccount(p.email).zoom ?? 0);
  }
  manager?.relayout();
}


//===========================
// Notification cards
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

let firstWindow = true;

function createWindow(): void {
  // Opened before anything can raise a notification, so the first mail of the session is
  // in it. Where: beside prefs.json in userData, as notify.log.
  openNotifyLog(join(app.getPath('userData'), 'notify.log'));
  notifyLog(`[notify] --- app start, ${app.getVersion()}${DEV_URL ? ' (dev)' : ''} ---`);
  // Held as locals for the length of this function as well as published to the runtime: the
  // setup below is the one place that knows these are freshly built and non-null, and every
  // callback registered here still reads the live binding, so a second window replaces what
  // they see rather than leaving them on the first.
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
  // The user leaves for Windows Settings to pick a mail app and comes back, so re-read
  // the association on focus rather than trusting what we last showed.
  win.on('focus', () => void pushDefaultMailStatus());
  setColors(new ColorStore(join(app.getPath('userData'), 'colors.json')));
  const tokens = new OAuthStore(join(app.getPath('userData'), 'google-tokens.json'));
  setOauthTokens(tokens);
  // A token that predates the domain limit, or one carried over from another machine. It
  // would be invisible in the panel from here on and still be used for syncing, pushing and
  // dropping mail, which is the one combination worse than either alone.
  const dropped = dropDisallowedTokens(tokens);
  if (dropped.length > 0) console.warn('[oauth] unlinked, outside the allowed domain:', dropped);
  setHistory(new HistoryStore(join(app.getPath('userData'), 'gmail-history.json')));
  setRemoved(new RemovedStore(join(app.getPath('userData'), 'removed.json')));
  setDownloadHistory(new DownloadHistoryStore(join(app.getPath('userData'), 'downloads.json')));
  setDelegated(new DelegatedStore(join(app.getPath('userData'), 'delegated.json')));
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
    (accountKey, surface, threadId, subject) =>
      activateNotification(accountKey, surface, threadId, subject),
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
  );
  setManager(views);

  // Built and torn down with the main window: a stack floating over a closed app is
  // nonsense. Where it appears is not the window's business — the stack always goes to
  // the primary display, whichever screen the app itself has been dragged to.
  const stack = new ToastWindow(
    SIDEBAR_PRELOAD_PATH,
    DEV_URL ? `${DEV_URL}/toasts` : 'app://bundle/toasts.html',
    () => (prefs?.getAll().reneMode ? RENE_ZOOM_FACTOR : 1),
    () => toasts?.markReady(),
    // Rebuild while there is a rebuild left, and when there is not, get what is queued out
    // by the only route still open. Ignoring this answer is how a broken stack turned into
    // no notification at all rather than a plain one.
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
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    setMainWindow(null);
    composePicker.settle(null);
  });
  // shouldHideOnClose turns a close into a hide unless the app is quitting, so 'closed'
  // fires only on quit; the tray toggle and the close box both end up here instead, and
  // an unanswered picker has to go with the window that its parent hid behind.
  win.on('hide', () => composePicker.settle(null));

  win.webContents.on('before-input-event', (_e, input) => {
    handleInput(input as unknown as KeyInput);
  });
}

function openSettingsPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  setSettingsPanelOpen(true);
  manager?.hideAll();
  mainWindow.webContents.send(IPC.SETTINGS_FORCE_OPEN);
}


//===========================
// System integration
//===========================

function setAutoStart(v: boolean): void {
  prefs!.setAutoStart(v);
  app.setLoginItemSettings({ openAtLogin: v });
  pushPrefs();
  refreshTray();
}
function setLaunchMinimized(v: boolean): void {
  prefs!.setLaunchMinimized(v);
  pushPrefs();
}
// Only a packaged build has an exe worth registering; in dev process.execPath is
// electron.exe, which would leave a bogus app sitting in Windows Settings.
function ensureMailClientRegistered(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return Promise.resolve();
  return registerMailClient(process.execPath);
}

// Windows picks the mailto: handler from a UserChoice hash it signs itself, so an app
// cannot make itself the default however much it would like to. Registering the
// capability and opening the page where the user picks us is the whole of what we can
// do. Other platforms still let us claim it outright.
function requestDefaultMail(): void {
  if (process.platform !== 'win32') {
    app.setAsDefaultProtocolClient('mailto');
    void pushDefaultMailStatus();
    return;
  }
  void ensureMailClientRegistered().then(() =>
    shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(MAIL_APP_NAME)}`),
  );
}


//===========================
// Opening things
//===========================

function applyMinWindowSize(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const on = prefs?.getAll().appearance.restrictMinWindowSize !== false;
  mainWindow.setMinimumSize(on ? MIN_WINDOW_WIDTH : 0, on ? MIN_WINDOW_HEIGHT : 0);
  if (!on || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  const bounds = mainWindow.getBounds();
  const grown = grownToMinimum(bounds, { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT });
  if (grown.width === bounds.width && grown.height === bounds.height) return;
  mainWindow.setBounds({ ...bounds, ...grown });
}

function showTestNotification(): void {
  if (!prefs) return;
  const p = prefs.getAll();
  const hidden = hiddenNotificationText(p);
  const L = nativeLabels(currentLocale(), p.reneMode === true);
  const first = profiles[0];
  showToast({
    kind: 'test',
    title: hidden.hiddenSender ?? 'Gmail Desktop',
    body: hidden.hiddenSubject ?? L.testNotificationBody,
    ...(first ? { account: toastAccountFor(first.email) } : {}),
    persist: true,
  });
  // A deliberate test should always be heard, so the throttle is reset first. Whether it
  // may sound at all is playNotificationSound's decision, not this one's.
  resetSoundThrottle();
  playNotificationSound(p);
}

function openSurfaceForAccount(ref: AccountRef, surface: Surface): void {
  if (surface === 'mail' || !prefs) {
    showAccount(ref, surface);
    return;
  }
  const target = googleAppTarget(surface, prefs.getAll().googleApps);
  if (target === 'in-app') {
    showAccount(ref, surface);
    return;
  }
  const url = SURFACE_CONFIG[surface].url(ref);
  if (target === 'external') {
    openExternalGuarded(url);
    const visible = activeView();
    if (!visible) showAccount(ref, 'mail');
    return;
  }
  openGoogleAppWindow(url, ref, surface);
}

function openGoogleAppWindow(url: string, ref: AccountRef, surface: Surface): void {
  const email = profiles.find((p) => accountKey(p.ref) === accountKey(ref))?.email ?? '';
  const account = email ? prefs?.getAccount(email) : undefined;
  const g = prefs?.getAll().googleApps;
  const label = (account?.label || email || '').trim();
  const showLabel = g?.showAccountLabel !== false && profiles.length > 1 && label;
  const title = showLabel
    ? `${SURFACE_CONFIG[surface].label} — ${label}`
    : SURFACE_CONFIG[surface].label;
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title,
    backgroundColor:
      g?.showAccountColor !== false && profiles.find((p) => p.email === email)?.color
        ? profiles.find((p) => p.email === email)!.color
        : '#ffffff',
    webPreferences: { partition: 'persist:google', contextIsolation: true },
  });
  win.on('page-title-updated', (e) => {
    if (showLabel) e.preventDefault();
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(url);
}

function openComposeWindow(index: number, fields?: MailtoFields): void {
  const title = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true).composeTitle;
  openCompose(index, title, fields);
}

function openExternalGuarded(url: string): void {
  const p = prefs?.getAll();
  if (!p || !needsLinkConfirm(url, p.phishing)) {
    void shell.openExternal(url);
    return;
  }
  // Ask about, show and trust where the link really goes, not the google.com/url
  // wrapper Gmail puts around it. The browser still gets the URL as Gmail handed it
  // over; that wrapper redirects to the very host the user just approved.
  const target = unwrapRedirect(url);
  const host = hostOf(target) ?? target;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const shown = target.length > 200 ? `${target.slice(0, 200)}…` : target;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const box = {
    type: 'question' as const,
    noLink: true,
    buttons: [L.linkOpenButton, L.cancel],
    defaultId: 1,
    cancelId: 1,
    message: L.linkMessage(host),
    detail: L.linkDetail(shown),
    checkboxLabel: L.linkAlwaysAllow(host),
    checkboxChecked: false,
  };
  const done = (res: { response: number; checkboxChecked: boolean }) => {
    if (res.response !== 0) return;
    if (res.checkboxChecked && prefs) {
      const current = prefs.getAll().phishing.trustedHosts;
      prefs.setPhishing({ trustedHosts: [...current, host] });
      pushPrefs();
    }
    void shell.openExternal(url);
  };
  if (parent) void dialog.showMessageBox(parent, box).then(done);
  else void dialog.showMessageBox(box).then(done);
}


//===========================
// Notification setup
//===========================

function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.gmaildesktop.app');
  const ses = session.fromPartition(SESSION_PARTITION);
  // Everything except notifications, which the app draws itself — see
  // sessionPermissionAllowed for why granting them put mail on the Windows shelf.
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(sessionPermissionAllowed(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => sessionPermissionAllowed(permission));
}


//===========================
// IPC handlers
//===========================

function registerIpc(): void {
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
    composePicker.settle(typeof index === 'number' ? index : null);
  });
  // The picker measures its own card once it has laid out, because no constant over a row
  // count can know how a subject wraps or what the OS font metrics are. The window is
  // still hidden at this point, so the resize is invisible and the reveal happens here.
  ipcMain.on(IPC.COMPOSE_ACCOUNT_SIZE, (e, size: { width: number; height: number }) => {
    const win = composeAccountWindow;
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (!Number.isFinite(size?.width) || !Number.isFinite(size?.height)) return;
    const applied = resizeAndShowComposeAccountWindow(win, size.width, size.height);
    if (DEV_URL) {
      console.log(
        `[picker] measured ${size.width}x${size.height} css, setContentSize ${applied.width}x${applied.height}`,
      );
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    const url = extractMailtoFromArgv(argv);
    if (url) void dispatchMailto(url);
  });
}


//===========================
// App lifecycle
//===========================

app.on('open-url', (event, url) => {
  event.preventDefault();
  void dispatchMailto(url);
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_e, wc) => {
    attachContextMenu(wc, () => {
      if (prefs?.getAll().reneMode) return LABELS_RENE;
      return currentLocale() === 'nl' ? LABELS_NL : LABELS_NORMAL;
    });
  });
  app.on('session-created', (s) => attachSessionHandlers(s));
  attachSessionHandlers(session.defaultSession);
  setExternalOpener(openExternalGuarded);
  // Late-bound on purpose: broadcast publishes the profile list and the OAuth layer re-checks
  // the links for it, so wiring the two here is what keeps them from importing each other.
  setOnProfilesPushed(() => scheduleOAuthHealthCheck());
  setUpdateHooks({
    openSettingsPanel: () => openSettingsPanel(),
    onStatusChanged: () => refreshTray(),
  });
  setNotifyGatingHooks({ onDndCleared: () => refreshTray() });
  setToastActivationHooks({
    reopenWindow: () => createWindow(),
    openSettingsPanel: () => openSettingsPanel(),
  });
  setViewSurfaceHooks({ flushPendingMailto: () => flushPendingMailto() });
  setTrayHooks({
    refreshNotifyAllowed: () => refreshNotifyAllowed(),
    activateAccount: (accountKey) => activateNotification(accountKey, 'mail'),
    setAutoStart: (v) => setAutoStart(v),
  });
  registerAppProtocol();
  setupNotifications();
  registerIpc();
  nativeTheme.on('updated', () => {
    applyTitleBarOverlay();
    // Only matters while the choice is "system", but the resolver is the one that knows
    // that, and asking it costs a boolean.
    toasts?.refresh();
  });
  screen.on('display-metrics-changed', () => toasts?.reposition());
  createWindow();
  // Registering every launch keeps the exe path right after an update or a move, and
  // is what makes the app show up in Windows Settings at all.
  void ensureMailClientRegistered();
  const initialMailto = extractMailtoFromArgv(process.argv);
  if (initialMailto) setPendingMailto(initialMailto);
  startNotifyTimer();
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
  applyTraySetting();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  setupUpdater();
  applyAutoUpdateCheck();
});

app.on('window-all-closed', () => {
});
app.on('before-quit', () => {
  setIsQuitting(true);
  pushManager?.stop();
});

