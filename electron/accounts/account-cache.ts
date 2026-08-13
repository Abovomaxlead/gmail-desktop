// The last known own accounts (accounts.json), so the tab bar is not empty at
// startup — own accounts are stored nowhere else, as prefs.json holds only
// per-address preferences and colors.json only colours.
//
// Deliberately stores no session index (the digit in /mail/u/2/): that index belongs
// to Google's browser session, not to the account, so a stored one would be a URL
// you could wrongly build. Everything here is drawing material only; no URL, counter
// or notification ever comes out of it. A broken file yields an empty tab bar rather
// than a failed start, and an empty list is never written.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';


//===========================
// Types
//===========================

export interface CachedAccount {
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
}


//===========================
// Exported functions
//===========================

/**
 * Reads whatever accounts.json held into drawable accounts
 *
 * @param raw the parsed file contents, of no guaranteed shape
 * @returns the entries carrying an email, addresses lowercased
 */
export function parseCachedAccounts(raw: unknown): CachedAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: CachedAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
    if (!email) continue;
    out.push({
      email,
      name: typeof r.name === 'string' ? r.name : '',
      avatarUrl: typeof r.avatarUrl === 'string' ? r.avatarUrl : '',
      color: typeof r.color === 'string' ? r.color : '',
    });
  }
  return out;
}

/**
 * Picks the cached accounts worth drawing before detection has run
 *
 * @param cached
 * @param opts confirmed are already live, removed the user threw away
 * @returns the remainder, deduplicated, in cache order
 */
export function seedable(
  cached: CachedAccount[],
  opts: { confirmed: string[]; removed: string[] },
): CachedAccount[] {
  const skip = new Set([...opts.confirmed, ...opts.removed].map((e) => e.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: CachedAccount[] = [];
  for (const c of cached) {
    const key = c.email.trim().toLowerCase();
    if (!key || skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Maps each cached address to the position it last held
 *
 * @param cached
 * @returns lookup from lowercased email to index
 */
export function rememberedOrder(cached: CachedAccount[]): Map<string, number> {
  return new Map(cached.map((c, i) => [c.email.trim().toLowerCase(), i]));
}


//===========================
// Store
//===========================

export class AccountCacheStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the cache, treating an unreadable file as an empty one
   *
   * @returns the cached accounts
   */
  list(): CachedAccount[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseCachedAccounts(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return [];
    }
  }

  /**
   * Writes the cache, normalising the entries on the way out
   *
   * @param items
   */
  save(items: CachedAccount[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(parseCachedAccounts(items), null, 2), 'utf8');
  }

  /**
   * Drops one address from the cache
   *
   * @param email
   */
  remove(email: string): void {
    if (!existsSync(this.filePath)) return;
    const e = email.trim().toLowerCase();
    this.save(this.list().filter((c) => c.email !== e));
  }
}
