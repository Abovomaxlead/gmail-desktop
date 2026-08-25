// Everything impure about feedback: what the app knows about itself, the tail of the update
// log, and the compose window it all ends up in. The mail is built in feedback-mail.ts, which
// is why there are no decisions left in here.
//
// The mail is sent from the mailbox the user is looking at. That question is already answered
// by which tab is open, so unlike a mailto: link this never has to ask.

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { openComposeWindow } from '../compose/mailto-controller';
import { activeTab, authIdx, idxOfKey, profiles } from '../core/runtime';
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
  const fields = feedbackMail({
    text: input.text,
    version: app.getVersion(),
    platform: process.platform,
    osRelease: release(),
    mailboxCount: profiles.length,
    log: input.includeDiagnostics ? updateLogText() : '',
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
 * The update log as text
 *
 * @returns {string} empty when there is no file, which is the case on a machine that has never
 *   seen an update. Capped at 256 KB by the logger itself, so this reads it whole.
 * @private
 */
function updateLogText(): string {
  try {
    return readFileSync(join(app.getPath('userData'), 'update.log'), 'utf8');
  } catch {
    return '';
  }
}
