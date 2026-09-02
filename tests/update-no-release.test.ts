// A check that comes back with "there is no release for this channel".
//
// Turning the prerelease switch off on a beta build points the updater at
// /releases/latest, and a repository that has only ever published prereleases answers
// with an error. That error reached the Updates section verbatim -- a red line naming a
// URL and "HttpError: 406" about a release that was never published -- which is the
// report this holds shut. Nothing is wrong and nothing can be retried, so it is a state
// of its own and not a failure.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  sent: [] as unknown[],
  logged: [] as unknown[],
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.0-beta.1788180489',
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
    checkForUpdates: vi.fn(async () => {
      throw new Error(NO_RELEASE_MESSAGE);
    }),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock('../electron/core/runtime', () => ({
  currentLocale: () => 'nl',
  lastUpdateStatus: {},
  mainWindow: { isDestroyed: () => false, webContents: { send: (..._a: unknown[]) => {} } },
  prefs: { getAll: () => ({ updates: { allowPrerelease: false }, reneMode: false }) },
  setIsQuitting: vi.fn(),
  setLastUpdateStatus: (s: unknown) => state.sent.push(s),
}));

vi.mock('../electron/core/paths', () => ({ CHANGELOG_PATH: 'CHANGELOG.md' }));
vi.mock('../electron/menus/native-labels', () => ({
  nativeLabels: () => ({ updateAvailableTitle: 't', updateAvailableBody: () => 'b' }),
}));
vi.mock('../electron/updates/update-log', () => ({
  createUpdateLog: () => ({
    info: (m: unknown) => state.logged.push(m),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../electron/toast/toast-presenter', () => ({ showToast: vi.fn() }));
vi.mock('../electron/notify/notify-gating', () => ({ playNotificationSound: vi.fn() }));

// The message from the report, verbatim.
const NO_RELEASE_MESSAGE =
  'Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/Abovomaxlead/gmail-desktop/releases/latest), please ensure a production release exists: HttpError: 406\nHeaders: {\n  "server": "github.com"\n}';

// Imported after the mocks above are in place: a static import would pull in the real
// electron and electron-updater modules, which do not run outside a packaged app.
const { setupUpdater, checkForUpdate } = await import('../electron/updates/update-controller');

beforeEach(() => {
  state.sent.length = 0;
  state.logged.length = 0;
  setupUpdater();
});

describe('a check with no release to update to', () => {
  it('reports no-release instead of an error, for the rejected check', async () => {
    checkForUpdate({ background: true });
    await vi.waitFor(() => expect(state.sent.length).toBeGreaterThan(1));

    expect(state.sent.at(-1)).toMatchObject({
      state: 'no-release',
      currentVersion: '1.0.0-beta.1788180489',
    });
    expect(JSON.stringify(state.sent.at(-1))).not.toContain('HttpError');
  });

  it('reports no-release for the same thing arriving as an error event', () => {
    state.handlers.get('error')?.(new Error(NO_RELEASE_MESSAGE));

    expect(state.sent.at(-1)).toMatchObject({ state: 'no-release' });
  });

  it('keeps the full picture in update.log', () => {
    state.handlers.get('error')?.(new Error(NO_RELEASE_MESSAGE));

    expect(String(state.logged.at(-1))).toContain('production release exists');
  });

  it('still reports a real failure as a failure', () => {
    state.handlers.get('error')?.(new Error('sha512 checksum mismatch, expected AAA, got BBB'));

    expect(state.sent.at(-1)).toMatchObject({
      state: 'error',
      message: 'sha512 checksum mismatch, expected AAA, got BBB',
    });
  });
});
