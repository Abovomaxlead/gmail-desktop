// The entry point: the switches that must be thrown before Electron is ready, the app://
// scheme, the single-instance lock, the app's lifecycle, and the wiring that introduces the
// modules to each other. The work itself lives in those modules.
//
// Ordering that breaks if moved: disableHardwareAcceleration and the WSL rendering switch
// must run before 'ready', which is what the throwaway PrefsStore is for; 'session-created'
// and the context menu must be registered before createWindow; the nativeTheme listener
// belongs here because it also refreshes the toast stack, which createWindow builds.
//
// The hooks. Four modules take a dependency pointing back up the stack, and each is wired
// here rather than imported, because importing it would close a loop. All four are set
// before createWindow, so nothing fires against the no-op defaults they start with.

import { app, protocol, net, session, Menu, screen, nativeTheme } from 'electron';
import { join } from 'node:path';
import { release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { RENDERER_DIST } from './core/paths';
import { PrefsStore } from './core/prefs-store';
import { registerIpc } from './core/ipc-handlers';
import { setOnProfilesPushed, setRetainNotifyGating } from './core/broadcast';
import { pickVariant } from './core/locale';
import {
  currentLocale,
  mainWindow,
  prefs,
  messageIndex,
  setIsQuitting,
  pendingMailtos,
  toasts,
  profiles,
  keyOf,
} from './core/runtime';
import { createWindow, openSettingsPanel } from './windows/main-window';
import { applyTitleBarOverlay } from './windows/window-chrome';
import { bringToFront } from './windows/window-focus';
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
  retainNotifyGating,
  setNotifyGatingHooks,
  startNotifyTimer,
} from './notify/notify-gating';
import { applyTraySetting, refreshTray, setTrayHooks } from './menus/tray-setup';
import { applyAutoUpdateCheck, setUpdateHooks, setupUpdater } from './updates/update-controller';
import { attachContextMenu, LABELS_NORMAL, LABELS_RENE, LABELS_NL } from './menus/context-menu';
import {
  setAccountEmailLookup,
  setExternalOpener,
  setGoogleAppsRouting,
} from './system/external-links';
import { extractMailtoFromArgv } from './compose/mailto';
import { startMailDropCleanup } from './mail/pull/mail-drop-cleanup';
import { mailDropFolder, resumeOrphanedCopyRuns, showJobReport } from './mail/mail-drop-controller';
import { notifyLog } from './notify/notify-log';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from './system/app-scheme';
import { flushCrashReports, installCrashReporting } from './feedback/crash-controller';


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

// Before anything else that can fail: a crash while the switches above are being thrown, or
// while the window is being built, is exactly the crash a user cannot report themselves --
// there is no window to report it from. The queue this fills is sent once there is a mailbox
// to send from, which is after createWindow.
installCrashReporting();


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
    bringToFront(mainWindow);
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
  setRetainNotifyGating(retainNotifyGating);
  setUpdateHooks({
    openSettingsPanel: (section) => openSettingsPanel(section),
    onStatusChanged: () => refreshTray(),
  });
  setNotifyGatingHooks({ onDndCleared: () => refreshTray() });
  setToastActivationHooks({
    openSettingsPanel: (section) => openSettingsPanel(section),
    openJobReport: () => showJobReport(),
  });
  setTrayHooks({
    refreshNotifyAllowed: () => refreshNotifyAllowed(),
    activateAccount: (key) => activateNotification(key, 'mail'),
    setAutoStart: (v) => setAutoStart(v),
    openFeedback: () => openSettingsPanel('feedback'),
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
    attachContextMenu(wc, () =>
      pickVariant(currentLocale(), prefs?.getAll().reneMode === true, {
        en: LABELS_NORMAL,
        nl: LABELS_NL,
        rene: LABELS_RENE,
      }),
    );
  });
  app.on('session-created', (s) => attachSessionHandlers(s));
  attachSessionHandlers(session.defaultSession);
  setExternalOpener(openExternalGuarded);
  setGoogleAppsRouting(() => prefs?.getAll().googleApps ?? null);
  setAccountEmailLookup((key) => profiles.find((p) => keyOf(p) === key)?.email || null);
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
  if (initialMailto) pendingMailtos.push(initialMailto);
  startNotifyTimer();
  // After createWindow, which is what builds the prefs store the folder is read from.
  startMailDropCleanup(() => mailDropFolder());
  // Best-effort, and silent when there is nothing to do: a run whose journal already recorded
  // what to do with its markers is finished without asking; one that crashed before deciding
  // is left for the mail-drop window to ask about the next time it opens. If the oauth store
  // is not ready yet this early, its mailboxes simply fail to open and are picked up again on
  // the next start -- this never blocks startup on it.
  void resumeOrphanedCopyRuns().catch((e) => notifyLog(`[maildrop] resuming failed: ${e}`));
  app.setLoginItemSettings({ openAtLogin: prefs!.getAll().autoStart });
  applyTraySetting();
  setupUpdater();
  applyAutoUpdateCheck();
  // Whatever crashed on the last run, or before the window existed on this one. Never awaited
  // and never fatal: it does nothing when the queue is empty, and leaves the queue alone when
  // no mailbox can send yet.
  void flushCrashReports();
});

app.on('window-all-closed', () => {
});

// Set the moment the flush starts, so a second quit while it is in flight does not start a
// second one or cancel the exit that follows it.
let quitFlushStarted = false;

app.on('before-quit', (event) => {
  if (quitFlushStarted) return;
  quitFlushStarted = true;
  event.preventDefault();
  setIsQuitting(true);
  void (async () => {
    // Awaited so the write a drag just triggered lands on disk before the process is gone --
    // Electron otherwise tears the app down while the writes are still in flight. A throwing
    // flush must not block quitting.
    try {
      await messageIndex?.flush(Date.now());
    } catch (e) {
      console.warn(`[index] flush failed while quitting: ${e}`);
    }
    app.exit();
  })();
});
