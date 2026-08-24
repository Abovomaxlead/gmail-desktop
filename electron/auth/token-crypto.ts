// Wraps Electron's safeStorage keystore and owns the on-disk envelope format for
// google-tokens.json, so the refresh tokens are not sitting there as plain text.
//
// safeStorage is DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux, and it is
// tied to the machine and the OS user account: a copy of the file taken off the box decrypts
// nowhere else. Losing that binding is not a bug to paper over -- open() reports it as
// `unreadable`, kept apart from `empty`, because a caller that reads "cannot decrypt" as
// "no tokens" will save that emptiness back over tokens it merely could not open.


//===========================
// Types
//===========================

/** The platform keystore, injected so tests never touch Electron. */
export interface SecretCrypto {
  available(): boolean;
  encrypt(plain: string): string; // base64
  decrypt(payload: string): string; // base64 in, plaintext out; throws when it cannot
}

/** What google-tokens.json holds once it is encrypted. */
export interface SealedEnvelope {
  v: 1;
  enc: 'safeStorage';
  data: string; // base64 ciphertext of the token map's JSON text
}

export type OpenResult =
  | { kind: 'plain'; text: string } // a pre-encryption file, caller should migrate it
  | { kind: 'ok'; text: string } // decrypted
  | { kind: 'empty' } // nothing stored yet
  | { kind: 'unreadable'; reason: string }; // sealed, but this machine/user cannot open it


//===========================
// Exported functions
//===========================

/**
 * Tells whether a parsed JSON value is a sealed envelope
 *
 * @param raw the file's parsed contents
 * @returns true for `{ v: 1, enc: 'safeStorage', data: string }` exactly
 */
export function isSealedEnvelope(raw: unknown): raw is SealedEnvelope {
  if (!isPlainObject(raw)) return false;
  return raw.v === 1 && raw.enc === 'safeStorage' && typeof raw.data === 'string';
}

/**
 * Wraps token JSON for disk
 *
 * @param text the token map's JSON text
 * @param crypto
 * @returns the envelope to write, or null when the keystore is unavailable
 */
export function seal(text: string, crypto: SecretCrypto): SealedEnvelope | null {
  if (!crypto.available()) return null;
  return { v: 1, enc: 'safeStorage', data: crypto.encrypt(text) };
}

/**
 * Reads whatever the file held back into token JSON
 *
 * @param raw the file's parsed contents
 * @param crypto
 * @returns the outcome; never throws even when `crypto.decrypt` does
 */
export function open(raw: unknown, crypto: SecretCrypto): OpenResult {
  if (isSealedEnvelope(raw)) {
    try {
      return { kind: 'ok', text: crypto.decrypt(raw.data) };
    } catch (e) {
      return { kind: 'unreadable', reason: (e as Error).message };
    }
  }
  if (isPlainObject(raw)) return { kind: 'plain', text: JSON.stringify(raw) };
  return { kind: 'empty' };
}

/**
 * The real keystore, backed by Electron's safeStorage
 *
 * `electron` is required lazily inside this body, not at module scope, so the module stays
 * importable under Vitest where no Electron process exists. Only call after app 'ready'.
 *
 * @returns a SecretCrypto over the platform keystore
 */
export function electronSecretCrypto(): SecretCrypto {
  const { safeStorage } = require('electron') as typeof import('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  };
}


//===========================
// Helper functions
//===========================

/**
 * Tells whether a parsed JSON value is an object rather than null, an array, or a primitive
 *
 * @param raw
 * @returns true for anything `JSON.parse` would hand back as `{...}`
 * @private
 */
function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}
