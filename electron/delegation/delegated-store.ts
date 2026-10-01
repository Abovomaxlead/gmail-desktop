// Durable storage for delegated mailboxes, holding Google's real mail URL. Detection only
// ever adds; only an explicit user removal deletes.

import { readJsonFile, writeJsonFile } from '../core/json-store';


//===========================
// Types
//===========================

export interface StoredDelegate {
  email: string;
  mailUrl: string | null;
}


//===========================
// Store
//===========================

export class DelegatedStore {
  constructor(private readonly filePath: string) {}

  /**
   * Reads the stored mailboxes, treating an unreadable file as none
   *
   * @returns the stored mailboxes
   */
  list(): StoredDelegate[] {
    const raw = readJsonFile(this.filePath);
    return Array.isArray(raw) ? raw : [];
  }

  private write(items: StoredDelegate[]): void {
    writeJsonFile(this.filePath, items);
  }

  /**
   * Adds or updates one mailbox, keeping the URL the incoming entry does not know
   *
   * @param d
   */
  upsert(d: StoredDelegate): void {
    const items = this.list();
    const held = items.find((x) => x.email.toLowerCase() === d.email.toLowerCase());
    const rest = items.filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    rest.push(keepUrl(held, d));
    this.write(rest);
  }

  /**
   * Removes one mailbox; only an explicit user removal ever calls this
   *
   * @param email
   */
  remove(email: string): void {
    this.write(this.list().filter((x) => x.email.toLowerCase() !== email.toLowerCase()));
  }
}


//===========================
// Helper functions
//===========================

// Absent is not the same as gone. A source that knows no URL — the API knows addresses and
// nothing else — must not blank one that was captured, or a mailbox that opened this morning
// stops opening because something wrote its address again.

/**
 * Merges one mailbox onto the held entry without losing a known URL
 *
 * @param held the entry already stored, if any
 * @param incoming
 * @returns the entry to store
 * @private
 */
function keepUrl(held: StoredDelegate | undefined, incoming: StoredDelegate): StoredDelegate {
  return {
    ...held,
    ...incoming,
    mailUrl: incoming.mailUrl ?? held?.mailUrl ?? null,
  };
}
