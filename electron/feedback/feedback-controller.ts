// Everything impure about feedback: what the app knows about itself, the logs it has written,
// the file they are bundled into and the compose window it all ends up in. The mail is built in
// feedback-mail.ts and the file in feedback-bundle.ts, which is why there are no decisions left
// in here.
//
// The mail is sent from the mailbox the user is looking at. That question is already answered
// by which tab is open, so unlike a mailto: link this never has to ask.
//
// Both logs go along, not just the updater's: notify.log is where the app records what it did
// with every notification, every label drag and every copy, and that is the trail almost every
// report is about. Neither is sent as it was written -- log-redact.ts masks the credentials and
// the mail content first.

import { app, shell } from 'electron';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { openComposeWindow } from '../compose/mailto-controller';
import { activeTab, authIdx, idxOfKey, profiles } from '../core/runtime';
import { notifyLog } from '../notify/notify-log';
import { bundleFileName, bundleText, bundlesToDelete } from './feedback-bundle';
import { feedbackMail, type FeedbackLog } from './feedback-mail';
import { redactLog } from './log-redact';


//===========================
// Constants
//===========================

/** In the order the mail spends its budget on them: what the app itself did first, the updater's
 * chatter second. Both live in userData beside the stores that write them. */
const LOG_FILES = ['notify.log', 'update.log'];

/** Beside the logs rather than in them: a folder of its own, so the newest bundle is obvious in
 * a window that holds nothing else and pruning can never touch a log. */
const BUNDLE_DIR = 'feedback';


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
  const logFile = logs.length > 0 ? writeBundle(logs) : undefined;
  const fields = feedbackMail({
    text: input.text,
    version: app.getVersion(),
    platform: process.platform,
    osRelease: release(),
    mailboxCount: profiles.length,
    logs,
    logFile,
    includeDiagnostics: input.includeDiagnostics,
  });
  if (!fields) return false;
  // Opened before the window, so the folder is already up when the user reads the line asking
  // for the file: an instruction to attach something they have to go and find is one people skip.
  if (logFile) shell.showItemInFolder(logFile);
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

/**
 * Writes the logs to the file the mail asks to have attached
 *
 * @param logs already redacted
 * @returns {string | undefined} the path, or undefined when the file could not be written --
 *   in which case the mail is still worth sending, with the tail it carries itself
 * @private
 */
function writeBundle(logs: FeedbackLog[]): string | undefined {
  const when = new Date();
  const dir = join(app.getPath('userData'), BUNDLE_DIR);
  const path = join(dir, bundleFileName(when));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      bundleText({
        version: app.getVersion(),
        platform: process.platform,
        osRelease: release(),
        mailboxCount: profiles.length,
        logs,
        when,
      }),
      'utf8',
    );
  } catch (e) {
    notifyLog(`[feedback] kon het logbestand niet schrijven: ${(e as Error).message}`);
    return undefined;
  }
  prune(dir);
  return path;
}

/**
 * Throws away the bundles from earlier reports
 *
 * Wrapped and after the write on purpose: a folder that cannot be read is not a reason to keep
 * the user from reporting a bug.
 *
 * @param dir
 * @private
 */
function prune(dir: string): void {
  try {
    for (const name of bundlesToDelete(readdirSync(dir))) unlinkSync(join(dir, name));
  } catch {
  }
}
