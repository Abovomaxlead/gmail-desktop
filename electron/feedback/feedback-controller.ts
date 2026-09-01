// Everything impure about feedback: what the app knows about itself, the logs it has written,
// and the compose window it all ends up in. The mail is built in feedback-mail.ts, which is why
// there are no decisions left in here.
//
// The mail is sent from the mailbox the user is looking at. That question is already answered
// by which tab is open, so unlike a mailto: link this never has to ask.
//
// Both logs go along, not just the updater's: notify.log is where the app records what it did
// with every notification, every label drag and every copy, and that is the trail almost every
// report is about. Neither is sent as it was written -- log-redact.ts masks the credentials and
// the mail content first.

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { openComposeWindow } from '../compose/mailto-controller';
import { activeTab, authIdx, idxOfKey, profiles } from '../core/runtime';
import { feedbackMail, type FeedbackLog } from './feedback-mail';
import { redactLog } from './log-redact';


//===========================
// Constants
//===========================

/** In the order the mail spends its budget on them: what the app itself did first, the updater's
 * chatter second. Both live in userData beside the stores that write them. */
const LOG_FILES = ['notify.log', 'update.log'];


//===========================
// Exported functions
//===========================

/**
 * Opens a compose window with the feedback mail in it
 *
 * Refuses when there is no signed-in mailbox to send from, or when the message is empty -- the
 * panel disables its button in both cases, and this is the same answer without the panel. The
 * answer is reported back because the panel clears the box on the strength of it: emptying it
 * when no window opened would throw away what someone just wrote.
 *
 * @param input the message, and whether the diagnostics may ride along
 * @returns {boolean} true when a compose window is on its way
 */
export function openFeedbackCompose(input: {
  text: string;
  includeDiagnostics: boolean;
}): boolean {
  const index = composeIndex();
  if (index === null) return false;
  const logs = input.includeDiagnostics ? redactedLogs() : [];
  const fields = feedbackMail({
    text: input.text,
    version: app.getVersion(),
    platform: process.platform,
    osRelease: release(),
    mailboxCount: profiles.length,
    logs,
    includeDiagnostics: input.includeDiagnostics,
  });
  if (!fields) return false;
  openComposeWindow(index, fields);
  return true;
}


//===========================
// Helper functions
//===========================

/**
 * Which mailbox the mail is sent from
 *
 * @returns {number | null} the authuser index of the mailbox on screen, the first signed-in one
 *   when the tab on screen is a delegated mailbox, and null when nothing is signed in
 * @private
 */
function composeIndex(): number | null {
  const tab = activeTab();
  const active = tab ? idxOfKey(tab.key) : null;
  if (active !== null) return active;
  const first = profiles.map(authIdx).find((index) => index >= 0);
  return first ?? null;
}

/**
 * Every log the app keeps, masked and ready to send
 *
 * @returns {FeedbackLog[]} the files that had something in them, in LOG_FILES order
 * @private
 */
function redactedLogs(): FeedbackLog[] {
  const logs: FeedbackLog[] = [];
  for (const name of LOG_FILES) {
    const text = redactLog(readLog(name));
    if (text.trim() !== '') logs.push({ name, text });
  }
  return logs;
}

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

