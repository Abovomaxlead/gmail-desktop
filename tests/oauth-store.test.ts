// The OAuth token store on disk, sealed with an injected SecretCrypto so no test touches
// the real platform keystore.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { OAuthStore } from '../electron/auth/oauth-store';
import { seal, type SecretCrypto } from '../electron/auth/token-crypto';
import { writeJsonFile } from '../electron/core/json-store';
import type { StoredToken } from '../electron/auth/google-oauth';

const newPath = () => join(mkdtempSync(join(tmpdir(), 'oauth-')), 'google-tokens.json');

const token = (over: Partial<StoredToken> = {}): StoredToken => ({
  accessToken: 'AT',
  refreshToken: 'RT',
  expiresAt: 1_800_000_000_000,
  scopes: ['a', 'b'],
  ...over,
});

/**
 * A fake keystore tagged to one device, so decrypting a payload sealed by a different tag
 * fails the way a real machine/user mismatch does -- a plain base64 round trip never fails,
 * which is why a plain round-trip fake cannot stand in for the `unreadable` cases below.
 *
 * @param tag identifies which "device" sealed a payload
 * @param available defaults to true
 * @returns a SecretCrypto that only opens its own tag's payloads
 */
function taggedCrypto(tag: string, available = true): SecretCrypto {
  const prefix = `${tag}:`;
  return {
    available: () => available,
    encrypt: (plain) => Buffer.from(prefix + plain, 'utf8').toString('base64'),
    decrypt: (payload) => {
      const text = Buffer.from(payload, 'base64').toString('utf8');
      if (!text.startsWith(prefix)) throw new Error(`cannot open a payload sealed by another device`);
      return text.slice(prefix.length);
    },
  };
}

const crypto = taggedCrypto('this-device');
const otherDeviceCrypto = taggedCrypto('other-device');

