// Which addresses may be linked to the Gmail API, and what happens to a token that
// predates that rule.

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_EMAIL_DOMAINS,
  copyTargetEmails,
  isAllowedAccount,
  dropDisallowedTokens,
  linkableOwnEmails,
} from '../electron/auth/account-domain';
import type { StoredToken } from '../electron/auth/google-oauth';

const token = (): StoredToken => ({
  accessToken: 'AT',
  refreshToken: 'RT',
  expiresAt: 0,
  scopes: [],
});

function fakeStore(emails: string[]) {
  const map = new Map(emails.map((e) => [e, token()]));
  const store = {
    connected: () => [...map.keys()],
    remove: (email: string) => map.delete(email),
  };
  return { store, map };
}

describe('isAllowedAccount', () => {
  it('allows the work domain, whatever the casing or padding', () => {
    expect(isAllowedAccount('luca.manuel@abovomaxlead.nl')).toBe(true);
    expect(isAllowedAccount('Luca.Manuel@AboVoMaxLead.NL')).toBe(true);
    expect(isAllowedAccount('  luca@abovomaxlead.nl  ')).toBe(true);
  });

  it('refuses any other domain', () => {
    expect(isAllowedAccount('luca@gmail.com')).toBe(false);
    expect(isAllowedAccount('luca@abovomaxlead.com')).toBe(false);
  });

  it('refuses a domain that only ends in the work domain', () => {
    expect(isAllowedAccount('luca@mail.abovomaxlead.nl')).toBe(false);
    expect(isAllowedAccount('luca@notabovomaxlead.nl')).toBe(false);
  });

  it('refuses anything that is not an address', () => {
    expect(isAllowedAccount('')).toBe(false);
    expect(isAllowedAccount('   ')).toBe(false);
    expect(isAllowedAccount('abovomaxlead.nl')).toBe(false);
    expect(isAllowedAccount('luca@')).toBe(false);
    expect(isAllowedAccount('@abovomaxlead.nl')).toBe(false);
  });

  it('reads the last @ as the separator', () => {
    expect(isAllowedAccount('weird@name@abovomaxlead.nl')).toBe(true);
    expect(isAllowedAccount('luca@abovomaxlead.nl@gmail.com')).toBe(false);
  });

  it('names the work domain', () => {
    expect(ALLOWED_EMAIL_DOMAINS).toContain('abovomaxlead.nl');
  });
});

// What the health check reports on. An account left out here gets no status line and no
// row in the reconnect banner, which is how a private mailbox stays in the sidebar without
// a Verbinden button that could only ever fail.
describe('linkableOwnEmails', () => {
  const authuser = (email: string) => ({ kind: 'authuser' as const, email });

  it('keeps own work accounts in the order given', () => {
    const profiles = [authuser('b@abovomaxlead.nl'), authuser('a@abovomaxlead.nl')];
    expect(linkableOwnEmails(profiles)).toEqual(['b@abovomaxlead.nl', 'a@abovomaxlead.nl']);
  });

  it('leaves out an own account outside the work domain', () => {
    const profiles = [authuser('luca@abovomaxlead.nl'), authuser('luca@gmail.com')];
    expect(linkableOwnEmails(profiles)).toEqual(['luca@abovomaxlead.nl']);
  });

  it('leaves out a delegated mailbox, which has no link of its own', () => {
    const profiles = [
      authuser('luca@abovomaxlead.nl'),
      { kind: 'delegated' as const, email: 'info@abovomaxlead.nl' },
    ];
    expect(linkableOwnEmails(profiles)).toEqual(['luca@abovomaxlead.nl']);
  });
});

// Which mailboxes the copy window may offer. An account left out here is not shown as a
// column at all, rather than shown with an error under its name for a link it can never
// have.
describe('copyTargetEmails', () => {
  const authuser = (email: string) => ({ kind: 'authuser' as const, email });
  const delegated = (email: string) => ({ kind: 'delegated' as const, email });

  it('keeps own and delegated work mailboxes in the order given', () => {
    const profiles = [authuser('luca@abovomaxlead.nl'), delegated('support@abovomaxlead.nl')];
    expect(copyTargetEmails(profiles, '')).toEqual([
      'luca@abovomaxlead.nl',
      'support@abovomaxlead.nl',
    ]);
  });

  it('leaves out an own account outside the work domain', () => {
    const profiles = [authuser('luca@abovomaxlead.nl'), authuser('luca@gmail.com')];
    expect(copyTargetEmails(profiles, '')).toEqual(['luca@abovomaxlead.nl']);
  });

  it('leaves out a delegated mailbox outside the work domain', () => {
    const profiles = [authuser('luca@abovomaxlead.nl'), delegated('shared@elsewhere.nl')];
    expect(copyTargetEmails(profiles, '')).toEqual(['luca@abovomaxlead.nl']);
  });

  it('leaves out the mailbox the drag came from', () => {
    const profiles = [authuser('luca@abovomaxlead.nl'), delegated('support@abovomaxlead.nl')];
    expect(copyTargetEmails(profiles, 'luca@abovomaxlead.nl')).toEqual([
      'support@abovomaxlead.nl',
    ]);
  });

  it('offers everything when the source is not known', () => {
    const profiles = [authuser('a@abovomaxlead.nl'), authuser('b@abovomaxlead.nl')];
    expect(copyTargetEmails(profiles, '')).toEqual(['a@abovomaxlead.nl', 'b@abovomaxlead.nl']);
  });
});

describe('dropDisallowedTokens', () => {
  it('throws away the tokens of accounts that may no longer be linked', () => {
    const { store, map } = fakeStore(['luca@abovomaxlead.nl', 'luca@gmail.com']);
    expect(dropDisallowedTokens(store)).toEqual(['luca@gmail.com']);
    expect([...map.keys()]).toEqual(['luca@abovomaxlead.nl']);
  });

  it('leaves a store of work accounts alone', () => {
    const { store, map } = fakeStore(['a@abovomaxlead.nl', 'b@abovomaxlead.nl']);
    expect(dropDisallowedTokens(store)).toEqual([]);
    expect(map.size).toBe(2);
  });
});
