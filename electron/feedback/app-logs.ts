// The logs the app keeps, read and masked, for whatever is about to send them.
//
// Shared by the feedback mail somebody types and the crash report nobody types, because both
// answer the same question -- what was this app doing just before -- and neither may send a log
// as it was written. redactLog masks the credentials and the mail content first.

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedbackLog } from './feedback-mail';
import { redactLog } from './log-redact';


//===========================
// Constants
//===========================

/** In the order a reader wants them: what the app itself did first, the updater's chatter
 * second. Both live in userData beside the stores that write them. */
const LOG_FILES = ['notify.log', 'update.log'];


//===========================
// Exported functions
//===========================

/**
 * Every log the app keeps, masked and ready to send
 *
 * @param maxBytes the most of one log to keep, counted from the end -- a log is read for what
 *   happened last. Left out, the whole file rides along, which is what the mail builder's own
 *   budget then trims.
 * @returns {FeedbackLog[]} the files that had something in them, in LOG_FILES order
 */
export function redactedLogs(maxBytes?: number): FeedbackLog[] {
  const logs: FeedbackLog[] = [];
  for (const name of LOG_FILES) {
    const text = redactLog(readLog(name));
    if (text.trim() === '') continue;
    logs.push({ name, text: maxBytes === undefined ? text : tail(text, maxBytes) });
  }
  return logs;
}


//===========================
// Helper functions
//===========================

/**
 * One log file as text
 *
 * @param name
 * @returns {string} empty when there is no file, which is the case for update.log on a machine
 *   that has never seen an update. Both are capped by their own loggers, so this reads whole.
 * @private
 */
function readLog(name: string): string {
  try {
    return readFileSync(join(app.getPath('userData'), name), 'utf8');
  } catch {
    return '';
  }
}

/**
 * The end of a text, cut at a line boundary
 *
 * @param text
 * @param maxBytes
 * @returns the text when it fits, otherwise its last bytes with the part-line at the top
 *   dropped and a note in its place
 * @private
 */
function tail(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  const cut = bytes.subarray(bytes.length - maxBytes).toString('utf8');
  const at = cut.indexOf('\n');
  return `[earlier lines left out to keep the attachment small]\n${at === -1 ? cut : cut.slice(at + 1)}`;
}
