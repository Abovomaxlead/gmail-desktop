// Writing dragged mail to disk: safe file names, thread and label files, the log.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  safeName,
  displayName,
  threadFolderName,
  messageFileName,
  writeThread,
  writeLabel,
  appendLog,
} from '../electron/mail-archive';
import type { EmlHeaders } from '../electron/eml';

const root = () => mkdtempSync(join(tmpdir(), 'maildrop-'));

const headers = (over: Partial<EmlHeaders> = {}): EmlHeaders => ({
  from: 'Jan de Vries <jan@example.com>',
  to: ['luca@example.com'],
  cc: [],
  subject: 'Offerte week 31',
  date: '2026-07-29T08:02:44.000Z',
  messageId: '<CAF123@mail.gmail.com>',
  ...over,
});

describe('safeName', () => {
  it('strips characters Windows forbids in a filename', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });
  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(safeName('  veel    ruimte  ...  ')).toBe('veel ruimte');
  });
  it('turns a newline in the subject into a space', () => {
    expect(safeName('regel1\nregel2')).toBe('regel1 regel2');
  });
  it('truncates to 60 characters', () => {
    expect(safeName('x'.repeat(200))).toHaveLength(60);
  });
  it('returns the fallback when nothing is left', () => {
    expect(safeName('///', 'onbekend')).toBe('onbekend');
    expect(safeName('')).toBe('onbekend');
  });
  it('keeps non-ascii characters', () => {
    expect(safeName('Café — offerte 🎉')).toBe('Café — offerte 🎉');
  });
});

describe('displayName', () => {
  it('takes the name in front of the angle brackets', () => {
    expect(displayName('Jan de Vries <jan@example.com>')).toBe('Jan de Vries');
  });
  it('unquotes a quoted name', () => {
    expect(displayName('"Vries, A." <a@example.com>')).toBe('Vries, A.');
  });
  it('falls back to the bare address', () => {
    expect(displayName('jan@example.com')).toBe('jan@example.com');
    expect(displayName('<jan@example.com>')).toBe('jan@example.com');
  });
  it('returns an empty string for an empty address', () => {
    expect(displayName('')).toBe('');
  });
});

describe('name building', () => {
  it('builds the thread folder from the drop time and the first message', () => {
    expect(threadFolderName('2026-07-31T12:32:10.412Z', headers())).toBe(
      '2026-07-31_1232_Jan de Vries_Offerte week 31',
    );
  });
  it('builds a message name from the message own date, numbered from 01', () => {
    expect(messageFileName(0, headers(), '2026-07-31T12:32:10.412Z')).toBe(
      '01_2026-07-29_0802_Jan de Vries_Offerte week 31.eml',
    );
  });
  it('uses the drop time when the message has no date', () => {
    expect(messageFileName(1, headers({ date: null }), '2026-07-31T12:32:10.412Z')).toBe(
      '02_2026-07-31_1232_Jan de Vries_Offerte week 31.eml',
    );
  });
  it('falls back for a missing sender and subject', () => {
    expect(messageFileName(0, headers({ from: '', subject: '' }), '2026-07-31T12:32:10.412Z')).toBe(
      '01_2026-07-29_0802_onbekend_geen onderwerp.eml',
    );
  });
});

