// Writes a saved mail to disk and appends a line to log.jsonl. A failed line carries
// `error` instead of file and bytes; a `copy` entry describes a copy to another account.
//
// The mail's own text is deliberately absent. This log records what happened to a mail, not
// what was in it: it outlives the .eml files beside it, so a body field would leave a second
// copy of every mail that ever passed through, on a share where nobody expects mail to be.
//
// Filenames are sanitised per code point rather than with a regex class, since a subject
// can contain a newline and Windows rejects a name ending in a dot or a space. Timestamps
// are split in UTC, the log's own zone, so folder and log line match.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmlHeaders } from './eml';
import type { MessageRef } from './dropzone';



//===========================
// Types
//===========================

/** One message of a conversation, with whichever id the route that fetched it knew: the
 * API answers with `id`, the show-original page with `permMsgId`. Both are absent for
 * anything that was not fetched per message, and then a drag cannot point at it. */
export interface SavedMessage {
  raw: Buffer;
  headers: EmlHeaders;
  id?: string;
  permMsgId?: string;
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
  error?: string;
  label?: string;
  copy?: { to: string; labels: string[]; ok: boolean; error?: string };
}


//===========================
// Constants
//===========================

const MAX_NAME = 60;


//===========================
// Exported functions
//===========================


/**
 * Turns a subject or sender into something Windows accepts as a filename
 *
 * @param s
 * @param fallback used when nothing usable is left
 * @returns the name, at most MAX_NAME characters
 */
export function safeName(s: string, fallback = 'onbekend'): string {
  const cleaned = stripControl(s || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

/**
 * The human part of an address header
 *
 * @param address
 * @returns the display name, or the bare address when there is none
 */
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

/**
 * The one message worth keeping out of a conversation
 *
 * The last one, since it quotes the others: a dragged conversation is wanted as one mail,
 * not a folder of six. The cost is deliberate — an attachment from an earlier message does
 * not come along. Date headers decide, and thread order settles a tie in favour of the
 * later message, since Gmail hands a thread back oldest first.
 *
 * @param messages
 * @returns the newest message, or null when there are none
 */
export function newestMessage(messages: SavedMessage[]): SavedMessage | null {
  let best: SavedMessage | null = null;
  let bestAt = -Infinity;
  for (const m of messages) {
    if (best === null || at(m) >= bestAt) {
      best = m;
      bestAt = at(m);
    }
  }
  return best;
}


/**
 * The message a drag named
 *
 * @param messages
 * @param ref the ids the drag picked up
 * @returns that message, or null when no message of this thread answers to the ref
 */
export function draggedMessage(
  messages: SavedMessage[],
  ref: MessageRef | null,
): SavedMessage | null {
  if (!ref || (!ref.legacyId && !ref.permId)) return null;
  return (
    messages.find(
      (m) => (ref.legacyId && m.id === ref.legacyId) || (ref.permId && m.permMsgId === ref.permId),
    ) ?? null
  );
}

/**
 * The folder name a dragged conversation lands in
 *
 * @param dropIso when the drop happened
 * @param first the headers of the first message
 * @returns the folder name, stamped in UTC to match the log line
 */
export function threadFolderName(dropIso: string, first: EmlHeaders): string {
  const { date, time } = stamp(dropIso);
  const who = safeName(displayName(first.from));
  const what = safeName(first.subject, 'geen onderwerp');
  return `${date}_${time}_${who}_${what}`;
}

/**
 * The filename one saved message gets
 *
 * @param index numbering runs across a whole label drag, keeping Gmail's order visible
 * @param h the message's headers
 * @param fallbackIso used when the message has no usable Date
 * @returns the .eml filename
 */
export function messageFileName(index: number, h: EmlHeaders, fallbackIso: string): string {
  const { date, time } = stamp(h.date ?? fallbackIso);
  const who = safeName(displayName(h.from));
  const what = safeName(h.subject, 'geen onderwerp');
  return `${String(index + 1).padStart(2, '0')}_${date}_${time}_${who}_${what}.eml`;
}

/**
 * Writes a dragged conversation to its own folder
 *
 * @param root the drop folder
 * @param dropIso when the drop happened
 * @param messages
 * @returns the paths written, relative to root
 */
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

/**
 * The folder name a dragged label lands in
 *
 * A nested label is a path and a folder name cannot hold one, so its parts are spelled out
 * side by side; dropping the separator glued the parent and the subfolder into one word.
 *
 * @param dropIso when the drop happened
 * @param label
 * @returns the folder name
 */
export function labelFolderName(dropIso: string, label: string): string {
  const { date, time } = stamp(dropIso);
  const path = (label || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' - ');
  return `${date}_${time}_label_${safeName(path, 'label')}`;
}

/**
 * Writes a dragged label to one folder
 *
 * @param root the drop folder
 * @param dropIso when the drop happened
 * @param label
 * @param messages
 * @returns the paths written, relative to root
 */
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

/**
 * Appends lines to log.jsonl beside the saved mail
 *
 * @param root the drop folder
 * @param records
 */
export function appendLog(root: string, records: LogRecord[]): void {
  if (records.length === 0) return;
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, 'log.jsonl'), records.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8');
}


//===========================
// Helper functions
//===========================

const stripControl = (s: string) =>
  Array.from(s, (c) => ((c.codePointAt(0) ?? 32) < 32 ? ' ' : c)).join('');

/**
 * When a message was sent, as something sortable
 *
 * @param m
 * @returns the Date header in milliseconds, or -Infinity when it cannot be read, so a
 *   message without a usable date never beats one that has it
 * @private
 */
function at(m: SavedMessage): number {
  const ms = m.headers.date ? Date.parse(m.headers.date) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * Splits a timestamp into the date and time a folder name uses
 *
 * @param iso
 * @returns both parts in UTC, the same zone as the ISO stamp in the log
 * @private
 */
function stamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`,
  };
}

/**
 * A folder name that does not collide with one already there
 *
 * @param root
 * @param name the wanted name
 * @returns the name, suffixed with a number when it was taken
 * @private
 */
function uniqueDir(root: string, name: string): string {
  if (!existsSync(join(root, name))) return name;
  for (let n = 2; n < 1000; n++) {
    if (!existsSync(join(root, `${name}-${n}`))) return `${name}-${n}`;
  }
  return `${name}-${Date.now()}`;
}
