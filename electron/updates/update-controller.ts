// Everything about a new version: asking whether there is one, fetching it, reporting
// progress and installing it. electron-updater does the transfer; the decisions are here.
//
// Two are worth knowing before reading. A failed download is retried rather than reported,
// so an error only appears once there is nothing left to try — see update-retry.ts. And a
// check started from the tray owes an answer even when it is "nothing new", so that one
// check remembers it has a dialog to pop.
//
// A third, about error text. What reaches the panel goes through updateErrorText:
// electron-updater's message is written for a log and carries the response headers as JSON,
// which the Updates section rendered verbatim. The full text is never lost — autoUpdater
// writes update.log — so the retry decision and the log line keep the raw message and only
// the panel gets the shortened one.
//
// The status lives in runtime, because the tray and the settings panel both draw from it
// and it must survive the window this module has no hand in creating.

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
import { parseChangelog } from './changelog';
import type { ChangelogVersion } from '../../renderer/lib/changelog-types';
import { prereleaseAllowed } from './update-channel';
import { shouldNotifyUpdate } from './update-notifier';
import { updateCheckPopup } from './update-popup';
import { UPDATE_RETRY_DELAY_MS, shouldRetryDownload } from './update-retry';
import { NO_RELEASE_ERROR, updateErrorText } from './update-error';
import { createUpdateLog, type UpdateLogger } from './update-log';
import { showToast } from '../toast/toast-presenter';
import { playNotificationSound } from '../notify/notify-gating';


//===========================
// Types
//===========================

/** What this module needs from layers that sit above it. Injected rather than imported
 * because each of these already reaches down for the functions here — the tray menu offers
 * check, download and install, and the settings panel is where a check reports back. */
export interface UpdateHooks {
  openSettingsPanel(section?: string): void;
  onStatusChanged(): void;
}


//===========================
// Module state
//===========================

let hooks: UpdateHooks = {
  openSettingsPanel: () => {},
  onStatusChanged: () => {},
};

let downloadAttempt = 0;
let downloadInFlight = false;
let downloadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let updateLog: UpdateLogger | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;


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
 * @returns empty when the file is missing, which it is in a checkout that has never been
 *   packaged
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
  autoUpdater.checkForUpdates().catch((err) => reportCheckFailure(String(err?.message || err)));
}

export function checkForUpdateFromTray(): void {
  // The same reasoning as the update card: somebody who asked for a check from the tray is
  // owed the section that answers, not the one they happened to leave open.
  hooks.openSettingsPanel('updates');
  pendingTrayUpdateCheck = true;
  checkForUpdate();
}

export function downloadUpdate(): void {
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

/**
 * Points the updater at the stable or the prerelease releases
 *
 * Reads the setting each time rather than remembering it, so the switch takes effect on the
 * next check instead of the next launch.
 */
export function applyUpdateChannel(): void {
  autoUpdater.allowPrerelease = prereleaseAllowed(
    prefs?.getAll().updates.allowPrerelease,
    app.getVersion(),
  );
  // Set explicitly although false is already the default, because this is the promise that an
  // update never walks backwards -- and autoUpdater's `channel` setter turns it on behind your
  // back, so the intent belongs in writing next to the flag it guards.
  autoUpdater.allowDowngrade = false;
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
  updateLog = createUpdateLog(join(app.getPath('userData'), 'update.log'));
  autoUpdater.logger = updateLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  applyUpdateChannel();
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendUpdate({ state: 'available', version: info.version });
    maybeNotifyUpdate(info.version);
  });
  autoUpdater.on('update-not-available', (info) =>
    sendUpdate({ state: 'not-available', version: info.version }),
  );
  autoUpdater.on('error', (err) => {
    if (downloadInFlight) return;
    reportCheckFailure(String(err?.message || err));
  });
  autoUpdater.on('download-progress', (p) =>
    sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  // Downloaded is where a download stops. It used to install from here, which made
  // "download" mean "restart and install now" -- and the flag it hung on could never be
  // false, since attemptUpdateDownload is reachable only from downloadUpdate. Publishing the
  // state is the whole of the offer: the Updates section draws its 'restart and install'
  // button on it and the tray item becomes an install item. installUpdate is the only thing
  // that quits, and autoInstallOnAppQuit covers the user who simply closes the app.
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdate({ state: 'downloaded', version: info.version });
  });
}


//===========================
// Helper functions
//===========================

/** The one place the update state is written and published */
function sendUpdate(status: Record<string, unknown>): void {
  setLastUpdateStatus({ ...status, currentVersion: app.getVersion() });
  mainWindow?.webContents.send(IPC.UPDATE_STATUS, lastUpdateStatus);
  hooks.onStatusChanged();
  maybeShowTrayUpdatePopup();
}

/**
 * Publishes the outcome of a check that came back with an error
 *
 * A stable channel on a repository whose only releases are prereleases -- the state you land
 * in the moment the prerelease switch goes off on a beta build -- makes GitHub answer with an
 * error, and it used to reach the panel as one: a red line naming a URL and an HTTP status
 * about a release that was never published. There is nothing wrong and nothing to retry, so
 * it gets a state of its own that says what is actually true, and the raw text still goes to
 * update.log for anyone reading it.
 *
 * @param raw electron-updater's own message
 * @private
 */
function reportCheckFailure(raw: string): void {
  if (NO_RELEASE_ERROR.test(raw)) {
    updateLog?.info(`no release to update to: ${updateErrorText(raw)}`);
    return sendUpdate({ state: 'no-release' });
  }
  sendUpdate({ state: 'error', message: updateErrorText(raw) });
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
  showToast({
    kind: 'update',
    title: L.updateAvailableTitle,
    body: L.updateAvailableBody(version),
    persist: true,
  });
  if (prefs) playNotificationSound(prefs.getAll());
}

function attemptUpdateDownload(): void {
  downloadRetryTimer = null;
  downloadAttempt += 1;
  const attempt = downloadAttempt;

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
        sendUpdate({ state: 'error', message: updateErrorText(message) });
        return;
      }
      updateLog?.warn(`download attempt ${attempt} failed, retrying: ${message}`);

      sendUpdate({ state: 'downloading', percent: 0 });
      downloadRetryTimer = setTimeout(attemptUpdateDownload, UPDATE_RETRY_DELAY_MS);
    });
}
