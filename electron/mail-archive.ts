// Writes a saved mail to disk and appends a line to log.jsonl. On failure that line
// carries `error` and whatever was known instead of file/bytes/body; a `target` entry
// describes a copy to another account rather than the save itself.
//
// Filenames are sanitised per code point rather than with a regex class, because a
// subject can contain a newline and an escaped character class is easy to break here,
// and Windows rejects a name ending in a dot or a space. Timestamps are split in UTC,
// the same zone as the ISO stamp in the log, so folder and log line match. A label
// drag puts everything in one folder with numbering that runs across the threads,
// keeping Gmail's order visible in the filenames.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmlHeaders } from './eml';

export interface SavedMessage {
  raw: Buffer;
  headers: EmlHeaders;
}

export interface LogRecord {
  ts: string;
  account: string;
  threadId: string;
  messageId?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  date?: string | null;
  file?: string;
  bytes?: number;
  body?: string;
  error?: string;
  label?: string;
  copy?: { to: string; labels: string[]; ok: boolean; error?: string };
}

const MAX_NAME = 60;

const stripControl = (s: string) =>
  Array.from(s, (c) => ((c.codePointAt(0) ?? 32) < 32 ? ' ' : c)).join('');

export function safeName(s: string, fallback = 'onbekend'): string {
  const cleaned = stripControl(s || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

export function displayName(address: string): string {
  const a = (address || '').trim();
  if (!a) return '';
  const lt = a.indexOf('<');
  if (lt === -1) return a;
  const name = a.slice(0, lt).trim().replace(/^"|"$/g, '');
  if (name) return name;
  return a
    .slice(lt + 1)
    .replace(/>.*$/, '')
    .trim();
}

function stamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`,
  };
}

export function threadFolderName(dropIso: string, first: EmlHeaders): string {
  const { date, time } = stamp(dropIso);
  const who = safeName(displayName(first.from));
  const what = safeName(first.subject, 'geen onderwerp');
  return `${date}_${time}_${who}_${what}`;
}

export function messageFileName(index: number, h: EmlHeaders, fallbackIso: string): string {
  const { date, time } = stamp(h.date ?? fallbackIso);
  const who = safeName(displayName(h.from));
  const what = safeName(h.subject, 'geen onderwerp');
  return `${String(index + 1).padStart(2, '0')}_${date}_${time}_${who}_${what}.eml`;
}

function uniqueDir(root: string, name: string): string {
  if (!existsSync(join(root, name))) return name;
  for (let n = 2; n < 1000; n++) {
    if (!existsSync(join(root, `${name}-${n}`))) return `${name}-${n}`;
  }
  return `${name}-${Date.now()}`;
}

export function writeThread(root: string, dropIso: string, messages: SavedMessage[]): string[] {
  if (messages.length === 0) return [];
  mkdirSync(root, { recursive: true });
  const folder = uniqueDir(root, threadFolderName(dropIso, messages[0].headers));
  mkdirSync(join(root, folder), { recursive: true });
  return messages.map((m, i) => {
    const file = messageFileName(i, m.headers, dropIso);
    writeFileSync(join(root, folder, file), m.raw);
    return `${folder}/${file}`;
  });
}

export function labelFolderName(dropIso: string, label: string): string {
  const { date, time } = stamp(dropIso);
  return `${date}_${time}_label_${safeName(label, 'label')}`;
}

export function writeLabel(
  root: string,
  dropIso: string,
  label: string,
  messages: SavedMessage[],
): string[] {
  if (messages.length === 0) return [];
  mkdirSync(root, { recursive: true });
  const folder = uniqueDir(root, labelFolderName(dropIso, label));
  mkdirSync(join(root, folder), { recursive: true });
  return messages.map((m, i) => {
    const file = messageFileName(i, m.headers, dropIso);
    writeFileSync(join(root, folder, file), m.raw);
    return `${folder}/${file}`;
  });
}

export function appendLog(root: string, records: LogRecord[]): void {
  if (records.length === 0) return;
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, 'log.jsonl'), records.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8');
}
