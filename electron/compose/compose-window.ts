// Opens Gmail's standalone compose window for account `index`, optionally prefilled
// from mailto fields. Injecting keystrokes into the main Gmail view does not work, so
// compose is triggered by loading Gmail's compose URL in a small popup on the shared
// Google session, and the window is returned so main can attach the closing
// behaviour.

import { BrowserWindow } from 'electron';
import { attachExternalLinkHandling } from '../system/external-links';
import { composeUrl } from './compose-url';
import type { MailtoFields } from '../mail/mailto';

// the shared Google session every window in the app signs in on
const SESSION_PARTITION = 'persist:google';

/**
 * Opens Gmail's standalone compose window
 *
 * @param index the account, as Gmail numbers them in /mail/u/<n>
 * @param title
 * @param fields prefill from a mailto: link
 * @returns {BrowserWindow} so main can attach the closing behaviour
 */
export function openCompose(
  index: number,
  title: string,
  fields?: MailtoFields,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    title,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
    },
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(composeUrl(index, fields));
  return win;
}

/**
 * Opens a conversation in a window of its own
 *
 * The fallback for "open in a new window" when Gmail's own pop-out button cannot be
 * triggered — that focused pop-out only renders when Gmail itself opens it.
 *
 * @param index the account, as Gmail numbers them in /mail/u/<n>
 * @param threadId
 */
export function openFullThreadWindow(index: number, threadId: string): void {
  const win = new BrowserWindow({
    width: 720,
    height: 800,
    backgroundColor: '#ffffff',
    webPreferences: { partition: SESSION_PARTITION, contextIsolation: true },
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(`https://mail.google.com/mail/u/${index}/#inbox/${threadId}`);
}
