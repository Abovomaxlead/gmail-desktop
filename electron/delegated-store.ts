// Durable storage for delegated mailboxes, holding Google's real URLs so a persisted
// entry keeps working regardless of switcher-DOM changes. Detection only ever adds;
// only explicit user removal deletes.
//
// mergeScan carries the health check: it never removes an entry a scan happened to
// miss, and reports `healthOk === false` when a scan returns fewer entries than are
// already held (probable scrape breakage), so the caller keeps the store intact
// instead of pruning. Fields from a fresh scan overwrite the stored ones.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredDelegate {
  email: string;
  /** Null for a mailbox discovered through the API, which knows the address and cannot know
   * the URL: the id in `/mail/u/<n>/d/<id>/` exists only in Google's own interface. Such a
   * mailbox is reachable over the API and not openable in a web view. */
  mailUrl: string | null;
  calendarUrl: string | null;
}

/** Absent is not the same as gone. A source that knows no URL — the API knows addresses and
 * nothing else — must not blank one that was captured, or a mailbox that opened this morning
 * stops opening because something wrote its address again. */
function keepUrls(held: StoredDelegate | undefined, incoming: StoredDelegate): StoredDelegate {
  return {
    ...held,
    ...incoming,
    mailUrl: incoming.mailUrl ?? held?.mailUrl ?? null,
    calendarUrl: incoming.calendarUrl ?? held?.calendarUrl ?? null,
  };
}

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

export class DelegatedStore {
  constructor(private readonly filePath: string) {}

  list(): StoredDelegate[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(items: StoredDelegate[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(items, null, 2), 'utf8');
  }

  upsert(d: StoredDelegate): void {
    const items = this.list();
    const held = items.find((x) => x.email.toLowerCase() === d.email.toLowerCase());
    const rest = items.filter((x) => x.email.toLowerCase() !== d.email.toLowerCase());
    rest.push(keepUrls(held, d));
    this.write(rest);
  }

  remove(email: string): void {
    this.write(this.list().filter((x) => x.email.toLowerCase() !== email.toLowerCase()));
  }
}
