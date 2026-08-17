// The download log: one JSON array in userData, newest first. Its own file rather than a
// pref, so a half-written line cannot take every setting down with it.
//
// Parsing is tolerant, since the file is hand-editable: bad records are dropped, and an
// unrecognised state becomes 'interrupted' rather than 'completed', which would enable an
// "open file" button for a file that may not exist.
//
// File order is the order and is never sorted by `startedAt`, because a big download that
// began earlier can finish later.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { DownloadRecord } from '../core/ipc';


//===========================
// Constants
//===========================

export const MAX_RECORDS = 200;

const STATES: readonly DownloadRecord['state'][] = ['completed', 'cancelled', 'interrupted'];


//===========================
// Exported functions
//===========================

/**
 * Reads the records out of whatever the file held
 *
 * @param raw the parsed JSON, which may be anything
 * @returns the records that survived; a bad one is dropped, not fatal
 */
export function parseRecords(raw: unknown): DownloadRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DownloadRecord[] = [];
  for (const item of raw) {
    const record = toRecord(item);
    if (record) out.push(record);
  }
  return out;
}

/**
 * Keeps the newest records and drops the tail
 *
 * @param records newest first
 * @param max
 * @returns at most max records, in the order they came in
 */
export function trimRecords(
  records: readonly DownloadRecord[],
  max: number = MAX_RECORDS,
): DownloadRecord[] {
  if (max <= 0) return [];
  return records.slice(0, max);
}


//===========================
// Store
//===========================

export class DownloadHistoryStore {
  constructor(private readonly filePath: string) {}

  /**
   * Every record on file, newest first
   *
   * @returns an empty list when the file is missing or unreadable
   */
  all(): DownloadRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseRecords(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return [];
    }
  }

  /**
   * Puts a record at the front of the log
   *
   * @param record
   */
  add(record: DownloadRecord): void {
    this.write(trimRecords([record, ...this.all()]));
  }

  clear(): void {
    this.write([]);
  }

  private write(records: readonly DownloadRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf8');
  }
}


//===========================
// Helper functions
//===========================

/**
 * Reads a record's state
 *
 * @param raw
 * @returns 'interrupted' for anything unrecognised, never 'completed'
 * @private
 */
function toState(raw: unknown): DownloadRecord['state'] {
  return STATES.find((s) => s === raw) ?? 'interrupted';
}

/**
 * Turns one entry from the file into a record
 *
 * @param raw
 * @returns null when there is neither a path nor a filename to show
 * @private
 */
function toRecord(raw: unknown): DownloadRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path.trim() : '';
  const filename = typeof r.filename === 'string' ? r.filename.trim() : '';
  if (!path && !filename) return null;
  return {
    filename: filename || basename(path),
    path,
    url: typeof r.url === 'string' ? r.url : '',
    bytes: typeof r.bytes === 'number' && Number.isFinite(r.bytes) && r.bytes >= 0 ? r.bytes : 0,
    startedAt: typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) ? r.startedAt : 0,
    state: toState(r.state),
  };
}
