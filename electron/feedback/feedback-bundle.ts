// The file the feedback mail cannot carry.
//
// A mail body has eight kilobytes of URL to live in, and the logs are up to three quarters of a
// megabyte. So the whole of them -- redacted, both files, headed by what the app knows about
// itself -- is written next to the mail as one text file, and the mail names it and asks for it
// to be attached. That is the only route a full log has: Gmail's compose URL cannot prefill an
// attachment, and there is no server on the other end to post one to.
//
// Pure, so what goes in the file and which old ones are thrown away are decisions a test holds.
// The writing itself is in feedback-controller.ts.
//
// English, like the rest of the diagnostics: read by whoever fixes the bug.

import type { FeedbackLog } from './feedback-mail';


//===========================
// Types
//===========================

export interface BundleInput {
  version: string;
  platform: string;
  osRelease: string;
  mailboxCount: number;
  /** Already redacted -- see log-redact.ts */
  logs: FeedbackLog[];
  when: Date;
}


//===========================
// Constants
//===========================

/** How many of these files are kept in the folder. Enough that a second report about the same
 * problem still has the first one's log beside it, few enough that the folder does not become a
 * record of everything the app ever logged. */
export const BUNDLE_KEEP = 5;

export const BUNDLE_PREFIX = 'gmail-desktop-log-';
export const BUNDLE_SUFFIX = '.txt';

const REDACTION_NOTE = [
  'Credentials and mail content are masked in this file: access and refresh tokens, client',
  'secrets, authorization codes, mail subjects and notification titles read [redacted] or',
  '[hidden]. Mailbox addresses, label names, counts and timings are as they were logged.',
].join('\n');


//===========================
// Exported functions
//===========================

/**
 * The name of the file for one report
 *
 * Stamped to the second and sortable, so the folder reads in the order the reports were made
 * and two reports a minute apart cannot land on the same name.
 *
 * @param when
 * @returns {string} the file name, no directory
 */
export function bundleFileName(when: Date): string {
  const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${BUNDLE_PREFIX}${stamp}${BUNDLE_SUFFIX}`;
}

/**
 * Everything the file holds
 *
 * @param input
 * @returns {string} the header, the note about what was masked, and every log in full
 */
export function bundleText(input: BundleInput): string {
  const parts = [
    `Gmail Desktop ${input.version}`,
    `${input.platform} ${input.osRelease}, ${input.mailboxCount} mailboxes`,
    `written ${input.when.toISOString()}`,
    '',
    REDACTION_NOTE,
  ];
  for (const log of input.logs) {
    parts.push('', `=========== ${log.name} ===========`, '', log.text.replace(/\s+$/, ''));
  }
  return `${parts.join('\n')}\n`;
}

/**
 * Which of the files in the folder are no longer worth keeping
 *
 * @param names everything in the folder, in any order
 * @param keep how many of the newest to leave alone
 * @returns {string[]} the names to delete, oldest first; nothing that is not one of ours
 */
export function bundlesToDelete(names: string[], keep: number = BUNDLE_KEEP): string[] {
  const ours = names
    .filter((name) => name.startsWith(BUNDLE_PREFIX) && name.endsWith(BUNDLE_SUFFIX))
    .sort();
  return keep <= 0 ? ours : ours.slice(0, Math.max(0, ours.length - keep));
}
