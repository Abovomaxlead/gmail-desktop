// Deciding what of the drop folder has passed its three days, and taking the mail text out
// of the log records that went with it.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanMailDrop,
  expiredEntries,
  logLinesWithoutBody,
  KEEP_DAYS,
  LOG_NAME,
  type DropEntry,
} from '../electron/mail/mail-drop-cleanup';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-08-18T12:00:00.000Z');

const dir = (name: string, mtimeMs = now): DropEntry => ({ name, isDirectory: true, mtimeMs });
const file = (name: string, mtimeMs = now): DropEntry => ({ name, isDirectory: false, mtimeMs });

describe('expiredEntries', () => {
  it('removes a folder whose stamp is older than the term', () => {
    expect(expiredEntries([dir('2026-08-14_0930_Jan_de_Vries_Offerte')], now)).toEqual([
      '2026-08-14_0930_Jan_de_Vries_Offerte',
    ]);
  });
  it('keeps a folder dropped today', () => {
    expect(expiredEntries([dir('2026-08-18_0930_Jan_de_Vries_Offerte')], now)).toEqual([]);
  });
  it('keeps one that is a day short of the term', () => {
    expect(expiredEntries([dir('2026-08-16_1200_x_y')], now)).toEqual([]);
  });
  it('removes one that reaches the term exactly', () => {
    expect(expiredEntries([dir('2026-08-15_1200_x_y')], now)).toEqual(['2026-08-15_1200_x_y']);
  });
  it('reads the stamp of a label folder and of a suffixed folder alike', () => {
    expect(
      expiredEntries([dir('2026-08-14_0930_label_Klanten'), dir('2026-08-14_0930_x_y-2')], now),
    ).toEqual(['2026-08-14_0930_label_Klanten', '2026-08-14_0930_x_y-2']);
  });

  // The stamp beats the mtime: copying a folder onto the share touches the file's own time,
  // and the drop moment is what the term is about.
  it('trusts the stamp over a fresh mtime', () => {
    expect(expiredEntries([dir('2026-08-10_0800_x_y', now)], now)).toEqual([
      '2026-08-10_0800_x_y',
    ]);
  });
  it('falls back to the mtime for a name that carries no stamp', () => {
    expect(
      expiredEntries([file('diagnose-om-19f5582305cc4871.html', now - 5 * DAY)], now),
    ).toEqual(['diagnose-om-19f5582305cc4871.html']);
    expect(expiredEntries([file('diagnose-om-19f5582305cc4871.html', now)], now)).toEqual([]);
  });

  it('never removes the log, however old it is', () => {
    expect(expiredEntries([file(LOG_NAME, now - 400 * DAY)], now)).toEqual([]);
  });
  it('is empty for an empty folder', () => {
    expect(expiredEntries([], now)).toEqual([]);
  });
  it('keeps the order it was given', () => {
    expect(
      expiredEntries([dir('2026-08-10_0800_b_b'), file(LOG_NAME), dir('2026-08-11_0800_a_a')], now),
    ).toEqual(['2026-08-10_0800_b_b', '2026-08-11_0800_a_a']);
  });
  it('honours a term other than the default', () => {
    expect(expiredEntries([dir('2026-08-17_1200_x_y')], now, 1)).toEqual(['2026-08-17_1200_x_y']);
    expect(expiredEntries([dir('2026-08-17_1200_x_y')], now, KEEP_DAYS)).toEqual([]);
  });
});

