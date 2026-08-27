// Opens Gmail's standalone compose window for account `index`. Injecting keystrokes into
// the main Gmail view does not work, so compose is a small popup on the shared session.

import { BrowserWindow } from 'electron';
import { attachExternalLinkHandling } from '../system/external-links';
import { anchorMessage } from '../gmail/message-anchor';
import { notifyLog } from '../notify/notify-log';
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
 * @param messageId the mail the notification named, unfolded once the conversation is drawn
 */
export function openFullThreadWindow(index: number, threadId: string, messageId?: string): void {
  const win = new BrowserWindow({
    width: 720,
    height: 800,
    backgroundColor: '#ffffff',
    webPreferences: { partition: SESSION_PARTITION, contextIsolation: true },
  });
  attachExternalLinkHandling(win.webContents);
  // Hung off the load rather than off loadURL's promise: Gmail routinely supersedes its own
  // navigation, which rejects that promise with ERR_ABORTED on a page that loaded fine.
  if (messageId) {
    win.webContents.once('did-finish-load', () => void anchorThreadWindow(win, messageId));
  }
  void win.loadURL(`https://mail.google.com/mail/u/${index}/#inbox/${threadId}`).catch(() => {});
}


//===========================
// Helper functions
//===========================

/**
 * Unfolds the notified message in a thread window of the app's own
 *
 * @param win
 * @param messageId
 * @private
 */
async function anchorThreadWindow(win: BrowserWindow, messageId: string): Promise<void> {
  const gone = (): boolean => win.isDestroyed() || win.webContents.isDestroyed();
  const seen = await anchorMessage(
    (script) => (gone() ? Promise.resolve(null) : win.webContents.executeJavaScript(script)),
    messageId,
  );
  notifyLog(`[notify] thread window message ${JSON.stringify(messageId)} on screen: ${seen}`);
}
