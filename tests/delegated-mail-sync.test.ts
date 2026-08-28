// Notifying for a mailbox reached by delegation.
//
// Gmail raises no desktop notification in a delegated view -- weeks of notify.log hold the
// shim being installed in those views and never one notification out of them, across
// moments where their unread count demonstrably rose. So for these mailboxes the API sweep
// is not a safety net behind the page, it is the only voice, and what this file holds shut
// is that it speaks for new mail, stays quiet about the backlog that was already there, and
// says so when the relay will not let it read at all.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  toasts: [] as Array<Record<string, unknown>>,
  logs: [] as string[],
  cursors: new Map<string, string>(),
  added: [] as Array<{ id: string; labelIds: string[] }>,
  internalDate: 0,
  tokenError: null as string | null,
  notifyPref: undefined as boolean | undefined,
  historyId: 'h100',
  relayUrl: 'https://relay.example/token' as string | null,
}));

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() } }));

vi.mock('../electron/core/runtime', () => ({
  coverage: { has: () => false, since: () => null, forget: vi.fn() },
  history: {
    get: (email: string) => state.cursors.get(email),
    set: (email: string, id: string) => state.cursors.set(email, id),
  },
  messageIndex: null,
  pushManager: null,
  oauthTokens: null,
  prefs: {
    getAll: () => ({
      reneMode: false,
      notifications: {
        dnd: false,
        quietHours: { enabled: false, start: '18:00', end: '08:00' },
        showSender: true,
        showSubject: true,
        sound: true,
        googleApps: true,
      },
      accounts: { 'support@example.nl': { notify: state.notifyPref } },
      verificationCodes: { autoCopy: false },
    }),
  },
  profiles: [{ kind: 'delegated', email: 'support@example.nl', ref: { kind: 'delegated' } }],
  setPushManager: vi.fn(),
  syncRunners: new Map(),
  currentLocale: () => 'nl',
}));

vi.mock('../electron/auth/oauth-config', () => ({
  delegatedTokenUrl: () => state.relayUrl,
  oauthConfig: () => null,
  pushConfig: () => null,
}));

vi.mock('../electron/auth/mailbox-token', () => ({
  withTokenFor: () => null,
  withDelegatedToken:
    () =>
    async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
      if (state.tokenError) throw new Error(state.tokenError);
      return fn('relay-token');
    },
}));

vi.mock('../electron/auth/oauth-flow', () => ({ accessTokenFor: vi.fn(), forceRefresh: vi.fn() }));
vi.mock('../electron/auth/oauth-health-check', () => ({
  checkOAuthHealth: vi.fn(),
  clearPushRefusal: vi.fn(),
  clearRefreshFailure: vi.fn(),
  markRefreshFailed: vi.fn(),
  notePushRefused: vi.fn(),
  scheduleOAuthHealthCheck: vi.fn(),
}));
vi.mock('../electron/auth/google-oauth', () => ({ hasScopes: () => false }));
vi.mock('../electron/push/push-manager', () => ({ startPushManager: vi.fn() }));

vi.mock('../electron/notify/notify-gating', () => ({
  hiddenNotificationText: () => ({}),
  playNotificationSound: vi.fn(),
  refreshNotifyAllowed: vi.fn(),
  reportApiUnread: vi.fn(),
}));
vi.mock('../electron/notify/notify-log', () => ({
  notifyLog: (line: string) => state.logs.push(line),
}));
vi.mock('../electron/toast/toast-presenter', () => ({
  showToast: (t: Record<string, unknown>) => state.toasts.push(t),
  toastAccountFor: (email: string) => ({ key: 'd:1', email, label: email, color: '#000' }),
}));

// The error class stays real: the runner tells an expired cursor from any other failure with
// instanceof, and a stand-in would make every failure look like a fresh mailbox.
vi.mock('../electron/gmail/gmail-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchProfileHistoryId: async () => state.historyId,
    fetchHistoryPage: async () => ({
      added: state.added,
      historyId: 'h200',
      nextPageToken: undefined,
    }),
    fetchMessageMeta: async (_t: string, id: string) => ({
      id,
      threadId: 't-' + id,
      messageId: '<' + id + '@example.nl>',
      from: 'Klant <klant@example.nl>',
      subject: 'Vraag over de factuur',
      internalDate: state.internalDate,
    }),
    fetchInboxUnread: async () => {
      throw new Error('the delegated sweep must not ask for the unread count');
    },
    fetchMessageRaw: vi.fn(),
    markMessageRead: vi.fn(),
    trashMessage: vi.fn(),
    watchMailbox: vi.fn(),
  };
});

