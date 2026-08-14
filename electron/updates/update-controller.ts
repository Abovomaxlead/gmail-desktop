// Everything about a new version: asking whether there is one, fetching it, reporting where
// that got to, and installing it. electron-updater does the transfer; what lives here is the
// decisions around it.
//
// Two of those decisions are worth knowing about before reading. A failed download is
// retried rather than reported, because the sha512 mismatch seen in the field was answered
// by clicking download again — the shape of a bad transfer, not a bad release — so an error
// is only shown once there is nothing left to try; see update-retry.ts for which failures
// are worth another attempt. And a check started from the tray owes the user an answer even
// when the answer is "nothing new", which the settings panel alone would never say out loud,
// so that one check remembers it has a dialog to pop.
//
// The status is kept in runtime rather than here: the tray menu and the settings panel both
// draw from it, and it has to survive the window this module has no hand in creating.

import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../core/ipc';
import { CHANGELOG_PATH } from '../core/paths';
import {
  currentLocale,
  lastUpdateStatus,
  mainWindow,
  prefs,
  setIsQuitting,
  setLastUpdateStatus,
} from '../core/runtime';
import { nativeLabels } from '../menus/native-labels';
import { parseChangelog, type ChangelogVersion } from './changelog';
import { shouldNotifyUpdate } from './update-notifier';
import { updateCheckPopup } from './update-popup';
import { UPDATE_RETRY_DELAY_MS, shouldRetryDownload } from './update-retry';
import { createUpdateLog, type UpdateLogger } from './update-log';
import type { ToastInput } from '../toast/toast-controller';


//===========================
// Types
//===========================

/** What this module needs from layers that sit above it. Injected rather than imported: the
 * tray draws the update state and the toast stack shows it, and both already reach for the
 * functions here. */
export interface UpdateHooks {
  /** Brought to the front before a tray-started check, so its answer lands somewhere. */
  openSettingsPanel(): void;
  showToast(input: ToastInput): void;
  playNotificationSound(): void;
  /** The status changed; whatever else draws it should redraw. */
  onStatusChanged(): void;
}


//===========================
// Module state
//===========================

let hooks: UpdateHooks = {
  openSettingsPanel: () => {},
  showToast: () => {},
  playNotificationSound: () => {},
  onStatusChanged: () => {},
};

let updateRequested = false;
let downloadAttempt = 0;
let downloadInFlight = false;
let downloadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let updateLog: UpdateLogger | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;

/** Set by a check the user started from the tray, so its result gets a dialog rather than
 * only a line in a panel they may not be looking at. */
let pendingTrayUpdateCheck = false;

let notifiedUpdateVersion: string | null = null;
let lastCheckBackground = false;


//===========================
// Exported functions
//===========================

export function setUpdateHooks(h: UpdateHooks): void {
  hooks = h;
}

/**
 * The release notes the settings panel shows
 *
 * @returns {ChangelogVersion[]} empty when the file is missing, which it is in a checkout
 *   that has never been packaged
 */
