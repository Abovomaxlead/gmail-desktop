// Durable storage for delegated mailboxes, holding Google's real URLs. Detection only ever
// adds; only an explicit user removal deletes.
//
// mergeScan carries the health check: it never removes an entry a scan missed, and reports
// healthOk false when a scan returns fewer entries than are held, which reads as breakage.

import { readJsonFile, writeJsonFile } from '../core/json-store';


//===========================
// Types
//===========================

export interface StoredDelegate {
  email: string;
  mailUrl: string | null;
  calendarUrl: string | null;
}


//===========================
// Exported functions
//===========================

/**
 * Folds a scan onto what is already stored
 *
 * @param existing
 * @param scanned
 * @returns the merged list, and healthOk false when the scan looks broken
 */
export function mergeScan(
  existing: StoredDelegate[],
  scanned: StoredDelegate[],
): { next: StoredDelegate[]; healthOk: boolean } {
  const byEmail = new Map(existing.map((d) => [d.email.toLowerCase(), d]));
  for (const s of scanned) {
    const key = s.email.toLowerCase();
    byEmail.set(key, keepUrls(byEmail.get(key), s));
  }
  return { next: [...byEmail.values()], healthOk: scanned.length >= existing.length };
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
   * Adds or updates one mailbox, keeping URLs the incoming entry does not know
   *
   * @param d
   */
  upsert(d: StoredDelegate): void {
    const items = this.list();
    const held = items.find((x) => x.email.toLowerCase() === d.email.toLowerCase());
    const rest = items.filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    rest.push(keepUrls(held, d));
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
 * Merges one mailbox onto the held entry without losing known URLs
 *
 * @param held the entry already stored, if any
 * @param incoming
 * @returns the entry to store
 * @private
 */
function keepUrls(held: StoredDelegate | undefined, incoming: StoredDelegate): StoredDelegate {
  return {
    ...held,
    ...incoming,
    mailUrl: incoming.mailUrl ?? held?.mailUrl ?? null,
    calendarUrl: incoming.calendarUrl ?? held?.calendarUrl ?? null,
  };
}
