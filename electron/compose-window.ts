import { BrowserWindow } from 'electron';
import { attachExternalLinkHandling } from './external-links';
import { composeUrl } from './compose-url';
import type { MailtoFields } from './mailto';

const SESSION_PARTITION = 'persist:google';

// Opens Gmail's standalone compose window for account `index`, optionally
// prefilled from mailto fields. Keystroke injection into the main Gmail view
// does not work, so compose is triggered by loading Gmail's compose URL in a
// small popup on the shared Google session.
export function openCompose(
  index: number,
  fields?: MailtoFields,
  // Het pad naar `compose-preload.js`. Optioneel, want een mailto:-venster heeft hem
  // niet nodig: alleen als "sluit na verzenden" aan staat moet er iemand meekijken.
  // Geen preload = geen luisteraar = niets dat de pagina kan zien.
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
  // Het venster teruggeven zodat main eraan kan hangen wat hij ermee wil — nu:
  // sluiten zodra de pagina meldt dat er verzonden is.
  return win;
}

// Fallback for "open in a new window" when Gmail's own pop-out button can't be
// triggered: open the full thread in a separate window. (Gmail's focused
// pop-out only renders when Gmail itself opens it, so it can't be cold-loaded
// here.) On the shared Google session.
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
