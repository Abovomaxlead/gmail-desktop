// Whether a mailbox the user waved away stays away.
//
// Both discovery paths keep finding it -- own accounts are probed at /mail/u/0 upward every
// launch, delegations are named by the relay whenever it is asked -- so "removed" is only as
// durable as the two gates tested here. The store itself is tests/hidden-store.test.ts; what
// this file holds shut is that the gates are consulted at all, and that the probe still walks
// past a hidden account instead of stopping at it.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reconcileDelegations } from '../electron/delegation/delegated-reconcile';

const state = vi.hoisted(() => ({
  hiddenList: [] as Array<{ email: string; kind: 'authuser' | 'delegated' }>,
  ensured: [] as number[],
  discarded: [] as string[],
  added: [] as Array<[string, string]>,
  profiles: [] as Array<Record<string, unknown>>,
}));

vi.mock('../electron/core/runtime', () => ({
  SESSION_PARTITION: 'persist:test',
  accountCache: { remove: vi.fn() },
  authIdx: (p: { ref: { index: number } }) => p.ref.index,
  authRef: (index: number) => ({ kind: 'authuser', index }),
  colors: { get: () => '#000000' },
  coverage: { forget: vi.fn() },
  currentLocale: () => 'nl',
  delegated: { remove: vi.fn() },
  hidden: {
    list: () => state.hiddenList,
    has: (email: string) => state.hiddenList.some((h) => h.email === email.toLowerCase()),
    add: (email: string, kind: string) => {
      state.added.push([email, kind]);
    },
    remove: vi.fn(),
  },
  history: { remove: vi.fn() },
  keyOf: (p: { ref: { index: number } }) => `u${p.ref.index}`,
  keyOfIndex: (i: number) => `u${i}`,
  mainWindow: null,
  manager: {
    ensureView: (ref: { index: number }) => state.ensured.push(ref.index),
    discardView: (key: string) => state.discarded.push(key),
    activeKey: () => 'u0',
  },
  oauthTokens: { get: () => undefined, remove: vi.fn() },
  prefs: { getAll: () => ({ reneMode: false }) },
  profiles: state.profiles,
  setCachedAccounts: vi.fn(),
  syncRunners: new Map(),
  unread: { forget: vi.fn() },
}));

vi.mock('../electron/core/broadcast', () => ({
  pushActive: vi.fn(),
  pushHidden: vi.fn(),
  pushProfiles: vi.fn(),
  pushUnread: vi.fn(),
  refreshBadge: vi.fn(),
}));
vi.mock('../electron/windows/view-surfaces', () => ({
  showAccount: vi.fn(),
  syncCalendarViews: vi.fn(),
  trimViewsToVisible: vi.fn(),
  warmAccount: vi.fn(),
}));
vi.mock('../electron/notify/notify-gating', () => ({
  refreshNotifyAllowed: vi.fn(),
  playNotificationSound: vi.fn(),
}));
vi.mock('../electron/toast/toast-presenter', () => ({ showToast: vi.fn() }));
vi.mock('../electron/push/mail-sync-controller', () => ({
  startMailSync: vi.fn(),
  stopMailboxSync: vi.fn(),
}));
vi.mock('../electron/delegation/delegated-controller', () => ({
  maybeStartDelegatedApiScan: vi.fn(),
  refreshDelegatedFromApi: vi.fn(),
}));
vi.mock('../electron/auth/oauth-flow', () => ({ connectAccount: vi.fn() }));
vi.mock('../electron/auth/account-domain', () => ({ isAllowedAccount: () => true }));
vi.mock('../electron/auth/token-revoke', () => ({ revokeRefreshToken: vi.fn() }));
vi.mock('../electron/auth/oauth-config', () => ({ oauthConfig: () => null }));
vi.mock('../electron/gmail/gmail-api', () => ({ stopWatch: vi.fn() }));

const { onIdentity, removeAccount } = await import('../electron/accounts/detection-controller');

const identity = (email: string) => ({ email, name: email, avatarUrl: '' });

beforeEach(() => {
  state.hiddenList = [];
  state.ensured = [];
  state.discarded = [];
  state.added = [];
  state.profiles.length = 0;
});


