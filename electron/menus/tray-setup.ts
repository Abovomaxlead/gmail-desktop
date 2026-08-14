// The tray icon: whether there is one, what it looks like, and the menu hanging off it.
// tray-controller.ts builds the menu from a TrayState; this is where that state is gathered
// and where the icon itself is tinted.
//
// The menu is rebuilt rather than mutated on every change, because it carries live values —
// the update status, whether notifications are snoozed and until when — and Electron gives
// no way to edit one item in place. refreshTray is therefore called from everywhere those
// values move, and is cheap enough for that.

import { app } from 'electron';
import type { Tray } from 'electron';
import { ICON_PATH } from '../core/paths';
import { pushPrefs } from '../core/broadcast';
import {
  currentLocale,
  keyOf,
  lastUpdateStatus,
  mainWindow,
  prefs,
  profiles,
  setIsQuitting,
  unread,
} from '../core/runtime';
import {
  checkForUpdateFromTray,
  downloadUpdate,
  installUpdate,
} from '../updates/update-controller';
import {
  createTray,
  updateTrayMenu,
  type TrayState,
  type TrayUpdateStatus,
} from './tray-controller';
import { trayLabels } from './tray-labels';


//===========================
// Types
//===========================

/** What the tray needs from layers above it. Injected rather than imported: a click on the
 * icon may open a mailbox, and snoozing changes what the mail views are allowed to raise. */
export interface TrayHooks {
  /** Re-tells every view whether it may notify, after a snooze changed the answer. */
  refreshNotifyAllowed(): void;
  /** Bring an account to the front, as a notification click would. */
  activateAccount(accountKey: string): void;
  setAutoStart(v: boolean): void;
}


//===========================
// Module state
//===========================

let tray: Tray | null = null;

let hooks: TrayHooks = {
  refreshNotifyAllowed: () => {},
  activateAccount: () => {},
  setAutoStart: () => {},
};


//===========================
// Exported functions
//===========================

export function setTrayHooks(h: TrayHooks): void {
  hooks = h;
}

/** Adds or removes the icon to match the setting, and re-tints it when the colour changed. */
export function applyTraySetting(): void {
  const want = prefs?.getAll().appearance.tray.enabled !== false;
  if (want && !tray) {
    tray = createTray(trayImage(), getTrayState());
    return;
  }
  if (!want && tray) {
    tray.destroy();
    tray = null;
  }
  if (want && tray) tray.setImage(trayImage());
}

export function refreshTray(): void {
  if (tray) updateTrayMenu(tray, getTrayState());
}

/**
 * Turns notifications off, off until a moment, or back on
 *
 * @param minutes null for indefinitely, 0 or less to clear, otherwise how long from now
 */
export function setSnooze(minutes: number | null): void {
  if (!prefs) return;
  const n = prefs.getAll().notifications;
  if (minutes === null) prefs.setNotifications({ ...n, dnd: true, dndUntil: undefined });
  else if (minutes <= 0) prefs.setNotifications({ ...n, dnd: false, dndUntil: undefined });
  else prefs.setNotifications({ ...n, dnd: false, dndUntil: Date.now() + minutes * 60_000 });
  pushPrefs();
  hooks.refreshNotifyAllowed();
  refreshTray();
}


//===========================
// Helper functions
//===========================

/** A click on the icon. Opens the first mailbox with unread mail when that setting is on,
 * and otherwise just brings the window back. */
function openFromTrayIcon(): void {
  if (prefs?.getAll().appearance.tray.selectUnreadOnClick === true) {
    const counts = unread.snapshot();
    const target = profiles.find((p) => (counts[keyOf(p)] ?? 0) > 0);
    if (target) {
      hooks.activateAccount(keyOf(target));
      return;
    }
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function getTrayState(): TrayState {
  const p = prefs?.getAll();
  return {
    onOpen: () => mainWindow?.show(),
    onIconClick: openFromTrayIcon,
    onQuit: () => {
      setIsQuitting(true);
      app.quit();
    },
    isPackaged: app.isPackaged,
    updateStatus: lastUpdateStatus as unknown as TrayUpdateStatus,
    onCheckUpdate: checkForUpdateFromTray,
    onDownloadUpdate: downloadUpdate,
    onInstallUpdate: installUpdate,
    autoStart: p?.autoStart ?? false,
    onToggleAutoStart: (v) => hooks.setAutoStart(v),
    dnd: p?.notifications.dnd ?? false,
    dndUntil: p?.notifications.dndUntil,
    now: Date.now(),
    onSnooze: setSnooze,
    onClearSnooze: () => setSnooze(0),
    labels: trayLabels(currentLocale(), p?.reneMode === true),
  };
}

/** The icon, tinted to the chosen colour by flattening every non-transparent pixel to it.
 * "system" leaves it alone, which is the right answer wherever the OS themes it itself. */
function trayImage(): Electron.NativeImage {
  const { nativeImage } = require('electron') as typeof import('electron');
  let image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty()) return image;
  image = image.resize({ width: 32, height: 32 });
  const colour = prefs?.getAll().appearance.tray.color ?? 'system';
  if (colour === 'system') return image;
  const level = colour === 'light' ? 0xff : 0x00;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4) {
    if (bitmap[i + 3] === 0) continue;
    bitmap[i] = level;
    bitmap[i + 1] = level;
    bitmap[i + 2] = level;
  }
  return nativeImage.createFromBitmap(bitmap, { width, height });
}
