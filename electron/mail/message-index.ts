// Where the app has already seen a mail sit, so the picker can say "staat er al" without
// asking Gmail first.
//
// Three things fill this and none of them costs a request. The app's own copies are the
// biggest source: a mail this app inserted into a mailbox under a label is exactly the
// duplicate it will be asked about next time, and both the Message-ID and the label are known
// at the moment of the insert. The scan behind the picker fills it as it answers. And the
// notification sync already reads headers of every new inbox mail, so one more header name on
// that call adds the arrivals for free.
//
// What this is NOT is a mirror of the mailbox. A Message-ID that is not in here has not been
// seen, which is not the same as not being there, so absence sends the caller to Gmail exactly
// as before. That keeps the copy deciding on Gmail's answer and never on this file. Being
// wrong the other way -- knowing a label that has since been taken off -- would over-warn, so
// what is in here has a shelf life.


import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';


//===========================
// Types
//===========================

/** One mailbox holding one mail, and when that was last confirmed. */
export interface IndexedIn {
  email: string;
  labelIds: string[];
  at: number;
}

/** Keyed on the Message-ID without its brackets, which is the only id stable across
 * mailboxes. */
export type MessageIndex = Map<string, IndexedIn[]>;

export type IndexRecords = Record<string, IndexedIn[]>;


//===========================
// Constants
//===========================

/** Gmail keeps its own history for about thirty days, and a label this never heard about
 * being taken off is the failure mode worth bounding. */
export const INDEX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Measured: twenty-four thousand entries is a file of 2.8 MB, thirteen milliseconds to write
 * and forty to read back at start-up. That is the ceiling worth having. */
export const MAX_ENTRIES = 25_000;

/** Long enough that the writes of one copy fold into one, short enough that quitting straight
 * after a drag still keeps what it learned. */
const SAVE_DELAY_MS = 2_000;


//===========================
// Exported functions
//===========================

export function emptyIndex(): MessageIndex {
  return new Map();
}

/**
 * Notes that a mailbox holds a mail
 *
 * @param index
 * @param messageId the RFC822 Message-ID, with or without brackets
 * @param email the mailbox
 * @param labelIds what holds it there, added to what was already known
 * @param now
 */
export function remember(
  index: MessageIndex,
  messageId: string,
  email: string,
  labelIds: string[],
  now: number,
): void {
  const key = bare(messageId);
  if (!key || !email) return;
  const mailbox = email.toLowerCase();
  const entries = index.get(key) ?? [];
  const known = entries.find((e) => e.email === mailbox);
  if (!known) {
    entries.push({ email: mailbox, labelIds: [...new Set(labelIds)], at: now });
    index.set(key, entries);
    return;
  }
  for (const labelId of labelIds) if (!known.labelIds.includes(labelId)) known.labelIds.push(labelId);
  known.at = now;
}

/**
 * What this knows about one mail in one mailbox
 *
 * @param index
 * @param messageId
 * @param email
 * @param now
 * @returns {null} when it has not been seen there, or was seen too long ago to still stand
 *   for the truth — either way the caller has to ask Gmail
 */
export function knownLabels(
  index: MessageIndex,
  messageId: string,
  email: string,
  now: number,
): string[] | null {
  const entry = index.get(bare(messageId))?.find((e) => e.email === email.toLowerCase());
  if (!entry || now - entry.at > INDEX_TTL_MS) return null;
  return entry.labelIds;
}

/**
 * Drops what has gone stale
 *
 * @param index
 * @param now
 */
export function prune(index: MessageIndex, now: number): void {
  for (const [key, entries] of index) {
    const fresh = entries.filter((e) => now - e.at <= INDEX_TTL_MS);
    if (fresh.length === 0) index.delete(key);
    else index.set(key, fresh);
  }
}

/**
 * Drops the oldest entries until the index fits
 *
 * The shelf life alone did not bound this: thirty days of a company's mail is tens of thousands
 * of entries and megabytes of file. An entry counts by the most recent mailbox it was seen in,
 * and keeps all of its mailboxes when it survives.
 *
 * @param index
 * @param max how many Message-IDs to keep
 */