//===========================
// Own accounts
//===========================

// One address per test: the addresses detection has already seen live in module state and
// outlast a test, and a repeat is exactly what tells detection it has reached the end of the
// list -- so a second test reusing an address would pass without the gate doing anything.
describe('an own account that was waved away', () => {
  it('draws no row when the probe finds it again', () => {
    state.hiddenList = [{ email: 'weg@example.nl', kind: 'authuser' }];
    onIdentity(0, identity('weg@example.nl'));
    expect(state.profiles).toHaveLength(0);
  });

  // The index it sits at is Google's, not ours: stopping there would cost every account
  // behind it, so the walk has to step over it.
  it('does not stop the walk at the index it sits at', () => {
    state.hiddenList = [{ email: 'stap-over@example.nl', kind: 'authuser' }];
    onIdentity(0, identity('stap-over@example.nl'));
    expect(state.ensured).toContain(1);
  });

  it('takes the probe view away again', () => {
    state.hiddenList = [{ email: 'geen-view@example.nl', kind: 'authuser' }];
    onIdentity(0, identity('geen-view@example.nl'));
    expect(state.discarded).toContain('u0');
  });

  // Google hands the same account back for an index that holds nothing, and a repeat is
  // what ends the walk. A hidden account still has to count as seen, or the walk runs to the
  // ceiling opening views for accounts that are not there.
  it('still counts as seen, so the repeat that ends the walk is recognised', () => {
    state.hiddenList = [{ email: 'gezien@example.nl', kind: 'authuser' }];
    onIdentity(0, identity('gezien@example.nl'));
    state.ensured = [];
    onIdentity(1, identity('gezien@example.nl'));
    expect(state.ensured).toEqual([]);
  });

  it('is registered as usual when it is not on the list', () => {
    onIdentity(0, identity('blijft@example.nl'));
    expect(state.profiles.map((p) => p.email)).toEqual(['blijft@example.nl']);
  });
});

describe('removing a mailbox', () => {
  it('remembers a delegated one as delegated', () => {
    state.profiles.push({
      ref: { kind: 'delegated', index: -1 },
      kind: 'delegated',
      email: 'support@example.nl',
    });
    removeAccount('support@example.nl');
    expect(state.added).toEqual([['support@example.nl', 'delegated']]);
  });

  it('remembers an own account as an own account', () => {
    state.profiles.push({ ref: { kind: 'authuser', index: 0 }, kind: 'authuser', email: 'a@example.nl' });
    removeAccount('a@example.nl');
    expect(state.added).toEqual([['a@example.nl', 'authuser']]);
  });
});


//===========================
// Delegated mailboxes
//===========================

// The gate is that a hidden mailbox is handed to reconcileDelegations as one already held:
// held addresses are never in `add`, so the relay naming it does not draw it, and a held
// address no answer names comes back in `remove`, which is what prunes the entry once the
// delegation is really gone.
describe('a delegated mailbox that was waved away', () => {
  const answer = (mailboxes: string[]) => [{ ok: true as const, email: 'me@example.nl', mailboxes }];

  it('is not added back when the relay still names it', () => {
    const at = reconcileDelegations({
      stored: ['support@example.nl'],
      answers: answer(['support@example.nl']),
      requesters: 1,
    });
    expect(at.add).toEqual([]);
  });

  it('is offered for pruning once no answer names it any more', () => {
    const at = reconcileDelegations({
      stored: ['support@example.nl'],
      answers: answer(['info@example.nl']),
      requesters: 1,
    });
    expect(at.remove).toEqual(['support@example.nl']);
    expect(at.add).toEqual(['info@example.nl']);
  });

  // The same doubt that refuses a real removal has to refuse a prune: one own account that
  // could not be asked is not proof that a delegation is gone.
  it('is left alone when an own account could not be asked', () => {
    const at = reconcileDelegations({
      stored: ['support@example.nl'],
      answers: answer(['info@example.nl']),
      requesters: 2,
    });
    expect(at.remove).toEqual([]);
    expect(at.why).toBe('incomplete');
  });
});
