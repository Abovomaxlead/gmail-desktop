// The download log: one JSON array in userData, newest record first. Its own file
// rather than a pref, because it grows and a half-written line here must not take
// every setting down with it. `./ipc` is a type-only import on purpose — a real one
// would create a cycle, since ipc.ts must not know about storage.
//
// Parsing is deliberately tolerant: the file is hand-editable and can be left
// half-written, so bad records are dropped and the rest survives, and an unrecognised
// state becomes 'interrupted' rather than 'completed' because 'completed' enables an
// "open file" button for a file that may not exist. File order is the order (`add`
// prepends) and is never sorted by `startedAt`, because a big download that began
// earlier can finish later. The caller supplies `startedAt`, so the recorded time is
// the download's rather than the write's.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { DownloadRecord } from './ipc';

export const MAX_RECORDS = 200;

const STATES: readonly DownloadRecord['state'][] = ['completed', 'cancelled', 'interrupted'];

function toState(raw: unknown): DownloadRecord['state'] {
  return STATES.find((s) => s === raw) ?? 'interrupted';
}

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

export function parseRecords(raw: unknown): DownloadRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DownloadRecord[] = [];
  for (const item of raw) {
    const record = toRecord(item);
    if (record) out.push(record);
  }
  return out;
}

export function trimRecords(
  records: readonly DownloadRecord[],
  max: number = MAX_RECORDS,
): DownloadRecord[] {
  if (max <= 0) return [];
  return records.slice(0, max);
}

export class DownloadHistoryStore {
  constructor(private readonly filePath: string) {}

  all(): DownloadRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseRecords(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return [];
    }
  }

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