describe('writeThread', () => {
  it('writes every message into one folder and returns relative paths', () => {
    const dir = root();
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('EEN'), headers: headers() },
      { raw: Buffer.from('TWEE'), headers: headers({ subject: 'RE: Offerte week 31' }) },
    ]);
    expect(paths).toEqual([
      '2026-07-31_1232_Jan de Vries_Offerte week 31/01_2026-07-29_0802_Jan de Vries_Offerte week 31.eml',
      '2026-07-31_1232_Jan de Vries_Offerte week 31/02_2026-07-29_0802_Jan de Vries_RE Offerte week 31.eml',
    ]);
    expect(readFileSync(join(dir, paths[0]), 'utf8')).toBe('EEN');
    expect(readFileSync(join(dir, paths[1]), 'utf8')).toBe('TWEE');
  });

  it('uses a folder even for a single message', () => {
    const dir = root();
    writeThread(dir, '2026-07-31T12:32:10.412Z', [{ raw: Buffer.from('X'), headers: headers() }]);
    expect(readdirSync(dir)).toEqual(['2026-07-31_1232_Jan de Vries_Offerte week 31']);
  });

  it('suffixes the folder when the name is already taken', () => {
    const dir = root();
    mkdirSync(join(dir, '2026-07-31_1232_Jan de Vries_Offerte week 31'));
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(paths[0].startsWith('2026-07-31_1232_Jan de Vries_Offerte week 31-2/')).toBe(true);
  });

  it('creates the root folder when it does not exist yet', () => {
    const dir = join(root(), 'nog', 'niet', 'bestaand');
    const paths = writeThread(dir, '2026-07-31T12:32:10.412Z', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(readFileSync(join(dir, paths[0]), 'utf8')).toBe('X');
  });
});

describe('writeLabel', () => {
  it('puts every message from the label in one folder, numbered across threads', () => {
    const dir = root();
    const paths = writeLabel(dir, '2026-07-31T12:32:10.412Z', 'Klanten', [
      { raw: Buffer.from('EEN'), headers: headers() },
      { raw: Buffer.from('TWEE'), headers: headers({ subject: 'Factuur', from: 'Piet <p@x.nl>' }) },
      { raw: Buffer.from('DRIE'), headers: headers({ subject: 'Vraag' }) },
    ]);
    expect(paths).toHaveLength(3);
    const folders = new Set(paths.map((p) => p.split('/')[0]));
    expect(folders).toEqual(new Set(['2026-07-31_1232_label_Klanten']));
    expect(paths[0].split('/')[1].startsWith('01_')).toBe(true);
    expect(paths[2].split('/')[1].startsWith('03_')).toBe(true);
    expect(readFileSync(join(dir, paths[1]), 'utf8')).toBe('TWEE');
  });

  it('sanitises a label with a slash in it', () => {
    const dir = root();
    const paths = writeLabel(dir, '2026-07-31T12:32:10.412Z', 'Werk/Grote klanten', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(paths[0].split('/')[0]).toBe('2026-07-31_1232_label_WerkGrote klanten');
  });

  it('suffixes the folder when that label was dropped in the same minute', () => {
    const dir = root();
    mkdirSync(join(dir, '2026-07-31_1232_label_Klanten'), { recursive: true });
    const paths = writeLabel(dir, '2026-07-31T12:32:10.412Z', 'Klanten', [
      { raw: Buffer.from('X'), headers: headers() },
    ]);
    expect(paths[0].split('/')[0]).toBe('2026-07-31_1232_label_Klanten-2');
  });

  it('writes nothing for an empty list', () => {
    const dir = root();
    expect(writeLabel(dir, '2026-07-31T12:32:10.412Z', 'Klanten', [])).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('appendLog', () => {
  it('writes one JSON object per line', () => {
    const dir = root();
    appendLog(dir, [
      { ts: '2026-07-31T12:32:10.412Z', account: 'a@b.c', threadId: 't1', subject: 'Een' },
      { ts: '2026-07-31T12:32:10.412Z', account: 'a@b.c', threadId: 't1', subject: 'Twee' },
    ]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).subject).toBe('Twee');
  });

  it('appends without touching existing lines', () => {
    const dir = root();
    writeFileSync(join(dir, 'log.jsonl'), '{"ts":"eerder"}\n', 'utf8');
    appendLog(dir, [{ ts: 'nu', account: 'a@b.c', threadId: 't1' }]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).ts).toBe('eerder');
    expect(JSON.parse(lines[1]).ts).toBe('nu');
  });

  it('escapes newlines in the body so one record stays one line', () => {
    const dir = root();
    appendLog(dir, [{ ts: 'nu', account: 'a@b.c', threadId: 't1', body: 'regel1\nregel2' }]);
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).body).toBe('regel1\nregel2');
  });

  it('does nothing for an empty record list', () => {
    const dir = root();
    appendLog(dir, []);
    expect(readdirSync(dir)).toEqual([]);
  });
});
