// The drag log, trimmed to what a bug report may carry.
//
// log.jsonl beside the saved mail is the only record of what was ever dragged out of Gmail and
// copied where, and dragging is where this app does its riskiest work: hundreds of Gmail calls,
// a network share, labels created in someone else's mailbox. A crash during a drag is the crash
// most worth having a trail for, and notify.log only holds the app's own commentary on it.
//
// What stops it simply riding along whole is what mail-archive.ts puts in it: `from`, `to`,
// `cc`, `subject` and the Message-ID of every mail that ever passed through. That is mail
// metadata, and a report nobody read before it left may not carry it. So each line is rebuilt
// from the fields that describe the *event* -- when, which mailbox, which conversation, which
// file, which label, what went wrong -- and the fields that describe the *mail* are dropped.
//
// A conversation id stays: it names a thread in a mailbox we already name, tells one drag apart
// from the next, and cannot be read as anything by whoever gets the report.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedbackLog } from './feedback-mail';
import { redactLog } from './log-redact';


//===========================
// Constants
//===========================

/** The fields kept, in the order a line reads best. Everything not named here is dropped,
 * which is what makes a new field in LogRecord private until somebody adds it deliberately. */
const KEEP = ['ts', 'account', 'threadId', 'label', 'file', 'bytes', 'error', 'copy'] as const;

/** How many lines from the end ride along. A busy day is thousands of lines and the last of
 * them are the drag that was running when the app fell over. */
export const DROP_LOG_LINES = 300;

/** How much of the end of the file is read at all. This log is appended to for the life of the
 * installation and never rotated -- measured at 15 MB on one machine after a few months -- and
 * it usually lives on a network share. Reading the whole of it to keep the last three hundred
 * lines would be the most expensive thing a crash report does. One megabyte is thousands of
 * lines, so the line cap is what normally bites. */
const TAIL_BYTES = 1024 * 1024;


//===========================
// Exported functions
//===========================

/**
 * The end of the drag log, with the mail metadata taken out
 *
 * @param folder the drop folder, as mailDropFolder() answers it
 * @param maxLines how many of the last lines to keep
 * @returns {FeedbackLog | null} null when there is no log, which is every machine that has
 *   never dragged anything, and when the folder cannot be read at all -- an offline share is
 *   not worth failing a crash report over
 */
export function dropLogTail(folder: string, maxLines = DROP_LOG_LINES): FeedbackLog | null {
  let text: string;
  let fd: number | null = null;
  try {
    fd = openSync(join(folder, 'log.jsonl'), 'r');
    const size = fstatSync(fd).size;
    const want = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(want);
    readSync(fd, buffer, 0, want, size - want);
    text = buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
  // The first line of a tail read starts mid-line, so it is dropped rather than parsed: a half
  // line is exactly the unparseable case, and the note about it would be in every report.
  const whole = text.length < TAIL_BYTES ? text : text.slice(text.indexOf('\n') + 1);
  const kept = pruneDropLog(whole, maxLines);
  return kept.trim() === '' ? null : { name: 'log.jsonl', text: redactLog(kept) };
}

/**
 * Rebuilds the last lines of the drag log from the fields a report may carry
 *
 * A line that is not readable JSON is reported as such rather than passed through: older
 * versions wrote a `body` field with the whole mail text in it, and those lines are still on
 * the share -- see mail-drop-cleanup.ts. Passing an unparsed line along would be exactly the
 * way that text gets out.
 *
 * @param text the whole log
 * @param maxLines how many of the last lines to keep
 * @returns the kept lines, one JSON object each
 */
export function pruneDropLog(text: string, maxLines = DROP_LOG_LINES): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const out: string[] = [];
  for (const line of lines.slice(-maxLines)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      out.push('{"note":"[unreadable line left out]"}');
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      out.push('{"note":"[unreadable line left out]"}');
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const field of KEEP) {
      if (record[field] !== undefined) kept[field] = record[field];
    }
    out.push(JSON.stringify(kept));
  }
  return out.join('\n');
}
