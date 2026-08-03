import { describe, it, expect } from 'vitest';
import { accountsNeedingReconnect, bannerBounds } from '../electron/oauth-health';

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

  // Zonder dit werkt push na de scope-uitbreiding bij niemand: de relay sluit
  // elke verbinding met 4401 en er is niets dat het vertelt.
  it('asks to reconnect an account whose token predates a new scope', () => {
    expect(accountsNeedingReconnect({ ...base, missingScopes: () => true })).toEqual([
      push('a@x.nl'),
    ]);
  });

  // De kern van Important 3: op een machine zonder relayUrl/pushTopic is een
  // ontbrekende push-scope geen probleem — er is geen push. Zonder deze grens
  // kreeg élke bestaande installatie na de update een blijvende, niet weg te
  // klikken melding over iets dat daar niet bestaat en ook niet stuk is.
  it('says nothing about a missing scope when push is not configured at all', () => {
    expect(
      accountsNeedingReconnect({ ...base, pushConfigured: false, missingScopes: () => true }),
    ).toEqual([]);
  });

  // Idem voor een weigering van de relay: zonder push is er geen relay.
  it('says nothing about a refused token when push is not configured', () => {
    expect(
      accountsNeedingReconnect({ ...base, pushConfigured: false, pushRefused: () => true }),
    ).toEqual([]);
  });

  // Important 2: een 4401 die ook na een verse verversing blijft, is de enige
  // manier waarop de gebruiker hoort dat push stilstaat — het token bestaat, het
  // ververst prima en de scopes zitten erin, dus de rest van de controle ziet er
  // niets aan.
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
