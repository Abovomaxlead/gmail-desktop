// The feedback mail, built from what the user typed plus what the app knows about itself.
//
// Pure, because this is the only part of feedback with decisions in it: what goes under the
// separator, how much of the log rides along, and when there is nothing worth sending at all.
//
// It builds a mail rather than posting to a server on purpose. The user sends it from their own
// Gmail, so they read the whole thing -- diagnostics included -- before it leaves, and nobody
// has to take our word for what was attached. That is worth more than the round trip a POST to
// a server would have saved.
//
// What that costs is a hard ceiling: the body travels to Gmail inside a URL, and Google answers
// a URL past eight kilobytes with a 400 rather than a compose window. So the whole log cannot
// go in the mail however much we want it to -- it goes in a file beside it, and what fits here
// is the tail that makes the mail readable on its own.
//
// The diagnostics stay in English whatever language the app is in: they are read by whoever
// fixes the bug, not by the person reporting it.

import type { MailtoFields } from '../mail/mailto';
import { MESSAGE_CHARS } from '../../renderer/lib/feedback';

export { MESSAGE_CHARS };


//===========================
// Types
//===========================

/** One log file, already redacted -- see log-redact.ts. This module never sees a raw log. */
export interface FeedbackLog {
  /** The file's own name, which is the header it gets in the mail */
  name: string;
  text: string;
}

export interface FeedbackInput {
  /** What the user typed. Nothing but whitespace means there is no mail to send. */
  text: string;
  version: string;
  platform: string;
  osRelease: string;
  mailboxCount: number;
  /** Every log worth sending, most interesting first: they are served in this order and the
   * budget runs out from the back. */
  logs: FeedbackLog[];
  /** Where the full logs were written, named in the mail so the user can attach it. Absent
   * when writing the file failed, which is when the tail in the mail is all there is. */
  logFile?: string;
  includeDiagnostics: boolean;
}


//===========================
// Constants
//===========================

export const FEEDBACK_TO = 'luca.manuel@abovomaxlead.nl';

/** Google's ceiling, measured against the compose URL on 2026-09-01: 8,157 bytes still answered
 * 302 and 8,357 answered 400. A body that overruns it does not arrive shortened -- the compose
 * window opens on a Google error page and the whole report is lost -- so everything below is
 * budgeted against this rather than against a character count. */
export const URL_MAX = 8192;

/** The URL around the body: base, authuser, recipient and subject, with room for a version
 * string that grows. Measured at just over 200; the rest is headroom, because being wrong in
 * this direction costs the user their bug report. */
const URL_OVERHEAD = 600;

/** How much percent-encoded body there is room for. Everything is measured encoded: a newline
 * and a space cost three characters each in a URL, and a log is mostly those. */
export const BODY_BUDGET = URL_MAX - URL_OVERHEAD;

/** A bound on the tail so a single enormous log cannot fill the mail with one file's lines. The
 * byte budget is what normally bites first; this is here for the pathological case. */
export const LOG_LINES = 200;

const APP_NAME = 'Gmail Desktop';
const SEPARATOR = '--- diagnostics ---';

// No count in the header: the budget can leave fewer lines than LOG_LINES, and a header
// promising two hundred where three arrive reads as a fault in the app.
const LOG_HEADER = (name: string): string => `${name}, most recent lines:`;
const SHORTENED = '[message shortened]';
const TRUNCATED = '[earlier lines are in the attached file]';

const ATTACH_NOTE = [
  'The full logs do not fit in a mail body -- Gmail refuses a URL this long -- so they were',
  'written to the file below and its folder was opened. Attach it to this mail before sending.',
  'Credentials and mail content are already masked in it; everything else is as it was logged.',
].join('\n');

const PLATFORM_NAMES: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};


//===========================
// Exported functions
//===========================

/**
 * Builds the mail the feedback panel opens a compose window for
 *
 * @param input what the user typed and what the app knows
 * @returns {MailtoFields | null} null when the message is empty, so an accidental click on an
 *   untouched panel opens nothing
 */
export function feedbackMail(input: FeedbackInput): MailtoFields | null {
  const message = input.text.trim();
  if (message === '') return null;
  return {
    to: FEEDBACK_TO,
    cc: '',
    bcc: '',
    subject: `Feedback ${APP_NAME} ${input.version}`,
    body: input.includeDiagnostics
      ? withDiagnostics(input, message)
      : fit(shorten(message), BODY_BUDGET),
  };
}

/**
 * How long a body is once it is in a URL
 *
 * @param body
 * @returns {number} the percent-encoded length, which is what the budget is spent in
 */
