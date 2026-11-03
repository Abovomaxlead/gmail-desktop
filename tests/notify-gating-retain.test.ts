// notify-gating logs only the changes of whether a mail view may notify, remembered per
// account. An account that was removed and later added back must be logged again: the
// memory of its old answer has to go when it leaves, or the second arrival reads as
// "unchanged" and notify.log never says the view may notify.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '../electron/core/prefs-store';
import { refreshNotifyAllowed, retainNotifyGating } from '../electron/notify/notify-gating';

const state = vi.hoisted(() => ({
  profiles: [] as { ref: { kind: 'authuser'; index: number }; email: string }[],
  logged: [] as string[],
}));

vi.mock('../electron/core/broadcast', () => ({
  pushUnread: () => {},
  pushPrefs: () => {},
  refreshBadge: () => {},
}));

vi.mock('../electron/core/runtime', () => ({
  keyOf: (p: { ref: { index: number } }) => `u${p.ref.index}`,
  mainWindow: null,
  manager: null,
  prefs: { getAll: () => DEFAULT_PREFS, setNotifications: () => {} },
  get profiles() {
    return state.profiles;
  },
  unread: { get: () => null },
}));

vi.mock('../electron/notify/notify-log', () => ({
  notifyLog: (line: string) => state.logged.push(line),
}));

const ana = { ref: { kind: 'authuser' as const, index: 0 }, email: 'ana@example.com' };
const transitions = () => state.logged.filter((l) => l.includes('mail view for ana@example.com'));

describe('retainNotifyGating', () => {
  it('logs the transition again for an account that left and came back', () => {
    state.profiles = [ana];
    refreshNotifyAllowed();
    expect(transitions()).toHaveLength(1);

    state.profiles = [];
    retainNotifyGating([]);
    refreshNotifyAllowed();

    state.profiles = [ana];
    retainNotifyGating([ana.email]);
    refreshNotifyAllowed();
    expect(transitions()).toHaveLength(2);
  });

  it('keeps the memory of an account that is still there', () => {
    state.logged = [];
    state.profiles = [ana];
    retainNotifyGating([ana.email]);
    refreshNotifyAllowed();
    expect(transitions()).toHaveLength(0);
  });
});
