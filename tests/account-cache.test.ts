// The remembered account bar (accounts.json): parsing, seeding and ordering.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AccountCacheStore,
  parseCachedAccounts,
  seedable,
  rememberedOrder,
  type CachedAccount,
} from '../electron/accounts/account-cache';

const a = (email: string, extra: Partial<CachedAccount> = {}): CachedAccount => ({
  email,
  name: `Naam ${email}`,
  avatarUrl: `https://avatar/${email}`,
  color: '#112233',
  ...extra,
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gmd-accounts-'));
  file = join(dir, 'nested', 'accounts.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseCachedAccounts', () => {
  it('keeps the stored order, which is the order the tabs were in', () => {
    const parsed = parseCachedAccounts([a('c@x.nl'), a('a@x.nl'), a('b@x.nl')]);
    expect(parsed.map((c) => c.email)).toEqual(['c@x.nl', 'a@x.nl', 'b@x.nl']);
  });

  it('treats anything that is not a list as nothing stored', () => {
    expect(parseCachedAccounts(null)).toEqual([]);
    expect(parseCachedAccounts({ a: 1 })).toEqual([]);
    expect(parseCachedAccounts('nope')).toEqual([]);
  });

  it('skips an entry without an address: the address is the identity', () => {
    const parsed = parseCachedAccounts([{ name: 'X' }, a('a@x.nl'), { email: '   ' }]);
    expect(parsed.map((c) => c.email)).toEqual(['a@x.nl']);
  });

  it('normalises the address so it matches a detected identity', () => {
    expect(parseCachedAccounts([{ email: '  A@X.NL  ' }])[0].email).toBe('a@x.nl');
  });

  it('falls back to empty strings for the fields a tab draws', () => {
    expect(parseCachedAccounts([{ email: 'a@x.nl' }])[0]).toEqual({
      email: 'a@x.nl',
      name: '',
      avatarUrl: '',
      color: '',
    });
  });

  it('drops any field beyond what a tab draws, an index included', () => {
    const parsed = parseCachedAccounts([{ ...a('a@x.nl'), index: 2, unread: 7, mailUrl: 'https://m/' }]);
    expect(Object.keys(parsed[0]).sort()).toEqual(['avatarUrl', 'color', 'email', 'name']);
  });
});

describe('seedable', () => {
  const cached = [a('a@x.nl'), a('b@x.nl'), a('c@x.nl')];

  it('offers every stored account when detection has confirmed nothing yet', () => {
    expect(seedable(cached, { confirmed: [] }).map((c) => c.email)).toEqual([
      'a@x.nl',
      'b@x.nl',
      'c@x.nl',
    ]);
  });

  it('drops a confirmed account, so the real tab replaces the provisional one', () => {
    const out = seedable(cached, { confirmed: ['B@X.nl'] });
    expect(out.map((c) => c.email)).toEqual(['a@x.nl', 'c@x.nl']);
  });

  it('keeps the first of a duplicated address', () => {
    const out = seedable([a('a@x.nl'), a('A@X.nl', { name: 'tweede' })], { confirmed: [] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Naam a@x.nl');
  });

  it('preserves the stored order, so the tabs do not jump as detection lands', () => {
    const out = seedable([a('c@x.nl'), a('a@x.nl'), a('b@x.nl')], { confirmed: ['a@x.nl'] });
    expect(out.map((c) => c.email)).toEqual(['c@x.nl', 'b@x.nl']);
  });
});

describe('rememberedOrder', () => {
  it('numbers the addresses by their place in the stored bar', () => {
    const map = rememberedOrder([a('c@x.nl'), a('a@x.nl'), a('b@x.nl')]);
    expect([...map.entries()]).toEqual([
      ['c@x.nl', 0],
      ['a@x.nl', 1],
      ['b@x.nl', 2],
    ]);
  });

  it('matches an address whatever its casing', () => {
    expect(rememberedOrder([a('A@X.nl')]).get('a@x.nl')).toBe(0);
  });

  it('knows nothing about an address that was not in the bar', () => {
    expect(rememberedOrder([a('a@x.nl')]).get('nieuw@x.nl')).toBeUndefined();
  });

  it('has nothing to say when nothing was stored', () => {
    expect(rememberedOrder([]).size).toBe(0);
  });
});

describe('AccountCacheStore', () => {
  it('remembers the accounts, in order, across instances', () => {
    new AccountCacheStore(file).save([a('b@x.nl'), a('a@x.nl')]);
    expect(new AccountCacheStore(file).list().map((c) => c.email)).toEqual(['b@x.nl', 'a@x.nl']);
  });

  it('creates the folder it needs', () => {
    new AccountCacheStore(file).save([a('a@x.nl')]);
    expect(existsSync(file)).toBe(true);
  });

  it('reports nothing when no file was ever written', () => {
    expect(new AccountCacheStore(join(dir, 'afwezig.json')).list()).toEqual([]);
  });

  it('treats an unreadable file as nothing stored', () => {
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '[{ this is not json', 'utf8');
    expect(new AccountCacheStore(broken).list()).toEqual([]);
  });

  it('overwrites rather than appending: this is a snapshot of the bar', () => {
    const store = new AccountCacheStore(file);
    store.save([a('a@x.nl'), a('b@x.nl')]);
    store.save([a('b@x.nl')]);
    expect(store.list().map((c) => c.email)).toEqual(['b@x.nl']);
  });

  it('never writes a session index, even if handed one', () => {
    const store = new AccountCacheStore(file);
    store.save([{ ...a('a@x.nl'), index: 2 } as unknown as CachedAccount]);
    expect(readFileSync(file, 'utf8')).not.toContain('index');
  });

  it('removes one account case-insensitively and leaves the rest', () => {
    const store = new AccountCacheStore(file);
    store.save([a('a@x.nl'), a('b@x.nl')]);
    store.remove('A@X.NL');
    expect(store.list().map((c) => c.email)).toEqual(['b@x.nl']);
  });

  it('does not create a file just to remove from nothing', () => {
    new AccountCacheStore(file).remove('a@x.nl');
    expect(existsSync(file)).toBe(false);
  });
});