export function encodedLength(body: string): number {
  return encodeURIComponent(body).length;
}


//===========================
// Helper functions
//===========================

/**
 * The message with the diagnostics block under it, inside the budget
 *
 * Spent in order of what a reader cannot do without: the summary line, then the user's own
 * words, then the note naming the attached file, and the log tail gets what is left. The tail is
 * the one part that is also somewhere else, which is why it is the part that gives way.
 *
 * @param input
 * @param message already trimmed
 * @returns {string} the whole body
 * @private
 */
function withDiagnostics(input: FeedbackInput, message: string): string {
  const system = `${platformName(input.platform)} ${input.osRelease}`.trim();
  const summary = `${APP_NAME} ${input.version} on ${system}, ${input.mailboxCount} mailboxes`;
  const note = input.logFile ? `${ATTACH_NOTE}\n${input.logFile}` : '';

  const head = [SEPARATOR, summary];
  if (note !== '') head.push('', note);
  const fixed = `\n\n${head.join('\n')}`;

  const body = fit(shorten(message), BODY_BUDGET - encodedLength(fixed)) + fixed;
  const tail = logBlocks(input.logs, BODY_BUDGET - encodedLength(body));
  return tail === '' ? body : `${body}\n\n${tail}`;
}

/**
 * The end of every log, as much of it as the budget allows
 *
 * Each file gets an even share of what is left when its turn comes, so a long first log cannot
 * crowd out the second, and a short one hands its remainder on.
 *
 * @param logs most interesting first
 * @param budget encoded characters still unspent
 * @returns {string} the blocks, headers and all, or an empty string when nothing fits
 * @private
 */
function logBlocks(logs: FeedbackLog[], budget: number): string {
  const blocks: string[] = [];
  let left = budget;
  logs.forEach((log, at) => {
    const share = Math.floor(left / (logs.length - at));
    const block = logBlock(log, share);
    if (block === '') return;
    blocks.push(block);
    left -= encodedLength(`${block}\n\n`);
  });
  return blocks.join('\n\n');
}

/**
 * One log's header and the last of its lines that fit
 *
 * @param log
 * @param budget encoded characters this file may spend, header included
 * @returns {string} the block, or an empty string when the log is empty or nothing fits
 * @private
 */
function logBlock(log: FeedbackLog, budget: number): string {
  const lines = log.text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return '';
  const header = LOG_HEADER(log.name);
  let left = budget - encodedLength(`${header}\n`);
  if (left <= 0) return '';

  // From the newest line backwards: the last thing that happened is the thing being reported.
  const kept: string[] = [];
  const candidates = lines.slice(-LOG_LINES);
  for (let at = candidates.length - 1; at >= 0; at -= 1) {
    const cost = encodedLength(`${candidates[at]}\n`);
    if (cost > left) break;
    kept.unshift(candidates[at]);
    left -= cost;
  }
  if (kept.length === 0) return '';
  // Said rather than left to be guessed, and for either cut -- the budget or the line cap: a
  // tail that starts mid-session looks like the app logged nothing before it.
  if (kept.length < lines.length && encodedLength(`${TRUNCATED}\n`) <= left) {
    kept.unshift(TRUNCATED);
  }
  return [header, ...kept].join('\n');
}

/**
 * The message, cut when it is longer than a mail wants to carry
 *
 * @param message already trimmed
 * @returns {string} the message, or its first characters with a line saying it was cut
 * @private
 */
function shorten(message: string): string {
  if (message.length <= MESSAGE_CHARS) return message;
  return `${message.slice(0, MESSAGE_CHARS)}\n${SHORTENED}`;
}

/**
 * Text cut down to what fits in a URL
 *
 * The character cap above is not the same limit: a message of four thousand accented characters
 * or newlines encodes to three times that, and it is the encoded length Google counts. Without
 * this a long enough report opened an error page instead of a compose window.
 *
 * @param text
 * @param budget encoded characters allowed
 * @returns {string} the text, or its front with a line saying it was cut
 * @private
 */
function fit(text: string, budget: number): string {
  if (encodedLength(text) <= budget) return text;
  const marker = `\n${SHORTENED}`;
  const room = Math.max(0, budget - encodedLength(marker));
  // Halving rather than counting up: encoded length is not proportional to characters, so the
  // cut is found by trying, and a log of a few thousand characters is a handful of tries.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodedLength(text.slice(0, mid)) <= room) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}${marker}`;
}

/**
 * The platform as a person writes it
 *
 * @param platform node's spelling
 * @returns {string} the everyday name, or node's spelling when it is one we do not know
 * @private
 */
function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}
