// Whether a stale consent continuation can clobber a walk that superseded it.
//
// redetect() bumps a run token when it starts a new walk; a consent await left over from
// the previous walk must see that token go stale and do nothing instead of touching this
// walk's probingIndex or timer -- see dist/audit/core-infra.md, "redetect() and an
// in-flight consent share one probe slot".

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  ensured: [] as number[],
  discarded: [] as string[],
  switched: [] as number[],
  profiles: [] as Array<Record<string, unknown>>,
}));

// Mirrors detection-controller's own PROBE_TIMEOUT_MS; not exported, so restated here.
const PROBE_TIMEOUT_MS = 16000;

let resolveConsent: (result: { ok: boolean; error?: string }) => void;

vi.mock('../electron/core/runtime', () => ({
  SESSION_PARTITION: 'persist:test',
  accountCache: { remove: vi.fn() },
  authIdx: (p: { ref: { index: number } }) => p.ref.index,
  authRef: (index: number) => ({ kind: 'authuser', index }),
  colors: { get: () => '#000000' },
  currentLocale: () => 'nl',
  delegated: { remove: vi.fn() },
  hidden: { list: () => [], has: () => false, remove: vi.fn(), add: vi.fn() },
  history: { remove: vi.fn() },
  keyOf: (p: { ref: { index: number } }) => `u${p.ref.index}`,
  keyOfIndex: (i: number) => `u${i}`,
  mainWindow: { isDestroyed: () => false },
  manager: {
    ensureView: (ref: { index: number }) => state.ensured.push(ref.index),
    discardView: (key: string) => state.discarded.push(key),
    activeKey: () => 'u0',
    pushMailDropAllowed: vi.fn(),
  },
  oauthTokens: { get: () => undefined, remove: vi.fn() },
  prefs: { getAll: () => ({ reneMode: false }) },
  profiles: state.profiles,
  setCachedAccounts: vi.fn(),
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
  showAccount: (ref: { index: number }) => state.switched.push(ref.index),
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
  addDelegatedMailboxes: vi.fn(),
}));
vi.mock('../electron/auth/oauth-flow', () => ({
  // Promise.withResolvers needs a newer lib target than this project's tsconfig sets.
  connectAccount: vi.fn(
    () =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        resolveConsent = resolve;
      }),
  ),
}));
vi.mock('../electron/auth/account-domain', () => ({ isAllowedAccount: () => true }));
vi.mock('../electron/auth/token-revoke', () => ({ revokeRefreshToken: vi.fn() }));
vi.mock('../electron/auth/oauth-config', () => ({ oauthConfig: () => ({}) }));
vi.mock('../electron/gmail/gmail-api', () => ({ stopWatch: vi.fn() }));
vi.mock('../electron/gmail/google-urls', () => ({ addAccountUrl: () => 'https://mail.google.com/mail/?addaccount' }));

const { addAccount, redetect, onIdentity } = await import('../electron/accounts/detection-controller');

const identity = (email: string) => ({ email, name: email, avatarUrl: '' });

beforeEach(() => {
  vi.useFakeTimers();
  state.ensured = [];
  state.discarded = [];
  state.switched = [];
  state.profiles.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('redetect() during an in-flight consent', () => {
  it('leaves a stale continuation unable to touch the walk that superseded it', async () => {
    state.profiles.push({ ref: { kind: 'authuser', index: 0 }, kind: 'authuser', email: 'existing@example.nl' });

    // The + button probes index 1; the page then reports an identity that needs consent.
    addAccount();
    onIdentity(1, identity('new@example.nl'));
    expect(state.ensured).toEqual([1]);

    // A second walk starts while the first is still waiting on the consent screen.
    redetect();
    state.ensured = [];
    // probingIndex was already nulled by onIdentity, so redetect() finds nothing of the
    // stale walk left to discard.
    expect(state.discarded).toEqual([]);

    // The consent the first (now superseded) walk was waiting on resolves.
    resolveConsent!({ ok: true });
    // The continuation resumes over several microtask ticks (the awaited connectAccount
    // call, then the synchronous body past it); flush enough of them to let it fully settle.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    // With the bug present this resumes as a normal success: it registers the account,
    // switches to it, and calls probe(2) -- observable here as an unasked-for ensureView(2).
    expect(state.profiles.map((p) => p.email)).toEqual(['existing@example.nl']);
    expect(state.switched).toEqual([]);
    expect(state.ensured).toEqual([]);

    // The new walk's own probe timer must still be the one running: advancing past its
    // timeout discards its view instead of leaving nothing scheduled at all.
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
    expect(state.discarded).toEqual(['u1']);
  });
});

describe('an identity report from a view the walk no longer owns', () => {
  it('is ignored while that account is still in consent', () => {
    state.profiles.push({ ref: { kind: 'authuser', index: 0 }, kind: 'authuser', email: 'existing@example.nl' });

    addAccount();
    onIdentity(1, identity('new@example.nl'));
    state.ensured = [];

    // The page polls its identity every second, so the same report arrives again while the
    // consent screen is still up. Acting on it registers an account that has not consented.
    onIdentity(1, identity('new@example.nl'));

    expect(state.profiles.map((p) => p.email)).toEqual(['existing@example.nl']);
    expect(state.ensured).toEqual([]);
  });
});
