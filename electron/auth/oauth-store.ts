// Access and refresh tokens per account, in userData and deliberately in a separate
// file from prefs.json: these are secrets, not settings, and can be thrown away on
// their own. The file is hand-editable, so a scopes field that is not a list of
// strings becomes an empty list rather than throwing — hasScopes runs synchronously
// while accounts are registered, and push asks for re-consent instead of crashing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredToken } from './google-oauth';

export class OAuthStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the token file, treating anything unusable as no tokens
   *
   * @returns token per lowercased email
   * @private
   */
  private all(): Record<string, StoredToken> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw as Record<string, StoredToken>;
    } catch {
      return {};
    }
  }

  /**
   * Writes the whole token file
   *
   * @param map
   * @private
   */
  private write(map: Record<string, StoredToken>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), 'utf8');
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

  /**
   * Stores the token for an account
   *
   * @param email
   * @param token
   */
  set(email: string, token: StoredToken): void {
    const map = this.all();
    map[email.toLowerCase()] = token;
    this.write(map);
  }

  /**
   * Throws away an account's token, unlinking it from the API
   *
   * @param email
   */
  remove(email: string): void {
    const map = this.all();
    delete map[email.toLowerCase()];
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
