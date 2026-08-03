import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthStore } from '../electron/oauth-store';
import type { StoredToken } from '../electron/google-oauth';

const newPath = () => join(mkdtempSync(join(tmpdir(), 'oauth-')), 'google-tokens.json');

const token = (over: Partial<StoredToken> = {}): StoredToken => ({
  accessToken: 'AT',
  refreshToken: 'RT',
  expiresAt: 1_800_000_000_000,
  scopes: ['a', 'b'],
  ...over,
});

describe('OAuthStore', () => {
  it('returns undefined for an account that was never connected', () => {
    expect(new OAuthStore(newPath()).get('a@b.c')).toBeUndefined();
  });

  it('persists a token across instances', () => {
    const path = newPath();
    new OAuthStore(path).set('a@b.c', token());
    expect(new OAuthStore(path).get('a@b.c')?.accessToken).toBe('AT');
  });

  it('treats the address case-insensitively', () => {
    const store = new OAuthStore(newPath());
    store.set('Luca@Example.COM', token());
    expect(store.get('luca@example.com')?.refreshToken).toBe('RT');
  });

  it('keeps accounts apart and lists them', () => {
    const store = new OAuthStore(newPath());
    store.set('a@b.c', token({ accessToken: 'EEN' }));
    store.set('d@e.f', token({ accessToken: 'TWEE' }));
    expect(store.get('a@b.c')?.accessToken).toBe('EEN');
    expect(store.connected().sort()).toEqual(['a@b.c', 'd@e.f']);
  });

  it('removes one account without touching the others', () => {
    const store = new OAuthStore(newPath());
    store.set('a@b.c', token());
    store.set('d@e.f', token());
    store.remove('a@b.c');
    expect(store.get('a@b.c')).toBeUndefined();
    expect(store.get('d@e.f')).toBeDefined();
    expect(store.connected()).toEqual(['d@e.f']);
  });

  it('tolerates a corrupt file and can still write afterwards', () => {
    const path = newPath();
    writeFileSync(path, 'geen json', 'utf8');
    const store = new OAuthStore(path);
    expect(store.get('a@b.c')).toBeUndefined();
    store.set('a@b.c', token());
    expect(new OAuthStore(path).get('a@b.c')?.accessToken).toBe('AT');
  });

  it('rejects an entry that is missing its tokens', () => {
    const path = newPath();
    writeFileSync(path, JSON.stringify({ 'a@b.c': { expiresAt: 1 } }), 'utf8');
    expect(new OAuthStore(path).get('a@b.c')).toBeUndefined();
  });

  // hasScopes() doet meteen `.includes()` op dit veld, en dat gebeurt synchroon
  // tijdens het registreren van accounts (pushableEmails). Een met de hand
  // bewerkt tokenbestand zonder scopes zou de app dus bij het opstarten laten
  // omvallen. Geen lijst betekent hier "we weten van geen enkele scope": het
  // account blijft werken en push vraagt netjes om hertoestemming.
  it('never hands out a scopes field that is not a list of strings', () => {
    const path = newPath();
    writeFileSync(
      path,
      JSON.stringify({
        'geen@x.nl': { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 },
        'null@x.nl': { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1, scopes: null },
        'tekst@x.nl': { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1, scopes: 'a b' },
        'rommel@x.nl': { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1, scopes: ['a', 7, null] },
      }),
      'utf8',
    );
    const store = new OAuthStore(path);
    for (const email of ['geen@x.nl', 'null@x.nl', 'tekst@x.nl', 'rommel@x.nl']) {
      const t = store.get(email);
      expect(t).toBeDefined();
      expect(Array.isArray(t!.scopes)).toBe(true);
      expect(t!.scopes.every((s) => typeof s === 'string')).toBe(true);
    }
    expect(store.get('rommel@x.nl')!.scopes).toEqual(['a']);
    // En het gaat echt om wat hasScopes doet: die aanroep mag niet omvallen.
    expect(() => store.get('geen@x.nl')!.scopes.includes('x')).not.toThrow();
  });

  it('leaves a healthy scopes list alone', () => {
    const path = newPath();
    new OAuthStore(path).set('a@b.c', token({ scopes: ['x', 'y'] }));
    expect(new OAuthStore(path).get('a@b.c')?.scopes).toEqual(['x', 'y']);
  });
});