export function loadChangelog(): ChangelogVersion[] {
  try {
    return parseChangelog(readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}

export function checkForUpdate(opts?: { background?: boolean }): void {
  lastCheckBackground = opts?.background === true;
  if (!app.isPackaged) return sendUpdate({ state: 'dev' });
  sendUpdate({ state: 'checking' });
  autoUpdater
    .checkForUpdates()
    .catch((err) => sendUpdate({ state: 'error', message: String(err?.message || err) }));
}

export function checkForUpdateFromTray(): void {
  hooks.openSettingsPanel();
  pendingTrayUpdateCheck = true;
  checkForUpdate();
}

// A download that failed once is not a download that cannot be done. The sha512 mismatch
// reported from the field was answered by clicking download again a few times, which is
// the shape of a bad transfer rather than a bad release: electron-updater throws the
// cached file away behind a failed attempt, so the next one starts clean and there is
// nothing left over to fail the same way. Doing that here means the person is not asked to
// work it out. The error is still shown, just only once there is nothing left to try — and
// the failures that will never come good, an invalid signature above all, are not retried
// at all. See update-retry.ts.
export function downloadUpdate(): void {
  updateRequested = true;
  if (downloadRetryTimer) {
    clearTimeout(downloadRetryTimer);
    downloadRetryTimer = null;
  }
  downloadAttempt = 0;
  attemptUpdateDownload();
}

export function installUpdate(): void {
  setIsQuitting(true);
  autoUpdater.quitAndInstall();
}

export function applyAutoUpdateCheck(): void {
  const on = app.isPackaged && prefs?.getAll().updates.autoCheck !== false;
  if (on && !updateTimer) {
    checkForUpdate({ background: true });
    updateTimer = setInterval(() => checkForUpdate({ background: true }), 30 * 60_000);
    return;
  }
  if (!on && updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

export function setupUpdater(): void {
  // electron-updater logs to `console` by default, which a packaged Windows build has no
  // attachment for, so everything it says about a failed update is written to nowhere.
  // That is why the sha512 report could not be traced any further than its dialog.
  updateLog = createUpdateLog(join(app.getPath('userData'), 'update.log'));
  autoUpdater.logger = updateLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  autoUpdater.on('update-not-available', (info) =>
    sendUpdate({ state: 'not-available', version: info.version }),
  );
  autoUpdater.on('error', (err) => {
    // A download decides its own reporting in attemptUpdateDownload, which may be about to
    // retry this. Everything else — a failed check above all — is reported here.
    if (downloadInFlight) return;
    sendUpdate({ state: 'error', message: String(err?.message || err) });
  });
  autoUpdater.on('download-progress', (p) =>
    sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
    if (updateRequested) {
      setIsQuitting(true);
      autoUpdater.quitAndInstall();
    }
  });
}


//===========================
// Helper functions
//===========================

/** The one place the update state is written and published. */
function sendUpdate(status: Record<string, unknown>): void {
  setLastUpdateStatus({ ...status, currentVersion: app.getVersion() });
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
  hooks.onStatusChanged();
  maybeShowTrayUpdatePopup();
}

/** The answer to a check the user started from the tray. Nothing else pops a dialog: a
 * background check that finds nothing has nobody waiting on it. */
function maybeShowTrayUpdatePopup(): void {
  if (!pendingTrayUpdateCheck) return;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  const popup = updateCheckPopup(lastUpdateStatus as { state: string }, L);
  if (!popup) return;
  pendingTrayUpdateCheck = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Gmail Desktop',
      message: popup.message,
      detail: popup.detail,
      buttons: popup.buttons,
      defaultId: 0,
      cancelId: popup.buttons.length - 1,
      noLink: true,
    })
    .then((res) => {
      if (popup.downloadButtonIndex != null && res.response === popup.downloadButtonIndex) {
        downloadUpdate();
      }
    });
}

function maybeNotifyUpdate(version: string): void {
  if (prefs?.getAll().updates.notify === false) return;
  if (
    !shouldNotifyUpdate({
      state: 'available',
      version,
      background: lastCheckBackground,
      notifiedVersion: notifiedUpdateVersion,
    })
  )
    return;
  notifiedUpdateVersion = version;
  const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
  hooks.showToast({
    kind: 'update',
    title: L.updateAvailableTitle,
    body: L.updateAvailableBody(version),
    persist: true,
  });
  // A system toast made its own noise; ours does not. Without this the update and the
  // failed account link are the only two app toasts that arrive in silence, which reads
  // as a missed notification rather than a quiet one. The shared 1.5s throttle in
  // playNotificationSound is what keeps a burst from turning into a chord.
  hooks.playNotificationSound();
}

function attemptUpdateDownload(): void {
  downloadRetryTimer = null;
  downloadAttempt += 1;
  const attempt = downloadAttempt;
  // A failed download reports itself twice: electron-updater emits `error` on its way to
  // rejecting the promise. The event arrives first and knows nothing about the retry that
  // is about to happen, so on its own it would flash an error state this function takes
  // back a moment later — and an error state is what pops the tray dialog. Whether a
  // download failure is worth reporting is decided here and nowhere else.
  downloadInFlight = true;
  autoUpdater
    .downloadUpdate()
    .then(() => {
      downloadInFlight = false;
    })
    .catch((err) => {
      downloadInFlight = false;
      const message = String(err?.message || err);
      if (!shouldRetryDownload(message, attempt)) {
        updateLog?.error(`download failed after ${attempt} attempt(s): ${message}`);
        sendUpdate({ state: 'error', message });
        return;
      }
      updateLog?.warn(`download attempt ${attempt} failed, retrying: ${message}`);
      // Held at downloading rather than flashed through error: nothing has gone wrong yet
      // that the person could act on, and a percentage that starts over is the honest
      // picture of a transfer that is starting over.
      sendUpdate({ state: 'downloading', percent: 0 });
      downloadRetryTimer = setTimeout(attemptUpdateDownload, UPDATE_RETRY_DELAY_MS);
    });
}
