// The mailboxes the user waved away (hidden.json), so a removal outlives an update.
//
// Neither discovery path can be told to stop finding something. Own accounts are probed at
// /mail/u/0, /u/1, ... every launch because no API lists them, and delegated mailboxes come
// from Google's delegation administration through the relay -- and removing a mailbox here
// does not sign anyone out or hand a delegation back. So without this list every removal
// lasted until the next start, which for a manager holding twenty delegations meant clearing
// the same twenty rows after every update.
//
// Addresses and what kind of mailbox each one was, and nothing else. What a mailbox is lives
// in delegated.json and accounts.json and stays there, so a mailbox brought back is the one
// that was hidden rather than a fresh stranger. The kind is here because the two discovery
// paths ask different questions of this list: the relay can say a delegation is gone, and a
// hidden entry may only be pruned on that word if it was a delegation in the first place.
//
// The file is not the old removed.json. That name still lies orphaned in userData from the
// list that was dropped in August, holding one address; reusing it would silently hide that
// mailbox on the first start after this ships.

import { readJsonFile, writeJsonFile } from '../core/json-store';
import type { HiddenAccount } from '../../renderer/lib/hidden-accounts';

export type { HiddenAccount };


//===========================
// Store
//===========================

export class HiddenStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the hidden mailboxes, treating an unreadable file as none hidden
   *
   * A wrecked file costing someone every mailbox is worse than one that has forgotten what
   * was waved away, so anything unrecognisable reads as nothing.
   *
   * @returns the entries, addresses lowercased
   */
  list(): HiddenAccount[] {
    const raw = readJsonFile(this.filePath);
    if (!Array.isArray(raw)) return [];
    const out: HiddenAccount[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
      if (!email) continue;
      // Anything but the word itself reads as an own account: an entry that fell through as
      // delegated would be pruned by the first scan that did not name it, which is every scan.
      out.push({ email, kind: r.kind === 'delegated' ? 'delegated' : 'authuser' });
    }
    return out;
  }

  /**
   * The hidden addresses of one kind
   *
   * @param kind
   * @returns the addresses, lowercased
   */
  emailsOfKind(kind: HiddenAccount['kind']): string[] {
    return this.list().filter((h) => h.kind === kind).map((h) => h.email);
  }

  /**
   * Whether this mailbox is one the user waved away
   *
   * @param email in whatever case the caller happens to hold it
   * @returns {boolean}
   */
  has(email: string): boolean {
    const key = email.trim().toLowerCase();
    return this.list().some((h) => h.email === key);
  }

  /**
   * Remembers that this mailbox was removed
   *
   * A second add for the same address wins on kind: detection and the relay can both name it,
   * and whichever spoke last knows what the row on screen actually was.
   *
   * @param email
   * @param kind
   */
  add(email: string, kind: HiddenAccount['kind']): void {
    const key = email.trim().toLowerCase();
    if (!key) return;
    const held = this.list();
    const at = held.findIndex((h) => h.email === key);
    if (at === -1) held.push({ email: key, kind });
    else if (held[at].kind === kind) return;
    else held[at] = { email: key, kind };
    writeJsonFile(this.filePath, held);
  }

  /**
   * Lets this mailbox be found again
   *
   * @param email
   */
  remove(email: string): void {
    const key = email.trim().toLowerCase();
    const held = this.list();
    if (!held.some((h) => h.email === key)) return;
    writeJsonFile(this.filePath, held.filter((h) => h.email !== key));
  }
}
