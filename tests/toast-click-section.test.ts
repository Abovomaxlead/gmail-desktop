// Which settings section a notification card opens.
//
// An update card said "there is a new version" and, clicked, opened the settings panel
// wherever the user had last left it -- openSettingsPanel takes a section and was called
// with none. So the one card whose whole purpose is to get you to the Updates section
// dropped you in General, which is the report this holds shut.
//
// The account-error card goes through the same branch and deliberately keeps its old
// behaviour: it is raised when adding an account failed, so Updates would be the wrong
// place to send it, and no section at all is the honest answer until somebody decides.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ openSettingsPanel: vi.fn() }));

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));

vi.mock('../electron/core/runtime', () => ({
  authRef: (index: number) => ({ kind: 'authuser', index }),
  idxOfKey: () => null,
  keyOf: (p: { ref: { index: number } }) => `u${p.ref.index}`,
  mainWindow: {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  },
  manager: {},
  prefs: { getAll: () => ({ notificationOpen: 'inline' }) },
  profiles: [],
  setSettingsPanelOpen: vi.fn(),
  settingsPanelOpen: false,
}));

vi.mock('../electron/windows/view-surfaces', () => ({ showAccount: vi.fn() }));
vi.mock('../electron/compose/compose-window', () => ({ openFullThreadWindow: vi.fn() }));
vi.mock('../electron/system/session-setup', () => ({
  forgetDownloadClickPath: vi.fn(),
  takeDownloadClickAction: vi.fn(),
}));
vi.mock('../electron/auth/mailbox-token', () => ({ withTokenFor: () => undefined }));
vi.mock('../electron/gmail/gmail-api', () => ({
  fetchRecentInboxIds: async () => [],
  fetchMessageMeta: async () => null,
  archiveMessage: vi.fn(),
  markMessageRead: vi.fn(),
}));

const { activateToast, setToastActivationHooks } = await import(
  '../electron/toast/toast-activation'
);

beforeEach(() => {
  state.openSettingsPanel.mockClear();
  setToastActivationHooks({ openSettingsPanel: state.openSettingsPanel });
});

const card = (kind: string) =>
  ({ id: 1, kind, title: 't', body: 'b', at: 0 }) as unknown as Parameters<typeof activateToast>[0];

describe('clicking a notification card', () => {
  it('takes an update card to the Updates section', () => {
    activateToast(card('update'));
    expect(state.openSettingsPanel).toHaveBeenCalledWith('updates');
  });

  // Not Updates: this card is raised when an account could not be added.
  it('takes an account error to the panel without naming a section', () => {
    activateToast(card('error'));
    expect(state.openSettingsPanel).toHaveBeenCalledWith();
  });
});
