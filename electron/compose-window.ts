// Opens Gmail's standalone compose window for account `index`, optionally prefilled
// from mailto fields. Injecting keystrokes into the main Gmail view does not work, so
// compose is triggered by loading Gmail's compose URL in a small popup on the shared
// Google session, and the window is returned so main can attach the closing
// behaviour.
//
// The preload path is optional: only "close after sending" needs anyone watching, and
// no preload means no listener the page can see. openThreadWindow is the fallback for
// "open in a new window" when Gmail's own pop-out button cannot be triggered — that
// focused pop-out only renders when Gmail itself opens it.

import { BrowserWindow } from 'electron';
import { attachExternalLinkHandling } from './external-links';
import { composeUrl } from './compose-url';
import type { MailtoFields } from './mailto';

const SESSION_PARTITION = 'persist:google';

export function openCompose(
  index: number,
  fields?: MailtoFields,
  preloadPath?: string,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'New message',
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      ...(preloadPath ? { preload: preloadPath } : {}),
    },
  });
  attachExternalLinkHandling(win.webContents);
  void win.loadURL(composeUrl(index, fields));
  return win;
}

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
