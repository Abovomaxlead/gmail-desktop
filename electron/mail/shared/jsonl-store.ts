// The machinery two append-only JSONL stores share: copy-journal.ts and label-job.ts each keep
// one line per transition, appended synchronously so a killed process loses only the line it
// never finished writing, and each reads its file back through the same lenient loop -- a line
// that will not parse is skipped rather than losing the rest of a file this app cannot fully
// trust. Nothing here knows what a line means; the line shape and the folding of one file's
// lines into its own record stay with the store that owns that format.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';


//===========================
// Types
//===========================


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * Appends one line to a JSONL file, creating its directory if needed
 *
 * @param path the file's full path
 * @param line
 */
export function appendJsonLine(path: string, line: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(line) + '\n', 'utf8');
}

/**
 * Parses a file's text into its individual lines
 *
 * A line that will not parse is skipped rather than losing the rest -- the file is appended to
 * synchronously and read back while it may still be mid-write, so a torn last line is expected
 * and not an error.
 *
 * @param raw the file's contents
 * @returns each line that parsed, in file order
 */
export function jsonLines(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Reads one store's file back and parses it
 *
 * @param path the file's full path
 * @param parse turns the file's text into the record, or null when there is nothing to anchor it
 * @returns the parsed record, or null when the file cannot be read
 */
export function readParsed<T>(path: string, parse: (raw: string) => T | null): T | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  return parse(raw);
}

/**
 * Parses every file under a suffix in a directory
 *
 * @param root the directory to scan
 * @param suffix the file-name suffix a store's files share
 * @param parse turns one file's text into its record, or null when the file has no header to
 *   anchor it
 * @returns each file that read and parsed, in the order the directory listed them
 */
export function parsedFilesWithSuffix<T>(
  root: string,
  suffix: string,
  parse: (raw: string) => T | null,
): T[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.endsWith(suffix));
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const name of names) {
    const parsed = readParsed(join(root, name), parse);
    if (parsed) out.push(parsed);
  }
  return out;
}


//===========================
// Helper functions
//===========================
