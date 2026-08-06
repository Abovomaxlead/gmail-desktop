// The account picker's own window. It is a window rather than a view inside the main
// window because the thing that triggers it — a mailto: in a browser, a PDF, Slack —
// always comes from another app, so focus has to be taken anyway: a WebContentsView can
// only receive keys once its host window is focused, and it is invisible altogether when
// that window is minimised or hidden to the tray, which would leave the digit shortcuts
// dead. show() followed by focus() takes real OS focus, and this window closes for real
// rather than being hidden, so its `closed` event is a sound place to settle from.
//
// Frameless and transparent because the page paints its own rounded card with a border
// and a shadow, as renderer/app/reconnect/page.tsx does. Showing before the first paint is
// what produces a white flash on a transparent window, hence show: false.
//
// The height is MEASURED, not computed. Constants over a row count cannot know about a
// subject that wraps to two lines, a long address, or the OS font metrics, so
// pickerWindowSize is only the opening guess that gets the window roughly right; the page
// reports the card's real height once it has laid out, and resizeAndShow applies it before
// the window is ever visible, so the resize cannot be seen. Only then is it shown. A
// fallback reveal is armed at ready-to-show in case that report never arrives — an
// invisible window would leave the mailto: promise hanging with nothing on screen to
// answer it.
//
// The zoom factor is set before load and multiplied into the size: applyReneZoom only
// reaches the main window and its profile views, so a brand-new window would otherwise
// render at factor 1 while the whole app around it is doubled. It is set twice on purpose
// — before load, and again once the document exists, because Chromium keys the factor to
// the loaded origin and drops one set against an empty webContents. The measured size
// arrives in CSS pixels, so it is multiplied by the factor actually in effect.
//
// This module creates and sizes the window and nothing else — main owns the promise and
// the lifecycle, and one window is created per ask and destroyed on settle, so no state
// can carry over from one question to an unrelated next one.

import { BrowserWindow, screen } from 'electron';
import { pickerWindowSize } from './compose-picker';

const SCREEN_FILL = 0.9;
const REVEAL_FALLBACK_MS = 600;

function zoomOf(win: BrowserWindow): number {
  try {
    return win.webContents.getZoomFactor() || 1;
  } catch {
    return 1;
  }
}

function reveal(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isVisible()) return;
  win.show();
  win.focus();
}

export function openComposeAccountWindow(
  parent: BrowserWindow,
  preloadPath: string,
  url: string,
  rows: number,
  zoom: number,
): BrowserWindow {
  const workArea = screen.getDisplayMatching(parent.getBounds()).workAreaSize;
  const { width, height } = pickerWindowSize(rows, zoom, workArea.height * SCREEN_FILL);

  const win = new BrowserWindow({
    width,
    height,
    parent,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true },
  });

  const applyZoom = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    try {
      win.webContents.setZoomFactor(zoom);
    } catch {
    }
  };
  applyZoom();
  win.webContents.once('did-finish-load', applyZoom);
  win.center();
  win.once('ready-to-show', () => {
    const timer = setTimeout(() => reveal(win), REVEAL_FALLBACK_MS);
    win.once('closed', () => clearTimeout(timer));
  });
  void win.loadURL(url);
  return win;
}

/** Applies the size the page measured for itself, reveals the window, reports what it used. */
export function resizeAndShowComposeAccountWindow(
  win: BrowserWindow,
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number } {
  if (win.isDestroyed()) return { width: 0, height: 0 };
  const zoom = zoomOf(win);
  const maxHeight = screen.getDisplayMatching(win.getBounds()).workAreaSize.height * SCREEN_FILL;
  const width = Math.max(1, Math.round(cssWidth * zoom));
  const height = Math.max(1, Math.min(Math.round(cssHeight * zoom), Math.round(maxHeight)));
  win.setContentSize(width, height);
  win.center();
  reveal(win);
  return { width, height };
}
