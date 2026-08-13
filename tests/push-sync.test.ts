// The sync runner: first run, history deltas, recovery, resilience and coalescing.

import { describe, it, expect } from 'vitest';
import { createSyncRunner, type SyncClient, type SyncOutcome } from '../electron/push/push-sync';
import type { HistoryPage, MessageMeta } from '../electron/gmail/gmail-api';

const meta = (id: string, internalDate: number): MessageMeta => ({
  id,
  threadId: `t-${id}`,
  from: 'Jan <jan@x.nl>',
  subject: `Onderwerp ${id}`,
  internalDate,
});

interface FakeOptions {
  pages?: Record<string, HistoryPage>;
  profileHistoryId?: string | null;
  metas?: Record<string, MessageMeta | null>;
  unread?: number | null;
  historyThrows?: unknown;
  metaThrows?: Set<string>;
  unreadThrows?: boolean;
}

function fake(options: FakeOptions = {}) {
  const calls = { history: [] as string[], profile: 0, meta: [] as string[], unread: 0 };
  const client: SyncClient = {
    async profileHistoryId() {
      calls.profile += 1;
      return options.profileHistoryId === undefined ? '5000' : options.profileHistoryId;
    },
    async historyPage(start, pageToken) {
      calls.history.push(pageToken ? `${start}:${pageToken}` : start);
      if (options.historyThrows) throw options.historyThrows;
      return options.pages?.[pageToken ?? start] ?? { added: [], historyId: start };
    },
    async messageMeta(id) {
      calls.meta.push(id);
      if (options.metaThrows?.has(id)) throw new Error('metadata weg');
      return options.metas?.[id] ?? meta(id, 2000);
    },
    async inboxUnread() {
      calls.unread += 1;
      if (options.unreadThrows) throw new Error('teller onbereikbaar');
      return options.unread ?? 3;
    },
  };
  return { client, calls };
}

function runner(options: FakeOptions & { stored?: string; coveredSince?: number | null } = {}) {
  const { client, calls } = fake(options);
  let stored = options.stored;
  const outcomes: SyncOutcome[] = [];
  const errors: unknown[] = [];
  const r = createSyncRunner({
    client,
    cursor: { get: () => stored, set: (v) => (stored = v) },
    coveredSince: () => (options.coveredSince === undefined ? 1000 : options.coveredSince),
    isExpiredCursor: (e) => (e as { status?: number })?.status === 404,
    onOutcome: (o) => outcomes.push(o),
    onError: (e) => errors.push(e),
  });
  return { r, calls, outcomes, errors, cursor: () => stored };
}

describe('createSyncRunner — first run', () => {
  it('baselines on the profile history id and notifies nothing', async () => {
    const t = runner({ profileHistoryId: '5000' });
    await t.r.run();
    expect(t.cursor()).toBe('5000');
    expect(t.outcomes[0].notify).toEqual([]);
    expect(t.outcomes[0].rebaselined).toBe(true);
    expect(t.calls.history).toEqual([]);
  });

  it('still reports the unread count on a baseline', async () => {
    const t = runner({ profileHistoryId: '5000', unread: 9 });
    await t.r.run();
    expect(t.outcomes[0].unread).toBe(9);
  });

  it('leaves the cursor unset when the profile has no history id', async () => {
    const t = runner({ profileHistoryId: null });
    await t.r.run();
    expect(t.cursor()).toBeUndefined();
  });
});

describe('createSyncRunner — delta', () => {
  it('notifies for new inbox mail and advances the cursor', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': { added: [{ id: 'm1', labelIds: ['INBOX', 'UNREAD'] }], historyId: '5000' },
      },
      metas: { m1: meta('m1', 2000) },
    });
    await t.r.run();
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m1']);
    expect(t.cursor()).toBe('5000');
  });

  it('walks every page before advancing the cursor', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX'] }],
          historyId: '4950',
          nextPageToken: 'p2',
        },
        p2: { added: [{ id: 'm2', labelIds: ['INBOX'] }], historyId: '5000' },
      },
    });
    await t.r.run();
    expect(t.calls.history).toEqual(['4900', '4900:p2']);
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(t.cursor()).toBe('5000');
  });

  it('skips promotions without fetching their metadata', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }],
          historyId: '5000',
        },
      },
    });
    await t.r.run();
    expect(t.calls.meta).toEqual([]);
    expect(t.outcomes[0].notify).toEqual([]);
  });

  it('stays quiet for mail older than the moment coverage began', async () => {
    const t = runner({
      stored: '4900',
      coveredSince: 5000,
      pages: { '4900': { added: [{ id: 'm1', labelIds: ['INBOX'] }], historyId: '5000' } },
      metas: { m1: meta('m1', 1000) },
    });
    await t.r.run();
    expect(t.outcomes[0].notify).toEqual([]);
    expect(t.outcomes[0].unread).toBe(3);
  });

  it('keeps the count right when one message metadata fetch fails', async () => {
    const t = runner({
      stored: '4900',
      pages: {
        '4900': {
          added: [{ id: 'm1', labelIds: ['INBOX'] }, { id: 'm2', labelIds: ['INBOX'] }],
          historyId: '5000',
        },
      },
      metaThrows: new Set(['m1']),
    });
    await t.r.run();
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m2']);
    expect(t.outcomes[0].unread).toBe(3);
    expect(t.cursor()).toBe('5000');
  });

  it('still notifies when the unread count fetch itself fails', async () => {
    const t = runner({
      stored: '4900',
      pages: { '4900': { added: [{ id: 'm1', labelIds: ['INBOX'] }], historyId: '5000' } },
      unreadThrows: true,
    });
    await t.r.run();
    expect(t.outcomes[0].notify.map((m) => m.id)).toEqual(['m1']);
    expect(t.outcomes[0].unread).toBeNull();
    expect(t.cursor()).toBe('5000');
  });
});

