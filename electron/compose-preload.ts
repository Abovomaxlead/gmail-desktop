// The preload of a compose window, and nothing more. Deliberately not the mail view's
// preload: that one counts unread mail, intercepts Gmail's notifications and rewrites
// window.open, which here would overwrite the account's counter with an empty compose
// window's page title.
//
// It only watches whether Send was pressed and reports it; closing is main's job,
// because a window should not tear itself down while its page is still busy. The
// listener is on the bubble phase, never capture — Gmail must get the click first or
// the mail is not sent. Send is matched by `[role=button][id$=":s"]` first, which is
// language-independent, then by tooltip/aria text in English and Dutch; if it is
// never found the mail still goes out and the window simply stays open.

import { IPC } from './ipc';

export const SEND_BUTTON_SELECTOR = [
  '[role="button"][id$=":s"]',
  '[data-tooltip^="Send"]',
  '[data-tooltip^="Verzenden"]',
  '[aria-label^="Send"]',
  '[aria-label^="Verzenden"]',
].join(', ');

export function isSendClick(
  target: { closest?: (selector: string) => unknown } | null | undefined,
): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest(SEND_BUTTON_SELECTOR) != null;
}

if (typeof document !== 'undefined') {
  const { ipcRenderer } = require('electron') as typeof import('electron');
  document.addEventListener('click', (e) => {
    const target = e.target as (Element & { closest?: (s: string) => Element | null }) | null;
    if (isSendClick(target)) ipcRenderer.send(IPC.COMPOSE_SENT);
  });
}
