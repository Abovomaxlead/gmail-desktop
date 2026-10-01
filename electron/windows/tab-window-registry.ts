// Which window each mailbox lives in, once tabs can be dragged out of the main window.
//
// State only, so the two sides of the feature can both have it without importing each other:
// broadcast.ts asks it who to send a push to, and tab-windows.ts asks it what to move. An
// account nobody has claimed belongs to the main window, which is why the map only ever
// holds the mailboxes that were dragged out -- there is no entry to keep in step when an
// account appears, is renamed or disappears.
//
// The keys are account keys, the same `u<index>` / `d:<email>` the tab rows carry.

import type { BrowserWindow } from 'electron';
import { mainWindow } from '../core/runtime';
import type { WindowTabs } from '../../renderer/lib/window-tabs';

export type { WindowTabs };

//===========================
// Module state
//===========================

const tabWindows: BrowserWindow[] = [];

/** accountKey -> the window id that holds it. Only the mailboxes dragged out appear here. */
const hostIds = new Map<string, number>();


//===========================
// Exported functions
//===========================

export function registerTabWindow(win: BrowserWindow): void {
  if (!tabWindows.includes(win)) tabWindows.push(win);
}

export function forgetTabWindow(win: BrowserWindow): void {
  const at = tabWindows.indexOf(win);
  if (at >= 0) tabWindows.splice(at, 1);
  for (const [key, id] of [...hostIds]) if (id === win.id) hostIds.delete(key);
}

/** Every window drawing a tab strip, the main one first. */
export function shellWindows(): BrowserWindow[] {
  const live = tabWindows.filter((w) => !w.isDestroyed());
  return mainWindow && !mainWindow.isDestroyed() ? [mainWindow, ...live] : live;
}

/** The windows that were made by dragging a tab out. */
export function detachedWindows(): BrowserWindow[] {
  return tabWindows.filter((w) => !w.isDestroyed());
}

export function isTabWindow(win: BrowserWindow | null): boolean {
  return !!win && tabWindows.includes(win);
}

/**
 * The window one mailbox is shown in
 *
 * @param accountKey
 * @returns the window that claimed it, or the main window -- which is where a mailbox that
 *   was never dragged anywhere belongs
 */
export function windowForAccount(accountKey: string): BrowserWindow | null {
  const id = hostIds.get(accountKey);
  const win = id == null ? null : tabWindows.find((w) => w.id === id && !w.isDestroyed());
  return win ?? mainWindow;
}

/**
 * Says a mailbox now belongs to one window
 *
 * @param accountKey
 * @param win the window it moved to; the main window means "claimed by nobody", so the entry
 *   is dropped rather than written
 */
export function claimAccount(accountKey: string, win: BrowserWindow): void {
  if (!isTabWindow(win)) hostIds.delete(accountKey);
  else hostIds.set(accountKey, win.id);
}

/** The mailboxes one window holds, in the order they were claimed. */
export function accountsClaimedBy(win: BrowserWindow): string[] {
  return [...hostIds].filter(([, id]) => id === win.id).map(([key]) => key);
}

/** Every mailbox that was dragged out of the main window, wherever it went. */
export function claimedAccounts(): string[] {
  return [...hostIds.keys()];
}

/**
 * What one window should draw in its strip
 *
 * @param win
 */
export function tabsFor(win: BrowserWindow): WindowTabs {
  return {
    detached: isTabWindow(win),
    own: accountsClaimedBy(win),
    foreign: claimedAccounts().filter((key) => hostIds.get(key) !== win.id),
  };
}
