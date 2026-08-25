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
// The diagnostics stay in English whatever language the app is in: they are read by whoever
// fixes the bug, not by the person reporting it.

import type { MailtoFields } from '../mail/mailto';
import { MESSAGE_CHARS } from '../../renderer/lib/feedback';

export { MESSAGE_CHARS };


//===========================
// Types
//===========================

export interface FeedbackInput {
  /** What the user typed. Nothing but whitespace means there is no mail to send. */
  text: string;
  version: string;
  platform: string;
  osRelease: string;
  mailboxCount: number;
  /** The whole log file, or an empty string when there is none to read. */
  log: string;
  includeDiagnostics: boolean;
}


//===========================
// Constants
//===========================

export const FEEDBACK_TO = 'luca.manuel@abovomaxlead.nl';

/** Enough to show what happened last, few enough to still read in a compose window. */
export const LOG_LINES = 20;

/** A log line has no length limit and the body ends up in a URL, so the tail is capped by
 * characters as well as by lines. */
export const LOG_CHARS = 1500;

const APP_NAME = 'Gmail Desktop';
const SEPARATOR = '--- diagnostics ---';

// No count in the header: the character cut can leave fewer lines than LOG_LINES, and a header
// promising twenty where three arrive reads as a fault in the app.
const LOG_HEADER = 'update.log, most recent lines:';
const SHORTENED = '[message shortened]';

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
      ? `${shorten(message)}\n\n${diagnostics(input)}`
      : shorten(message),
  };
}


//===========================
// Helper functions
//===========================

/**
 * The block under the separator
 *
 * @param input
 * @returns {string} the summary line, and the log tail when there is one
 * @private
 */
function diagnostics(input: FeedbackInput): string {
  const system = `${platformName(input.platform)} ${input.osRelease}`.trim();
  const summary = `${APP_NAME} ${input.version} on ${system}, ${input.mailboxCount} mailboxes`;
  const tail = logTail(input.log);
  const parts = [SEPARATOR, summary];
  if (tail !== '') parts.push('', LOG_HEADER, tail);
  return parts.join('\n');
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
 * The end of the log, short enough to send
 *
 * @param log the whole file
 * @returns {string} the last lines, further cut from the front when they are long
 * @private
 */
function logTail(log: string): string {
  const lines = log.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return '';
  const tail = lines.slice(-LOG_LINES).join('\n');
  if (tail.length <= LOG_CHARS) return tail;
  // Cut on a line and not mid-word: a block that starts halfway through a sentence reads as
  // corruption. When the cut lands inside one enormous line there is no boundary to find, and
  // the raw end of it still beats nothing.
  const cut = tail.slice(-LOG_CHARS);
  const boundary = cut.indexOf('\n');
  return boundary === -1 ? cut : cut.slice(boundary + 1);
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
