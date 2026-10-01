// Access and refresh tokens per account, kept apart from prefs.json because these are
// secrets rather than settings and can be thrown away on their own. The file is
// hand-editable, so an unusable scopes field degrades to an empty list rather than throwing.
//
// A refresh token never expires and grants read, insert and modify on a work mailbox, so the
// file is sealed with the platform keystore rather than left as plain text -- see
// token-crypto.ts. Every read goes through open(), which tells three cases apart that this
// class must not confuse:
//
//   ok         the tokens, decrypted
//   plain      a file from before the sealing, migrated by protect()
//   unreadable sealed by another machine or user, or a keystore that will not open
//
// `unreadable` is the one with teeth. It must never be written over as if it were empty:
// that would turn "this box cannot open the file" into "there were no tokens", permanently.
// So the store locks, reports no tokens, and a later write moves the unopenable file aside
// under its own name instead of overwriting it.

import { readJsonFile, writeJsonFile } from '../core/json-store';
import { electronSecretCrypto, open, seal, type SecretCrypto } from './token-crypto';
import type { StoredToken } from './google-oauth';
import { renameSync } from 'node:fs';


//===========================
// Types
//===========================

/** What protect() found on disk and what it did about it. */
export type ProtectResult =
  | 'sealed' // a plain file was found and is now encrypted
  | 'already-sealed'
  | 'nothing-stored'
  | 'unreadable' // sealed, and this machine cannot open it
  | 'unavailable'; // no keystore on this platform, so the file stays plain


//===========================
// Store
//===========================

export class OAuthStore {
  private locked = false;
  private warnedUnavailable = false;

  constructor(
    private readonly filePath: string,
    private readonly crypto: SecretCrypto = electronSecretCrypto(),
  ) {}

  /**
   * Seals a token file written before the sealing existed
   *
   * Called once at startup so the plain text does not sit there until something happens to
   * save a token. Safe to call again; it only writes when there is plain text to replace.
   *
   * @returns what was found on disk and what became of it
   */
  protect(): ProtectResult {
    const result = open(readJsonFile(this.filePath), this.crypto);
    if (result.kind === 'empty') return 'nothing-stored';
    if (result.kind === 'unreadable') {
      this.locked = true;
      return 'unreadable';
    }
    if (result.kind === 'ok') return 'already-sealed';
    if (!this.crypto.available()) return 'unavailable';
    this.write(parseMap(result.text));
    return 'sealed';
  }

  /**
   * Reads the token file, treating anything unusable as no tokens
   *
   * @returns token per lowercased email
   * @private
   */
  private all(): Record<string, StoredToken> {
    const result = open(readJsonFile(this.filePath), this.crypto);
    if (result.kind === 'unreadable') {
      this.locked = true;
      return {};
    }
    this.locked = false;
    if (result.kind === 'empty') return {};
    return parseMap(result.text);
  }

  /**
   * Writes the token file, sealed when the platform can seal it
   *
   * @param map
   * @private
   */
  private write(map: Record<string, StoredToken>): void {
    if (this.locked) this.setAsideUnopenable();
    const sealed = seal(JSON.stringify(map), this.crypto);
    if (sealed === null) {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        console.warn(
          `[oauth] no keystore on this platform, so ${this.filePath} stays plain text`,
        );
      }
      writeJsonFile(this.filePath, map);
      return;
    }
    writeJsonFile(this.filePath, sealed);
  }

  /**
   * Moves a file this machine cannot open out of the way of a fresh one
   *
   * Renaming rather than overwriting, because a keystore can be unavailable for a while --
   * a locked keyring on Linux -- and the tokens inside are unrecoverable once gone.
   *
   * @private
   */
  private setAsideUnopenable(): void {
    this.locked = false;
    const kept = `${this.filePath}.unopenable-${Date.now()}`;
    try {
      renameSync(this.filePath, kept);
      console.warn(`[oauth] could not open the token file; kept it as ${kept}`);
    } catch {
      // Nothing to move, or the move is refused; either way the write below is what matters
    }
  }

  /**
   * Returns the stored token for an account
   *
   * @param email
   * @returns the token with a usable scopes list, or undefined when incomplete
   */
  get(email: string): StoredToken | undefined {
    const t = this.all()[email.toLowerCase()];
    if (!t || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string') return undefined;
    const scopes = Array.isArray(t.scopes) ? t.scopes.filter((s) => typeof s === 'string') : [];
    return { ...t, scopes };
  }

  set(email: string, token: StoredToken): void {
    const map = this.all();
    map[email.toLowerCase()] = token;
    this.write(map);
  }

  /**
   * Throws away an account's token, unlinking it from the API
   *
   * Revoking the grant at Google is the caller's job: this class owns a file and does no
   * network work. removeAccount is where that happens.
   *
   * @param email
   */
  remove(email: string): void {
    const map = this.all();
    const key = email.toLowerCase();
    if (!(key in map)) return;
    delete map[key];
    this.write(map);
  }

  /**
   * Returns every account that has a token on file
   *
   * @returns lowercased emails
   */
  connected(): string[] {
    return Object.keys(this.all());
  }
}


//===========================
// Helper functions
//===========================

/**
 * Reads a token map out of the JSON text a file held
 *
 * @param text
 * @returns the map, or an empty one when the text is not an object
 * @private
 */
function parseMap(text: string): Record<string, StoredToken> {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, StoredToken>;
  } catch {
    return {};
  }
}
