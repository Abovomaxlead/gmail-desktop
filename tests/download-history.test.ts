// The download history store: its records, parsing and trimming.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DownloadRecord } from '../electron/ipc';
import {
  DownloadHistoryStore,
  MAX_RECORDS,
  parseRecords,
  trimRecords,
} from '../electron/download-history';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'download-history-'));
  file = join(dir, 'downloads.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function record(patch: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    filename: 'factuur.pdf',
    path: 'C:\\Users\\rene\\Downloads\\factuur.pdf',
    url: 'https://mail.google.com/factuur.pdf',
    bytes: 12345,
    startedAt: 1_700_000_000_000,
    state: 'completed',
    ...patch,
  };
}

describe('DownloadHistoryStore', () => {
  it('returns an empty list when the file is missing', () => {
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  it('persists a record and reads it back from a fresh instance', () => {
    new DownloadHistoryStore(file).add(record());
    expect(new DownloadHistoryStore(file).all()).toEqual([record()]);
  });

  it('keeps the newest record first', () => {
    const store = new DownloadHistoryStore(file);
    store.add(record({ filename: 'oud.pdf' }));
    store.add(record({ filename: 'nieuw.pdf' }));
    expect(store.all().map((r) => r.filename)).toEqual(['nieuw.pdf', 'oud.pdf']);
  });

  it('trims to MAX_RECORDS and drops the oldest', () => {
    const full = Array.from({ length: MAX_RECORDS }, (_, i) => record({ filename: `oud-${i}.pdf` }));
    writeFileSync(file, JSON.stringify(full), 'utf8');
    const store = new DownloadHistoryStore(file);
    store.add(record({ filename: 'nieuw.pdf' }));
    const all = store.all();
    expect(all).toHaveLength(MAX_RECORDS);
    expect(all[0].filename).toBe('nieuw.pdf');
    expect(all.some((r) => r.filename === `oud-${MAX_RECORDS - 1}.pdf`)).toBe(false);
  });

  it('clears the whole list', () => {
    const store = new DownloadHistoryStore(file);
    store.add(record());
    store.clear();
    expect(store.all()).toEqual([]);
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  it('tolerates a corrupt file by returning an empty list', () => {
    writeFileSync(file, '[{"filename": "half', 'utf8');
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  it('ignores a file that holds something other than an array', () => {
    writeFileSync(file, '{"downloads": []}', 'utf8');
    expect(new DownloadHistoryStore(file).all()).toEqual([]);
  });

  it('recovers by writing a fresh list after a corrupt read', () => {
    writeFileSync(file, 'niet eens json', 'utf8');
    const store = new DownloadHistoryStore(file);
    store.add(record());
    expect(new DownloadHistoryStore(file).all()).toEqual([record()]);
  });
});

describe('parseRecords', () => {
  it('drops junk entries and keeps the usable ones', () => {
    const parsed = parseRecords([
      null,
      'een tekst',
      42,
      ['een array'],
      {},
      { filename: '   ', path: '' },
      record({ filename: 'goed.pdf' }),
    ]);
    expect(parsed.map((r) => r.filename)).toEqual(['goed.pdf']);
  });

  it('coerces an unknown state to interrupted', () => {
    expect(parseRecords([record({ state: 'geslaagd?' as DownloadRecord['state'] })])[0].state).toBe(
      'interrupted',
    );
    expect(parseRecords([{ ...record(), state: undefined }])[0].state).toBe('interrupted');
  });

  it('replaces a non-numeric size or time with zero', () => {
    const parsed = parseRecords([{ ...record(), bytes: 'veel', startedAt: 'gisteren' }]);
    expect(parsed[0].bytes).toBe(0);
    expect(parsed[0].startedAt).toBe(0);
  });

  it('falls back to the basename when the filename is missing', () => {
    const parsed = parseRecords([{ path: '/home/rene/Downloads/bon.pdf' }]);
    expect(parsed[0].filename).toBe('bon.pdf');
  });
});

describe('trimRecords', () => {
  it('keeps the first max records', () => {
    const records = [record({ filename: 'a' }), record({ filename: 'b' }), record({ filename: 'c' })];
    expect(trimRecords(records, 2).map((r) => r.filename)).toEqual(['a', 'b']);
    expect(trimRecords(records)).toHaveLength(3);
    expect(trimRecords(records, 0)).toEqual([]);
  });
});
