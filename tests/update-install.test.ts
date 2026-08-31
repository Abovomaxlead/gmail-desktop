// When a downloaded update is actually installed.
//
// Downloading and installing were one action. The update-downloaded handler called
// quitAndInstall() straight away, and update.log shows how straight away: the file landed at
// 06:13:20.064 and "Install on explicit quitAndInstall" was written at 06:13:20.072, eight
// milliseconds later. So pressing "download" restarted the app and installed, with nothing
// asked -- the report this holds shut.
//
// The flag it hung on could never be false. updateRequested was set by downloadUpdate(), and
// attemptUpdateDownload() was reachable from nowhere else, so by the time a download finished
// it was always true.
//
// Both ways of asking for it are already built and were simply unreachable: the Updates
// section shows a "restart and install" button on the downloaded state, and the tray item
// becomes an install item. And autoInstallOnAppQuit stays on, so quitting normally installs.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  quitAndInstall: vi.fn(),
  downloadUpdate: vi.fn(async () => undefined),
  isQuitting: vi.fn(),
  sent: [] as unknown[],
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.0',
    getName: () => 'Gmail Desktop',
    getPath: () => 'C:/userData',
  },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: true,
    logger: null,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      state.handlers.set(event, cb);
    },
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: state.downloadUpdate,
    quitAndInstall: state.quitAndInstall,
  },
}));

vi.mock('../electron/core/runtime', () => ({
  currentLocale: () => 'nl',
  lastUpdateStatus: {},
  mainWindow: { isDestroyed: () => false, webContents: { send: (..._a: unknown[]) => {} } },
  prefs: { getAll: () => ({ updates: {}, reneMode: false }) },
  setIsQuitting: state.isQuitting,
  setLastUpdateStatus: (s: unknown) => state.sent.push(s),
}));

vi.mock('../electron/core/paths', () => ({ CHANGELOG_PATH: 'CHANGELOG.md' }));
vi.mock('../electron/menus/native-labels', () => ({
  nativeLabels: () => ({ updateAvailableTitle: 't', updateAvailableBody: () => 'b' }),
}));
vi.mock('../electron/updates/update-log', () => ({
  createUpdateLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../electron/toast/toast-presenter', () => ({ showToast: vi.fn() }));
vi.mock('../electron/notify/notify-gating', () => ({ playNotificationSound: vi.fn() }));

const { setupUpdater, downloadUpdate, installUpdate } = await import(
  '../electron/updates/update-controller'
);

/** Drives the event electron-updater raises when the file is on disk. */
const finishDownload = () => state.handlers.get('update-downloaded')?.({ version: '1.2.3' });

beforeEach(() => {
  state.quitAndInstall.mockClear();
  state.isQuitting.mockClear();
  state.sent.length = 0;
  setupUpdater();
});

describe('a finished download', () => {
  it('does not install by itself', () => {
    downloadUpdate();
    finishDownload();

    expect(state.quitAndInstall).not.toHaveBeenCalled();
    expect(state.isQuitting).not.toHaveBeenCalled();
  });

  // The state is what lights up the button in the panel and the item in the tray, so it is
  // the whole of the offer to install and has to be published.
  it('reports the version as downloaded, so the install offer appears', () => {
    downloadUpdate();
    finishDownload();

    expect(state.sent.at(-1)).toMatchObject({ state: 'downloaded', version: '1.2.3' });
  });

  it('installs once, and only once, the user asks', () => {
    downloadUpdate();
    finishDownload();
    installUpdate();

    expect(state.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(state.isQuitting).toHaveBeenCalledWith(true);
  });

  // Left on deliberately: not installing now must not mean never. Closing the app installs
  // what was fetched, which is the quiet half of the same promise.
  it('leaves the install-on-quit promise in place', async () => {
    const { autoUpdater } = await import('electron-updater');
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdater.autoDownload).toBe(false);
  });
});
