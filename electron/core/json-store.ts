// How every JSON file in userData is read and written, so a process that dies mid-write
// cannot cost the user their settings.
//
// Each store used to write straight over its own file, and writeFileSync truncates before
// it writes. An update is the one moment the app is killed rather than asked to stop -- the
// installer terminates whatever is still running -- so a write caught inside that window
// left a half-written file behind. Every store reads a file it cannot parse as "nothing
// stored at all", and the next setter saves that emptiness back over the wreckage, which is
// why settings came back as defaults after an update.
//
// So the new contents go to a .tmp beside the file, are flushed to the disk, and only then
// replace it in one rename: a reader sees either the whole old file or the whole new one,
// never half of either. The same contents then go to a .bak the same way, which is what a
// read falls back to when the main file is wreckage from before this existed -- or from
// anything else that can ruin a file on disk.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';


//===========================
// Types
//===========================

/** What one attempt at reading a file came to. `present` separates "no such file", which is
 * every first run, from "there is a file and it is broken", which is worth a line in the log. */
interface ParseResult {
  present: boolean;
  ok: boolean;
  value: unknown;
}


//===========================
// Exported functions
//===========================

/**
 * The path of the copy kept beside a store file
 *
 * @param filePath
 * @returns the backup path
 */
export function backupPath(filePath: string): string {
  return `${filePath}.bak`;
}

/**
 * The path a write goes to before it replaces the file it is replacing
 *
 * @param filePath
 * @returns the temporary path
 */
export function tempPath(filePath: string): string {
  return `${filePath}.tmp`;
}

/**
 * Reads one JSON file, falling back to the backup beside it
 *
 * @param filePath
 * @returns the parsed contents, or null when neither file holds anything usable
 */
export function readJsonFile(filePath: string): unknown {
  const main = parseFile(filePath);
  if (main.ok) return main.value;
  const backup = parseFile(backupPath(filePath));
  if (!backup.ok) return null;
  if (main.present) console.warn(`[store] ${filePath} is unreadable, read the backup instead`);
  return backup.value;
}

/**
 * Writes one JSON file so a reader only ever sees the whole of one version
 *
 * @param filePath
 * @param value
 */
export function writeJsonFile(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

/**
 * Writes any text file the same way, for the files that are not built from an object
 *
 * @param filePath
 * @param text
 */
export function writeFileAtomic(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  put(filePath, text);
  // The real file first, the backup after: a crash in between leaves a backup one version
  // behind, which is still a whole file and still the user's settings.
  put(backupPath(filePath), text);
}


//===========================
// Helper functions
//===========================

/**
 * Reads and parses one file without ever throwing
 *
 * @param filePath
 * @returns whether the file was there and whether it parsed
 * @private
 */
function parseFile(filePath: string): ParseResult {
  if (!existsSync(filePath)) return { present: false, ok: false, value: null };
  try {
    return { present: true, ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch {
    return { present: true, ok: false, value: null };
  }
}

/**
 * Puts text at a path in one step, as far as any reader is concerned
 *
 * @param filePath
 * @param text
 * @private
 */
function put(filePath: string, text: string): void {
  const tmp = tempPath(filePath);
  writeThrough(tmp, text);
  replaceWith(tmp, filePath);
}

/**
 * Writes a file and waits for the disk to have it
 *
 * fsync is the point: without it the rename can land while the contents are still in the
 * operating system's cache, which is the same half-written file one layer down.
 *
 * @param filePath
 * @param text
 * @private
 */
function writeThrough(filePath: string, text: string): void {
  const fd = openSync(filePath, 'w');
  try {
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Moves the finished file over the one it replaces
 *
 * @param tmp
 * @param filePath
 * @private
 */
function replaceWith(tmp: string, filePath: string): void {
  try {
    renameSync(tmp, filePath);
  } catch {
    // Windows refuses the rename while something else holds the target open -- a virus
    // scanner reading what was just written is the usual one. Taking the target away first
    // is the second attempt, and a failure after that belongs to the caller, exactly as a
    // failed write always did.
    unlinkSync(filePath);
    renameSync(tmp, filePath);
  }
}
