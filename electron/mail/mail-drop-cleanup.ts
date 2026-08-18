// Throws away saved mail once it is three days old. The drop folder is a staging area for
// getting a mail into another mailbox, not an archive, and it holds complete customer mail
// outside Gmail on a network share.
//
// Age comes from the stamp in the name rather than from the file's own mtime: the folder
// names carry the drop moment in UTC, and a redirected share is not to be trusted with
// timestamps. Anything without a readable stamp -- a diagnose dump, a stray file -- falls
// back to mtime, so nothing outlives the term by being unnamed.
//
// log.jsonl is never removed: it is the only record of what was ever copied. Nothing writes
// mail text into it any more, but versions before this one wrote a `body` field holding the
// full plain text, and those lines are already on the share. Every sweep takes that field
// out of whatever it finds -- age plays no part, the text does not belong there at any age --
// and leaves every other field of the line standing.

import { readdir, stat, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { notifyLog } from '../notify/notify-log';


//===========================
// Types
//===========================

/** One entry of the drop folder as the decision needs it, so the rule can be tested
 * without a disk. */
export interface DropEntry {
  name: string;
  isDirectory: boolean;
  mtimeMs: number;
}


//===========================
// Constants
//===========================

export const KEEP_DAYS = 3;

export const LOG_NAME = 'log.jsonl';

const DAY_MS = 24 * 60 * 60 * 1000;

const SWEEP_MS = 6 * 60 * 60 * 1000;

// 2026-08-18_1130_Jan_de_Vries_Offerte, and the same shape for a label folder. Both halves
// are UTC, the zone stamp() writes and the log records.
const STAMP = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:[_-]|$)/;


//===========================
// Exported functions
//===========================

/**
 * Which entries of the drop folder have passed the term
 *
 * @param entries
 * @param nowMs
 * @param days
 * @returns the names to remove, in the order they came in
 */
export function expiredEntries(entries: DropEntry[], nowMs: number, days = KEEP_DAYS): string[] {
  const cutoff = nowMs - days * DAY_MS;
  return entries
    .filter((e) => e.name !== LOG_NAME && ageStamp(e.name, e.mtimeMs) <= cutoff)
    .map((e) => e.name);
}

/**
 * Takes the mail text out of the log records that still carry it
 *
 * A line that will not parse is handed back untouched rather than dropped: the share this
 * log lives on has zeroed out appended records before, and a rewrite is no place to lose
 * the evidence of that.
 *
 * @param lines the file's lines, without their newlines
 * @returns the lines to write back, and how many lost a body
 */
export function logLinesWithoutBody(lines: string[]): { lines: string[]; stripped: number } {
  let stripped = 0;
  const out = lines.map((line) => {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line;
    }
    if (typeof record !== 'object' || record === null) return line;
    if (record.body === undefined) return line;
    delete record.body;
    stripped += 1;
    return JSON.stringify(record);
  });
  return { lines: out, stripped };
}

/**
 * Removes the saved mail that has passed the term
 *
 * Every failure is per entry: a share that is offline or a file another program holds open
 * must not stop the rest, and the next sweep tries again.
 *
 * @param root the drop folder
 * @param nowMs
 * @returns what went and what refused
 */
export async function cleanMailDrop(
  root: string,
  nowMs = Date.now(),
): Promise<{ removed: string[]; failed: string[]; stripped: number }> {
  const removed: string[] = [];
  const failed: string[] = [];

  let entries: DropEntry[];
  try {
    entries = await readEntries(root);
  } catch {
    // No folder yet, or the share is away. Nothing to say about either.
    return { removed, failed, stripped: 0 };
  }

  for (const name of expiredEntries(entries, nowMs)) {
    try {
      await rm(join(root, name), { recursive: true, force: true });
      removed.push(name);
    } catch (e) {
      failed.push(name);
      console.warn(`[maildrop] kan ${name} niet opruimen:`, e);
    }
  }

  const stripped = await pruneLog(root);

  if (removed.length > 0 || failed.length > 0 || stripped > 0) {
    notifyLog(
      `[maildrop] opgeruimd na ${KEEP_DAYS} dagen: ${removed.length} verwijderd` +
        `${failed.length > 0 ? `, ${failed.length} mislukt` : ''}` +
        `${stripped > 0 ? `, ${stripped} logregels zonder tekst` : ''}`,
    );
  }
  return { removed, failed, stripped };
}

/**
 * Sweeps the drop folder now and keeps sweeping while the app runs
 *
 * A machine that stays open for a week would otherwise only ever clean up on the day it
 * was started.
 *
 * @param folderOf reads the current folder, which the settings can point elsewhere
 */
export function startMailDropCleanup(folderOf: () => string): void {
  const sweep = () => {
    void cleanMailDrop(folderOf()).catch((e) => console.warn('[maildrop] opruimen mislukt:', e));
  };
  sweep();
  setInterval(sweep, SWEEP_MS);
}


//===========================
// Helper functions
//===========================

/**
 * When an entry was dropped
 *
 * @param name
 * @param mtimeMs the fallback for a name that carries no stamp
 * @returns the moment in milliseconds
 * @private
 */
function ageStamp(name: string, mtimeMs: number): number {
  const m = STAMP.exec(name);
  if (!m) return mtimeMs;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * Reads the drop folder into the shape the rule works on
 *
 * @param root
 * @returns one entry per name, an unreadable one carrying now so it is never removed on a
 *   failed stat
 * @private
 */
async function readEntries(root: string): Promise<DropEntry[]> {
  const names = await readdir(root, { withFileTypes: true });
  return await Promise.all(
    names.map(async (d) => {
      let mtimeMs = Date.now();
      try {
        mtimeMs = (await stat(join(root, d.name))).mtimeMs;
      } catch {
      }
      return { name: d.name, isDirectory: d.isDirectory(), mtimeMs };
    }),
  );
}

/**
 * Rewrites log.jsonl without the mail text older versions wrote into it
 *
 * Through a temporary file, so a write that dies halfway leaves the log as it was.
 *
 * @param root
 * @returns how many records lost their body
 * @private
 */
async function pruneLog(root: string): Promise<number> {
  const path = join(root, LOG_NAME);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return 0;
  }
  const ends = raw.endsWith('\n');
  const lines = raw.split('\n');
  const trailing = ends ? lines.pop() : undefined;
  const { lines: kept, stripped } = logLinesWithoutBody(lines);
  if (stripped === 0) return 0;
  const body = kept.join('\n') + (trailing === undefined ? '' : '\n');
  try {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, path);
  } catch (e) {
    console.warn('[maildrop] kan log.jsonl niet herschrijven:', e);
    return 0;
  }
  return stripped;
}