describe('OAuthStore', () => {
  it('returns undefined for an account that was never connected', () => {
    expect(new OAuthStore(newPath(), crypto).get('a@b.c')).toBeUndefined();
  });

  it('persists a token across instances', () => {
    const path = newPath();
    new OAuthStore(path, crypto).set('a@b.c', token());
    expect(new OAuthStore(path, crypto).get('a@b.c')?.accessToken).toBe('AT');
  });

  it('treats the address case-insensitively', () => {
    const store = new OAuthStore(newPath(), crypto);
    store.set('Luca@Example.COM', token());
    expect(store.get('luca@example.com')?.refreshToken).toBe('RT');
  });

  it('keeps accounts apart and lists them', () => {
    const store = new OAuthStore(newPath(), crypto);
    store.set('a@b.c', token({ accessToken: 'EEN' }));
    store.set('d@e.f', token({ accessToken: 'TWEE' }));
    expect(store.get('a@b.c')?.accessToken).toBe('EEN');
    expect(store.connected().sort()).toEqual(['a@b.c', 'd@e.f']);
  });

  it('removes one account without touching the others', () => {
    const store = new OAuthStore(newPath(), crypto);
    store.set('a@b.c', token());
    store.set('d@e.f', token());
    store.remove('a@b.c');
    expect(store.get('a@b.c')).toBeUndefined();
    expect(store.get('d@e.f')).toBeDefined();
    expect(store.connected()).toEqual(['d@e.f']);
  });

  it('writes no file when removing an account that was never there', () => {
    const path = newPath();
    new OAuthStore(path, crypto).remove('a@b.c');
    expect(existsSync(path)).toBe(false);
  });

  it('tolerates a corrupt file and can still write afterwards', () => {
    const path = newPath();
    writeFileSync(path, 'geen json', 'utf8');
    const store = new OAuthStore(path, crypto);
    expect(store.get('a@b.c')).toBeUndefined();
    store.set('a@b.c', token());
    expect(new OAuthStore(path, crypto).get('a@b.c')?.accessToken).toBe('AT');
  });

  it('rejects an entry that is missing its tokens', () => {
    const path = newPath();
    writeFileSync(path, JSON.stringify({ 'a@b.c': { expiresAt: 1 } }), 'utf8');
    expect(new OAuthStore(path, crypto).get('a@b.c')).toBeUndefined();
  });

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
    const store = new OAuthStore(path, crypto);
    for (const email of ['geen@x.nl', 'null@x.nl', 'tekst@x.nl', 'rommel@x.nl']) {
      const t = store.get(email);
      expect(t).toBeDefined();
      expect(Array.isArray(t!.scopes)).toBe(true);
      expect(t!.scopes.every((s) => typeof s === 'string')).toBe(true);
    }
    expect(store.get('rommel@x.nl')!.scopes).toEqual(['a']);
    expect(() => store.get('geen@x.nl')!.scopes.includes('x')).not.toThrow();
  });

  it('leaves a healthy scopes list alone', () => {
    const path = newPath();
    new OAuthStore(path, crypto).set('a@b.c', token({ scopes: ['x', 'y'] }));
    expect(new OAuthStore(path, crypto).get('a@b.c')?.scopes).toEqual(['x', 'y']);
  });

  // The assertion that actually matters: whatever the store writes, the refresh token
  // itself must not be recoverable by reading the file, only by going through the crypto.
  it('leaves no plaintext refresh token anywhere in the file bytes', () => {
    const path = newPath();
    const secret = 'super-secret-refresh-value-9f3a1c';
    new OAuthStore(path, crypto).set('a@b.c', token({ refreshToken: secret }));
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain(secret);
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject({ v: 1, enc: 'safeStorage' });
    expect(typeof parsed.data).toBe('string');
  });

  it('leaves the file as plain text when the keystore is unavailable', () => {
    const path = newPath();
    const offCrypto = taggedCrypto('this-device', false);
    new OAuthStore(path, offCrypto).set('a@b.c', token());
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'a@b.c': token() });
    expect(new OAuthStore(path, offCrypto).get('a@b.c')?.accessToken).toBe('AT');
  });

  describe('protect', () => {
    it('reports nothing-stored when there is no file', () => {
      expect(new OAuthStore(newPath(), crypto).protect()).toBe('nothing-stored');
    });

    it('seals a pre-encryption plain file and leaves the tokens readable', () => {
      const path = newPath();
      writeFileSync(path, JSON.stringify({ 'a@b.c': token() }), 'utf8');
      const store = new OAuthStore(path, crypto);
      expect(store.protect()).toBe('sealed');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ v: 1, enc: 'safeStorage' });
      expect(store.get('a@b.c')?.accessToken).toBe('AT');
    });

    it('reports already-sealed once the file is encrypted', () => {
      const path = newPath();
      const store = new OAuthStore(path, crypto);
      store.set('a@b.c', token());
      expect(store.protect()).toBe('already-sealed');
    });

    it('reports unreadable for an envelope this crypto cannot open', () => {
      const path = newPath();
      writeJsonFile(path, seal(JSON.stringify({ 'a@b.c': token() }), otherDeviceCrypto)!);
      expect(new OAuthStore(path, crypto).protect()).toBe('unreadable');
    });

    it('reports unavailable and leaves the file plain when the keystore is off', () => {
      const path = newPath();
      const map = { 'a@b.c': token() };
      writeFileSync(path, JSON.stringify(map), 'utf8');
      expect(new OAuthStore(path, taggedCrypto('this-device', false)).protect()).toBe('unavailable');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(map);
    });
  });

  it('moves an unopenable file aside on the next write, keeping the new token readable', () => {
    const path = newPath();
    const strandedText = JSON.stringify({ 'old@x.co': token({ accessToken: 'OLD' }) });
    writeJsonFile(path, seal(strandedText, otherDeviceCrypto)!);

    const store = new OAuthStore(path, crypto);
    expect(store.get('old@x.co')).toBeUndefined();

    store.set('new@x.co', token({ accessToken: 'NEW' }));

    const dir = dirname(path);
    const setAside = readdirSync(dir).find((f) => f.startsWith(`${basename(path)}.unopenable-`));
    expect(setAside).toBeDefined();
    const strandedEnvelope = JSON.parse(readFileSync(join(dir, setAside!), 'utf8'));
    expect(otherDeviceCrypto.decrypt(strandedEnvelope.data)).toBe(strandedText);

    const fresh = new OAuthStore(path, crypto);
    expect(fresh.get('new@x.co')?.accessToken).toBe('NEW');
    expect(fresh.get('old@x.co')).toBeUndefined();
  });
});
