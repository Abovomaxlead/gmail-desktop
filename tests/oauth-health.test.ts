// Which accounts need reconnecting, and the size of the reconnect banner.

import { describe, it, expect } from 'vitest';
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from '../electron/auth/oauth-health';

const input = (over: Partial<Parameters<typeof accountsNeedingReconnect>[0]> = {}) => ({
  ownEmails: ['a@x.nl', 'b@x.nl'],
  hasToken: () => true,
  refreshFailed: () => false,
  ...over,
});

const named = (email: string) => ({ email });

describe('accountsNeedingReconnect', () => {
  it('is empty when every account has a working token', () => {
    expect(accountsNeedingReconnect(input())).toEqual([]);
  });

  it('flags an account without a token', () => {
    expect(accountsNeedingReconnect(input({ hasToken: (e) => e !== 'b@x.nl' }))).toEqual([
      named('b@x.nl'),
    ]);
  });

  it('flags an account whose refresh failed', () => {
    expect(accountsNeedingReconnect(input({ refreshFailed: (e) => e === 'a@x.nl' }))).toEqual([
      named('a@x.nl'),
    ]);
  });

  it('flags several at once, in the order given', () => {
    expect(accountsNeedingReconnect(input({ hasToken: () => false }))).toEqual([
      named('a@x.nl'),
      named('b@x.nl'),
    ]);
  });

  it('reports an account once when both faults apply to it', () => {
    expect(
      accountsNeedingReconnect(input({ ownEmails: ['a@x.nl'], hasToken: () => false, refreshFailed: () => true })),
    ).toEqual([named('a@x.nl')]);
  });

  it('ignores accounts that are not listed as own (delegated mailboxes)', () => {
    expect(accountsNeedingReconnect(input({ ownEmails: [], hasToken: () => false }))).toEqual([]);
  });
});

describe('bannerBounds', () => {
  const win = { width: 1200, height: 820 };

  it('sits in the bottom right corner with a margin', () => {
    const b = bannerBounds(win, 1);
    expect(b.x + b.width).toBe(win.width - 16);
    expect(b.y + b.height).toBe(win.height - 16);
  });

  it('grows with the number of accounts', () => {
    expect(bannerBounds(win, 4).height).toBeGreaterThan(bannerBounds(win, 1).height);
  });

  it('never takes more than 60% of the window height', () => {
    expect(bannerBounds(win, 50).height).toBeLessThanOrEqual(Math.round(win.height * 0.6));
  });

  it('stays on screen in a narrow window', () => {
    const narrow = { width: 300, height: 400 };
    const b = bannerBounds(narrow, 2);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(narrow.width);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });
});


// The status the accounts panel draws. The precedence is the part worth pinning down: a link
// that was never made outranks one that stopped working, because the panel has to answer
// whether this account was ever connected.
describe('accountOAuthStatuses', () => {
  const one = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) => ({
    ownEmails: ['a@x.nl'],
    hasToken: () => true,
    refreshFailed: () => false,
    ...over,
  });
  const statusOf = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) =>
    accountOAuthStatuses(one(over))[0].status;

  it('is linked when the token works', () => {
    expect(statusOf()).toBe('linked');
  });

  it('is unlinked when no token was ever stored', () => {
    expect(statusOf({ hasToken: () => false })).toBe('unlinked');
  });

  it('is expired when the refresh failed', () => {
    expect(statusOf({ refreshFailed: () => true })).toBe('expired');
  });

  it('prefers unlinked over expired', () => {
    expect(statusOf({ hasToken: () => false, refreshFailed: () => true })).toBe('unlinked');
  });

  it('has one entry per own account, in the order given', () => {
    expect(accountOAuthStatuses(one({ ownEmails: ['b@x.nl', 'a@x.nl'] })).map((s) => s.email)).toEqual([
      'b@x.nl',
      'a@x.nl',
    ]);
  });

  // A delegated mailbox has no link of its own; it is reached through the account that
  // delegates it, and is never in ownEmails.
  it('says nothing at all about an account that is not its own', () => {
    expect(accountOAuthStatuses(one({ ownEmails: [] }))).toEqual([]);
  });
});

// The banner and the accounts panel must never disagree about the same account, which holds
// only while the reconnect list stays a projection of the statuses. Every combination of the
// two inputs is checked, which pins the mapping for the three states they can produce. A
// fourth status would need a new field on HealthInput, so no table of these booleans could
// construct it; what catches an unmapped status is the total Record type on RECONNECT_REASON
// in electron/auth/oauth-health.ts, which turns the omission into a compile error there.
describe('accountsNeedingReconnect follows accountOAuthStatuses', () => {
  const bools = [true, false];
  const cases: Parameters<typeof accountsNeedingReconnect>[0][] = [];
  for (const token of bools)
    for (const failed of bools)
      cases.push({
        ownEmails: ['a@x.nl'],
        hasToken: () => token,
        refreshFailed: () => failed,
      });

  it.each(cases.map((input, i) => ({ i, input })))(
    'case $i reports exactly what the statuses imply',
    ({ input }) => {
      const expected = accountOAuthStatuses(input)
        .filter((s) => s.status !== 'linked')
        .map((s) => ({ email: s.email }));
      expect(accountsNeedingReconnect(input)).toEqual(expected);
    },
  );
});
