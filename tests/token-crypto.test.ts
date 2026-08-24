// The envelope format google-tokens.json is stored in, and the fallbacks a caller needs
// when this machine cannot open what is on disk.

import { describe, it, expect } from 'vitest';
import {
  electronSecretCrypto,
  isSealedEnvelope,
  open,
  seal,
  type SecretCrypto,
} from '../electron/auth/token-crypto';

function base64Crypto(): SecretCrypto {
  return {
    available: () => true,
    encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
    decrypt: (payload) => Buffer.from(payload, 'base64').toString('utf8'),
  };
}

function throwingCrypto(message: string): SecretCrypto {
  return {
    available: () => true,
    encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
    decrypt: () => {
      throw new Error(message);
    },
  };
}

function unavailableCrypto(): SecretCrypto {
  return {
    available: () => false,
    encrypt: () => {
      throw new Error('should not be called');
    },
    decrypt: () => {
      throw new Error('should not be called');
    },
  };
}

describe('seal', () => {
  it('wraps the ciphertext in a v1 safeStorage envelope', () => {
    const c = base64Crypto();
    expect(seal('{"a@x.com":{}}', c)).toEqual({
      v: 1,
      enc: 'safeStorage',
      data: c.encrypt('{"a@x.com":{}}'),
    });
  });

  it('returns null rather than a fake envelope when the keystore is unavailable', () => {
    expect(seal('{}', unavailableCrypto())).toBeNull();
  });
});

describe('isSealedEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(isSealedEnvelope({ v: 1, enc: 'safeStorage', data: 'abc' })).toBe(true);
  });

  it('rejects the wrong version', () => {
    expect(isSealedEnvelope({ v: 2, enc: 'safeStorage', data: 'abc' })).toBe(false);
  });

  it('rejects the wrong enc tag', () => {
    expect(isSealedEnvelope({ v: 1, enc: 'other', data: 'abc' })).toBe(false);
  });

  it('rejects a plain token map', () => {
    expect(isSealedEnvelope({ 'a@x.com': { accessToken: 'x' } })).toBe(false);
  });

  it('rejects null and arrays', () => {
    expect(isSealedEnvelope(null)).toBe(false);
    expect(isSealedEnvelope([])).toBe(false);
  });
});

describe('open', () => {
  it('round-trips exactly through seal and open', () => {
    const c = base64Crypto();
    const text = JSON.stringify({ 'a@x.com': { accessToken: 'x', refreshToken: 'y' } });
    expect(open(seal(text, c), c)).toEqual({ kind: 'ok', text });
  });

  it('reports unreadable when decrypt throws, carrying the error text', () => {
    const envelope = seal('{}', base64Crypto());
    expect(open(envelope, throwingCrypto('DPAPI: access denied'))).toEqual({
      kind: 'unreadable',
      reason: 'DPAPI: access denied',
    });
  });

  it('never confuses unreadable with empty', () => {
    const envelope = seal('{"a@x.com":{}}', base64Crypto());
    const result = open(envelope, throwingCrypto('boom'));
    expect(result.kind).not.toBe('empty');
    expect(result.kind).toBe('unreadable');
  });

  it('reads a pre-encryption token map as plain, with the JSON recoverable', () => {
    const map = { 'a@x.com': { accessToken: 'x', refreshToken: 'y' } };
    const result = open(map, base64Crypto());
    expect(result.kind).toBe('plain');
    expect(JSON.parse((result as { kind: 'plain'; text: string }).text)).toEqual(map);
  });

  it('reads an empty object as plain, not empty', () => {
    expect(open({}, base64Crypto())).toEqual({ kind: 'plain', text: '{}' });
  });

  it('reads null as empty', () => {
    expect(open(null, base64Crypto())).toEqual({ kind: 'empty' });
  });

  it('reads an array as empty', () => {
    expect(open([], base64Crypto())).toEqual({ kind: 'empty' });
  });

  it('reads a bare number as empty', () => {
    expect(open(42, base64Crypto())).toEqual({ kind: 'empty' });
  });

  it('never throws, even when the payload cannot possibly decrypt', () => {
    const envelope = { v: 1, enc: 'safeStorage', data: 'not base64 at all!!' };
    expect(() => open(envelope, throwingCrypto('bad payload'))).not.toThrow();
  });
});

describe('electronSecretCrypto', () => {
  it('is importable and constructible with no Electron process present', () => {
    expect(typeof electronSecretCrypto).toBe('function');
    expect(() => electronSecretCrypto()).not.toThrow();
  });
});
