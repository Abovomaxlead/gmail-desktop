// Everything impure about feedback: what the app knows about itself, the logs it has written,
// and the compose window it all ends up in. The mail is built in feedback-mail.ts, which is why
// there are no decisions left in here.
//
// The mail is sent from the mailbox the user is looking at. That question is already answered
// by which tab is open, so unlike a mailto: link this never has to ask.
//
// Both logs go along, not just the updater's: notify.log is where the app records what it did
// with every notification, every label drag and every copy, and that is the trail almost every
// report is about. Reading and masking them is app-logs.ts's job, shared with the automatic
// crash report -- neither is sent as it was written.

import { app } from 'electron';
import { release } from 'node:os';
import { openComposeWindow } from '../compose/mailto-controller';
import { activeTab, authIdx, idxOfKey, profiles } from '../core/runtime';
import { redactedLogs } from './app-logs';
import { feedbackMail } from './feedback-mail';


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
