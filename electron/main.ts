// The entry point: the switches that must be thrown before Electron is ready, the app://
// scheme, the single-instance lock, the app's lifecycle, and the wiring that introduces the
// modules to each other. The work itself lives in those modules.
//
// Ordering that breaks if moved: disableHardwareAcceleration and the WSL rendering switch
// must run before 'ready', which is what the throwaway PrefsStore is for; 'session-created'
// and the context menu must be registered before createWindow; the nativeTheme listener
// belongs here, since createWindow runs again and would leak one each time.
//
// The hooks. Four modules take a dependency pointing back up the stack, and each is wired
// here rather than imported, because importing it would close a loop. All four are set
// before createWindow, so nothing fires against the no-op defaults they start with.

import { app, BrowserWindow, protocol, net, session, Menu, screen, nativeTheme } from 'electron';
import { join } from 'node:path';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { RENDERER_DIST } from './core/paths';
import { PrefsStore } from './core/prefs-store';
import { registerIpc } from './core/ipc-handlers';
import { setOnProfilesPushed } from './core/broadcast';
import {
  currentLocale,
  mainWindow,
  prefs,
  pushManager,
  setIsQuitting,
  setPendingMailto,
  toasts,
} from './core/runtime';
import { createWindow, openSettingsPanel } from './windows/main-window';
import { applyTitleBarOverlay } from './windows/window-chrome';
import { openExternalGuarded } from './windows/surface-opener';
import { dispatchMailto } from './compose/mailto-controller';
import { activateNotification, setToastActivationHooks } from './toast/toast-activation';
import { scheduleOAuthHealthCheck } from './auth/oauth-health-check';
import { attachSessionHandlers } from './system/session-setup';
import {
  ensureMailClientRegistered,
  setAutoStart,
  setupNotifications,
} from './system/system-integration';
import {
  refreshNotifyAllowed,
  setNotifyGatingHooks,
  startNotifyTimer,
} from './notify/notify-gating';
import { applyTraySetting, refreshTray, setTrayHooks } from './menus/tray-setup';
import { applyAutoUpdateCheck, setUpdateHooks, setupUpdater } from './updates/update-controller';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE, LABELS_NL } from './menus/context-menu';
import { setExternalOpener } from './system/external-links';
import { extractMailtoFromArgv } from './mail/mailto';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from './system/app-scheme';


//===========================
// Startup switches
//===========================

if (process.platform === 'linux' && /microsoft|WSL/i.test(release())) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Read straight off disk rather than through the runtime's store, which does not exist yet:
// this has to be decided before 'ready', and createWindow is what builds the real one.
try {
  const early = new PrefsStore(join(app.getPath('userData'), 'prefs.json')).getAll();
  if (early.advanced.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch {
}


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
// Single instance
//===========================

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
// Wiring
//===========================

/** The dependencies that point up the stack. See the note at the top of this file for why
 * each one is a hook and not an import. */
function wireModules(): void {
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
  setTrayHooks({
    refreshNotifyAllowed: () => refreshNotifyAllowed(),
    activateAccount: (key) => activateNotification(key, 'mail'),
    setAutoStart: (v) => setAutoStart(v),
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
  wireModules();
  registerAppProtocol();
  setupNotifications();
  registerIpc();
  nativeTheme.on('updated', () => {
    applyTitleBarOverlay();
    toasts?.refresh();
  });
  screen.on('display-metrics-changed', () => toasts?.reposition());
  createWindow();

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