const { startMailSync, stopMailboxSync } = await import('../electron/push/mail-sync-controller');

const SYNC_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  state.toasts = [];
  state.logs = [];
  state.cursors.clear();
  state.added = [];
  state.internalDate = 0;
  state.tokenError = null;
  state.notifyPref = undefined;
  state.historyId = 'h100';
  state.relayUrl = 'https://relay.example/token';
  stopMailboxSync('support@example.nl');
});

afterEach(() => {
  stopMailboxSync('support@example.nl');
  vi.clearAllTimers();
  vi.useRealTimers();
});

/**
 * Starts the watch and lets the first, silent sweep finish
 *
 * The first sweep has no cursor to walk from, so it only writes down where Gmail is now.
 * Every test needs that to have happened before it can say anything about the second.
 *
 * @private
 */
async function watchFrom(): Promise<void> {
  startMailSync();
  await vi.advanceTimersByTimeAsync(0);
}

describe('the delegated sweep', () => {
  it('says nothing on the first pass, which only marks where Gmail is', async () => {
    state.added = [{ id: 'm1', labelIds: ['INBOX'] }];
    await watchFrom();
    expect(state.toasts).toEqual([]);
    expect(state.cursors.get('support@example.nl')).toBe('h100');
  });

  it('raises a card for mail that arrived after the watch began', async () => {
    await watchFrom();
    state.added = [{ id: 'm1', labelIds: ['INBOX'] }];
    state.internalDate = Date.now() + 1000;
    await vi.advanceTimersByTimeAsync(SYNC_MS);

    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({
      kind: 'mail',
      title: 'Klant',
      body: 'Vraag over de factuur',
      threadId: 't-m1',
      messageId: 'm1',
    });
  });

  // The mailbox this was built for held twenty-seven unread. Announcing the backlog every
  // time an update restarts the app is worse than announcing nothing.
  it('stays quiet about mail that was already there', async () => {
    await watchFrom();
    state.added = [{ id: 'oud', labelIds: ['INBOX'] }];
    state.internalDate = Date.now() - 60 * 60_000;
    await vi.advanceTimersByTimeAsync(SYNC_MS);

    expect(state.toasts).toEqual([]);
    // Quiet because it looked and judged, not because it never looked: the cursor only moves
    // past a history page that was actually walked.
    expect(state.cursors.get('support@example.nl')).toBe('h200');
  });

  it('leaves the per-account switch in charge', async () => {
    state.notifyPref = false;
    await watchFrom();
    state.added = [{ id: 'm1', labelIds: ['INBOX'] }];
    state.internalDate = Date.now() + 1000;
    await vi.advanceTimersByTimeAsync(SYNC_MS);

    expect(state.toasts).toEqual([]);
  });

  it('skips what Gmail filed under Promotions', async () => {
    await watchFrom();
    state.added = [{ id: 'm1', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }];
    state.internalDate = Date.now() + 1000;
    await vi.advanceTimersByTimeAsync(SYNC_MS);

    expect(state.toasts).toEqual([]);
  });
});

// A mailbox that cannot be read is exactly as silent as one with no mail, which is the
// failure this whole thing exists to end. So it has to leave a line -- and only one, or a
// relay that is down for an afternoon fills the log with the same sentence.
describe('a relay that will not hand over a token', () => {
  it('writes down the reason it gave', async () => {
    state.tokenError = 'Geen van je accounts heeft toegang tot dit postvak';
    await watchFrom();
    expect(state.logs.filter((l) => l.includes('kon niet gelezen worden'))).toEqual([
      '[notify] gedelegeerd postvak support@example.nl kon niet gelezen worden: Geen van je accounts heeft toegang tot dit postvak',
    ]);
  });

  it('does not repeat itself every minute', async () => {
    state.tokenError = 'Relay niet bereikbaar';
    await watchFrom();
    await vi.advanceTimersByTimeAsync(SYNC_MS * 5);
    expect(state.logs.filter((l) => l.includes('kon niet gelezen worden'))).toHaveLength(1);
  });
});

// Last, and it has to stay last: the line is written once per session, and every test above
// runs with a relay configured, so this is the only run in which it can be written at all.
describe('a machine with no relay at all', () => {
  it('says once that these mailboxes cannot notify', async () => {
    state.relayUrl = null;
    await watchFrom();
    await vi.advanceTimersByTimeAsync(SYNC_MS * 3);

    expect(state.logs).toEqual([
      '[notify] geen relay ingesteld; 1 gedelegeerd(e) postvak(ken) kunnen niet melden',
    ]);
    expect(state.toasts).toEqual([]);
  });
});
