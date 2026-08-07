// Which accounts need reconnecting, why, and the size of the reconnect banner.

import { describe, it, expect } from 'vitest';
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from '../electron/oauth-health';

const input = (over: Partial<Parameters<typeof accountsNeedingReconnect>[0]> = {}) => ({
  ownEmails: ['a@x.nl', 'b@x.nl'],
  hasToken: () => true,
  refreshFailed: () => false,
  pushConfigured: true,
  missingScopes: () => false,
  pushRefused: () => false,
  ...over,
});

const expired = (email: string) => ({ email, reason: 'expired' });
const push = (email: string) => ({ email, reason: 'push' });

describe('accountsNeedingReconnect', () => {
  it('is empty when every account has a working token', () => {
    expect(accountsNeedingReconnect(input())).toEqual([]);
  });

  it('flags an account without a token', () => {
    expect(accountsNeedingReconnect(input({ hasToken: (e) => e !== 'b@x.nl' }))).toEqual([
      expired('b@x.nl'),
    ]);
  });

  it('flags an account whose refresh failed', () => {
    expect(accountsNeedingReconnect(input({ refreshFailed: (e) => e === 'a@x.nl' }))).toEqual([
      expired('a@x.nl'),
    ]);
  });

  it('flags several at once, in the order given', () => {
    expect(accountsNeedingReconnect(input({ hasToken: () => false }))).toEqual([
      expired('a@x.nl'),
      expired('b@x.nl'),
    ]);
  });

  it('ignores accounts that are not listed as own (delegated mailboxes)', () => {
    expect(accountsNeedingReconnect(input({ ownEmails: [], hasToken: () => false }))).toEqual([]);
  });
});

describe('accountsNeedingReconnect — scopes', () => {
  const base = {
    ownEmails: ['a@x.nl'],
    hasToken: () => true,
    refreshFailed: () => false,
    pushConfigured: true,
    missingScopes: () => false,
    pushRefused: () => false,
  };

  it('leaves a healthy account alone', () => {
    expect(accountsNeedingReconnect(base)).toEqual([]);
  });

  it('asks to reconnect an account whose token predates a new scope', () => {
    expect(accountsNeedingReconnect({ ...base, missingScopes: () => true })).toEqual([
      push('a@x.nl'),
    ]);
  });

  it('says nothing about a missing scope when push is not configured at all', () => {
    expect(
      accountsNeedingReconnect({ ...base, pushConfigured: false, missingScopes: () => true }),
    ).toEqual([]);
  });

  it('says nothing about a refused token when push is not configured', () => {
    expect(
      accountsNeedingReconnect({ ...base, pushConfigured: false, pushRefused: () => true }),
    ).toEqual([]);
  });

  it('asks to reconnect an account the relay refused for good', () => {
    expect(accountsNeedingReconnect({ ...base, pushRefused: () => true })).toEqual([push('a@x.nl')]);
  });

  it('reports an account once, with the reason that weighs heaviest', () => {
    expect(
      accountsNeedingReconnect({ ...base, hasToken: () => false, missingScopes: () => true }),
    ).toEqual([expired('a@x.nl')]);
  });

  it('keeps the reasons apart when both kinds are in the list', () => {
    expect(
      accountsNeedingReconnect({
        ...base,
        ownEmails: ['a@x.nl', 'b@x.nl'],
        hasToken: (e) => e !== 'a@x.nl',
        missingScopes: (e) => e === 'b@x.nl',
      }),
    ).toEqual([expired('a@x.nl'), push('b@x.nl')]);
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

// The status the accounts panel draws. The precedence between the states is the part worth
// pinning down: a link that is gone outranks a scope that is missing, because re-granting
// a scope on an account with no token cannot succeed.
describe('accountOAuthStatuses', () => {
  const one = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) => ({
    ownEmails: ['a@x.nl'],
    hasToken: () => true,
    refreshFailed: () => false,
    pushConfigured: true,
    missingScopes: () => false,
    pushRefused: () => false,
    ...over,
  });
  const statusOf = (over: Partial<Parameters<typeof accountOAuthStatuses>[0]> = {}) =>
    accountOAuthStatuses(one(over))[0].status;

  it('is linked when the token works and push is happy', () => {
    expect(statusOf()).toBe('linked');
  });

  it('is unlinked when no token was ever stored', () => {
    expect(statusOf({ hasToken: () => false })).toBe('unlinked');
  });

  it('is expired when the refresh failed', () => {
    expect(statusOf({ refreshFailed: () => true })).toBe('expired');
  });

  it('is push-only when the token predates a scope push needs', () => {
    expect(statusOf({ missingScopes: () => true })).toBe('push-only');
  });

  it('is push-only when the relay refused the token for good', () => {
    expect(statusOf({ pushRefused: () => true })).toBe('push-only');
  });

  // Same rule the banner has always had: every pre-existing token predates the push scope,
  // so counting that as a fault would flag every machine after an update.
  it('is linked despite a push problem when push is not configured at all', () => {
    expect(
      statusOf({ pushConfigured: false, missingScopes: () => true, pushRefused: () => true }),
    ).toBe('linked');
  });

  it('prefers unlinked over a push problem', () => {
    expect(statusOf({ hasToken: () => false, missingScopes: () => true })).toBe('unlinked');
  });

  it('prefers expired over a push problem', () => {
    expect(statusOf({ refreshFailed: () => true, pushRefused: () => true })).toBe('expired');
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

// The test that protects the decision this change is built on. The banner and the accounts
// panel must never disagree about the same account, which is guaranteed only while the
// reconnect list is a projection of the statuses. Every combination of the five inputs is
// checked, so a future state added to OAuthStatus without a mapping fails here rather than
// silently dropping an account out of the banner.
describe('accountsNeedingReconnect follows accountOAuthStatuses', () => {
  const bools = [true, false];
  const cases: Parameters<typeof accountsNeedingReconnect>[0][] = [];
  for (const token of bools)
    for (const failed of bools)
      for (const configured of bools)
        for (const scopes of bools)
          for (const refused of bools)
            cases.push({
              ownEmails: ['a@x.nl'],
              hasToken: () => token,
              refreshFailed: () => failed,
              pushConfigured: configured,
              missingScopes: () => scopes,
              pushRefused: () => refused,
            });

  it.each(cases.map((input, i) => ({ i, input })))(
    'case $i reports exactly what the statuses imply',
    ({ input }) => {
      const expected = accountOAuthStatuses(input)
        .filter((s) => s.status !== 'linked')
        .map((s) => ({ email: s.email, reason: s.status === 'push-only' ? 'push' : 'expired' }));
      expect(accountsNeedingReconnect(input)).toEqual(expected);
    },
  );
});