// Nothing writes a body any more; this cleans up what versions before it left on the share.
// Age plays no part: mail text does not belong in this log at any age.
describe('logLinesWithoutBody', () => {
  const record = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      ts: '2026-08-14T09:30:00.000Z',
      account: 'koen@abovomaxlead.nl',
      threadId: '19f5582305cc4871',
      subject: 'Offerte week 31',
      body: 'Beste Jan, hierbij de offerte',
      ...over,
    });

  it('takes the body out and leaves every other field standing', () => {
    const { lines, stripped } = logLinesWithoutBody([record()]);
    expect(stripped).toBe(1);
    expect(JSON.parse(lines[0])).toEqual({
      ts: '2026-08-14T09:30:00.000Z',
      account: 'koen@abovomaxlead.nl',
      threadId: '19f5582305cc4871',
      subject: 'Offerte week 31',
    });
  });
  it('strips a record written a minute ago just the same', () => {
    const { lines, stripped } = logLinesWithoutBody([record({ ts: '2026-08-18T11:59:00.000Z' })]);
    expect(stripped).toBe(1);
    expect(JSON.parse(lines[0]).body).toBeUndefined();
  });
  it('strips a record whose ts cannot be read', () => {
    expect(logLinesWithoutBody([record({ ts: 'gisteren' })]).stripped).toBe(1);
  });
  it('leaves a record that has no body alone', () => {
    const failed = JSON.stringify({ ts: '2026-08-14T09:30:00.000Z', error: 'Ophalen mislukt' });
    expect(logLinesWithoutBody([failed])).toEqual({ lines: [failed], stripped: 0 });
  });
  it('hands back a line that will not parse, rather than dropping it', () => {
    expect(logLinesWithoutBody(['{"ts":"2026-08-14T09:3'])).toEqual({
      lines: ['{"ts":"2026-08-14T09:3'],
      stripped: 0,
    });
  });
  it('counts every record it stripped', () => {
    expect(logLinesWithoutBody([record(), record(), JSON.stringify({ ts: 'x' })]).stripped).toBe(2);
  });
  it('keeps an empty line where it was', () => {
    expect(logLinesWithoutBody([''])).toEqual({ lines: [''], stripped: 0 });
  });
});

// Against a real folder, since this is the one function in the app that deletes anything.
describe('cleanMailDrop', () => {
  const root = () => mkdtempSync(join(tmpdir(), 'maildrop-cleanup-'));
  const drop = (dir: string, name: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, '01_mail.eml'), 'Subject: x');
  };

  it('removes what passed the term and leaves the rest standing', async () => {
    const dir = root();
    drop(dir, '2026-08-14_0930_Jan_de_Vries_Offerte');
    drop(dir, '2026-08-18_0930_Jan_de_Vries_Offerte');
    writeFileSync(join(dir, 'diagnose-om-19f55.html'), '<html></html>');

    const out = await cleanMailDrop(dir, now);

    expect(out.removed).toEqual(['2026-08-14_0930_Jan_de_Vries_Offerte']);
    expect(out.failed).toEqual([]);
    expect(existsSync(join(dir, '2026-08-14_0930_Jan_de_Vries_Offerte'))).toBe(false);
    expect(existsSync(join(dir, '2026-08-18_0930_Jan_de_Vries_Offerte', '01_mail.eml'))).toBe(true);
    expect(existsSync(join(dir, 'diagnose-om-19f55.html'))).toBe(true);
  });

  it('keeps the log and takes the mail text out of every record that has one', async () => {
    const dir = root();
    const old = { ts: '2026-08-14T09:30:00.000Z', threadId: 'a', subject: 'Offerte', body: 'Beste Jan' };
    const young = { ts: '2026-08-18T09:30:00.000Z', threadId: 'b', subject: 'Factuur', body: 'Hierbij' };
    writeFileSync(join(dir, LOG_NAME), `${JSON.stringify(old)}\n${JSON.stringify(young)}\n`, 'utf8');

    const out = await cleanMailDrop(dir, now);

    expect(out.stripped).toBe(2);
    const lines = readFileSync(join(dir, LOG_NAME), 'utf8').split('\n');
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0])).toEqual({ ts: old.ts, threadId: 'a', subject: 'Offerte' });
    expect(JSON.parse(lines[1])).toEqual({ ts: young.ts, threadId: 'b', subject: 'Factuur' });
    expect(readFileSync(join(dir, LOG_NAME), 'utf8')).not.toContain('Beste Jan');
    expect(existsSync(join(dir, `${LOG_NAME}.tmp`))).toBe(false);
  });

  it('says nothing and throws nothing when the folder is not there', async () => {
    const out = await cleanMailDrop(join(tmpdir(), 'maildrop-bestaat-niet-9f3a'), now);
    expect(out).toEqual({ removed: [], failed: [], stripped: 0 });
  });

  it('leaves a folder alone that holds nothing but is still young', async () => {
    const dir = root();
    mkdirSync(join(dir, '2026-08-18_1000_leeg_leeg'));
    const out = await cleanMailDrop(dir, now);
    expect(out.removed).toEqual([]);
    expect(existsSync(join(dir, '2026-08-18_1000_leeg_leeg'))).toBe(true);
  });
});