export function capEntries(index: MessageIndex, max: number): void {
  if (index.size <= max) return;
  const newest = (entries: IndexedIn[]) => Math.max(...entries.map((e) => e.at));
  const byAge = [...index.entries()].sort((a, b) => newest(b[1]) - newest(a[1]));
  for (const [key] of byAge.slice(max)) index.delete(key);
}

/**
 * What the picker can draw for one mailbox before a single request goes out
 *
 * @param index
 * @param messageIds the drag's Message-IDs
 * @param email the mailbox
 * @param now
 * @returns one entry per mail this knows about there, leaving out the ones it does not, since
 *   an empty list would claim the mailbox holds nothing
 */
export function indexedScan(
  index: MessageIndex,
  messageIds: string[],
  email: string,
  now: number,
): Array<{ messageId: string; labelIds: string[] }> {
  const out: Array<{ messageId: string; labelIds: string[] }> = [];
  for (const messageId of messageIds) {
    const labelIds = knownLabels(index, messageId, email, now);
    if (labelIds) out.push({ messageId, labelIds });
  }
  return out;
}

export function toRecords(index: MessageIndex): IndexRecords {
  return Object.fromEntries(index);
}

/**
 * Reads the index back off disk
 *
 * @param raw whatever was in the file
 * @returns the index, empty for anything that is not the shape it wrote
 */
export function fromRecords(raw: unknown): MessageIndex {
  const index = emptyIndex();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return index;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const entries = value.filter(
      (e): e is IndexedIn =>
        !!e &&
        typeof e.email === 'string' &&
        typeof e.at === 'number' &&
        Array.isArray(e.labelIds) &&
        e.labelIds.every((l: unknown) => typeof l === 'string'),
    );
    if (entries.length > 0) index.set(key, entries);
  }
  return index;
}


//===========================
// Helper functions
//===========================

function bare(messageId: string): string {
  return (messageId ?? '').trim().replace(/^<+|>+$/g, '');
}


//===========================
// Store
//===========================

/** The index on disk. Apart from the tokens because this is a convenience, not a secret:
 * deleting the file costs a slower first picker and nothing else. */
export class MessageIndexStore {
  private cache: MessageIndex | null = null;

  private pending: ReturnType<typeof setTimeout> | null = null;

  private at = 0;

  constructor(private readonly filePath: string) {}

  /**
   * The index, read once and kept
   *
   * @returns the index, empty when the file is missing or unreadable
   */
  load(): MessageIndex {
    if (this.cache) return this.cache;
    try {
      this.cache = fromRecords(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      this.cache = emptyIndex();
    }
    return this.cache;
  }

  /**
   * Asks for what has been remembered to be written
   *
   * Off the main thread and not straight away, on purpose. This file runs to megabytes, and
   * the copy asks for a write once per landed insert while the existing-mail scan asks for
   * one per mailbox as each answers -- the same blocking write that was taken off the mail
   * drop itself. So the request is coalesced: the first one sets a timer, the ones that
   * follow ride along with it, and one whole-file write covers them all.
   *
   * @param now
   */
  save(now: number): void {
    this.at = now;
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.write(this.at);
    }, SAVE_DELAY_MS);
    // Nothing waits on that timer, and an app that is quitting should not lose the last answers
    this.pending.unref?.();
  }

  /**
   * Writes now, waiting for it
   *
   * @param now
   * @private
   */
  private async write(now: number): Promise<void> {
    const index = this.load();
    prune(index, now);
    capEntries(index, MAX_ENTRIES);
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(toRecords(index)), 'utf8');
    } catch (e) {
      console.warn('[index] could not save the index:', e);
    }
  }

  /**
   * Writes anything still owed, for a caller that is shutting down
   *
   * @param now
   */
  async flush(now: number): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    await this.write(now);
  }
}
