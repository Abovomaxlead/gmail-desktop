// Opens Gmail's standalone compose window for account `index`. Injecting keystrokes into
// the main Gmail view does not work, so compose is a small popup on the shared session.

import { BrowserWindow } from 'electron';
import { attachExternalLinkHandling } from '../system/external-links';
import { composeUrl } from './compose-url';
import type { MailtoFields } from '../mail/mailto';

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
 * The fallback for when Gmail's own pop-out button cannot be triggered.
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