describe('createSyncRunner — recovery', () => {
  it('re-baselines when the cursor is too old', async () => {
    const t = runner({
      stored: '1',
      historyThrows: { status: 404 },
      profileHistoryId: '5000',
    });
    await t.r.run();
    expect(t.cursor()).toBe('5000');
    expect(t.outcomes[0].rebaselined).toBe(true);
    expect(t.outcomes[0].notify).toEqual([]);
  });

  it('does not advance the cursor when a page fails', async () => {
    const t = runner({ stored: '4900', historyThrows: { status: 500 } });
    await t.r.run();
    expect(t.cursor()).toBe('4900');
    expect(t.outcomes).toEqual([]);
    expect(t.errors).toHaveLength(1);
  });

  it('does not advance the cursor when a later page fails', async () => {
    let call = 0;
    const outcomes: SyncOutcome[] = [];
    let stored: string | undefined = '4900';
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => '5000',
        historyPage: async (start) => {
          call += 1;
          if (call === 1) return { added: [], historyId: '4950', nextPageToken: 'p2' };
          throw { status: 500 };
        },
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: (e) => (e as { status?: number })?.status === 404,
      onOutcome: (o) => outcomes.push(o),
    });
    await r.run();
    expect(stored).toBe('4900');
    expect(outcomes).toEqual([]);
  });
});

describe('createSyncRunner — resilience', () => {
  it('does not wedge after a baseline failure: the next run performs a fresh pass', async () => {
    let profileCalls = 0;
    const outcomes: SyncOutcome[] = [];
    const errors: unknown[] = [];
    let stored: string | undefined;
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => {
          profileCalls += 1;
          if (profileCalls === 1) throw new Error('profiel onbereikbaar');
          return '5000';
        },
        historyPage: async (start) => ({ added: [], historyId: start }),
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: () => false,
      onOutcome: (o) => outcomes.push(o),
      onError: (e) => errors.push(e),
    });

    await expect(r.run()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(stored).toBeUndefined();

    await r.run();
    expect(profileCalls).toBe(2);
    expect(stored).toBe('5000');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].rebaselined).toBe(true);
  });

  it('recovers after a failing pass: a later run succeeds normally', async () => {
    let call = 0;
    const outcomes: SyncOutcome[] = [];
    const errors: unknown[] = [];
    let stored: string | undefined = '4900';
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => '5000',
        historyPage: async (start) => {
          call += 1;
          if (call === 1) throw { status: 500 };
          return { added: [], historyId: '5000' };
        },
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: () => false,
      onOutcome: (o) => outcomes.push(o),
      onError: (e) => errors.push(e),
    });

    await r.run();
    expect(errors).toHaveLength(1);
    expect(stored).toBe('4900');
    expect(outcomes).toEqual([]);

    await r.run();
    expect(stored).toBe('5000');
    expect(outcomes).toHaveLength(1);
  });
});

describe('createSyncRunner — coalescing', () => {
  it('runs once more instead of running twice at the same time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    let stored: string | undefined = '4900';
    let first = true;
    const r = createSyncRunner({
      client: {
        profileHistoryId: async () => '5000',
        historyPage: async (start) => {
          seen.push(start);
          if (first) {
            first = false;
            await gate;
          }
          return { added: [], historyId: '5000' };
        },
        messageMeta: async (id) => meta(id, 2000),
        inboxUnread: async () => 3,
      },
      cursor: { get: () => stored, set: (v) => (stored = v) },
      coveredSince: () => 1000,
      isExpiredCursor: () => false,
      onOutcome: () => {},
    });
    const a = r.run();
    const b = r.run();
    const c = r.run();
    expect(seen).toEqual(['4900']);
    release();
    await Promise.all([a, b, c]);
    expect(seen).toEqual(['4900', '5000']);
  });
});
