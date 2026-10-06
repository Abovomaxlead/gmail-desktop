// Bringing an existing window to the front: restored if minimised, shown, then focused.
//
// A leaf module on purpose: compose/mailto-controller.ts needs this and window-chrome.ts
// already imports from mailto-controller.ts, so putting the helper in window-chrome.ts would
// close a cycle.

import type { BrowserWindow } from 'electron';

//===========================
// Exported functions
//===========================

/**
 * Restores, shows and focuses a window, doing nothing if it is already gone
 *
 * @param win the window to bring to front
 */
export function bringToFront(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
