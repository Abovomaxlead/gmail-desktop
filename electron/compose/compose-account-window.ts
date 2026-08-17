// The account picker's own window. A real window rather than a view, because a mailto:
// always arrives from another app and a WebContentsView cannot take focus of its own —
// it is invisible altogether while the main window is minimised or in the tray.

import { BrowserWindow, screen } from 'electron';
import { pickerWindowSize } from './compose-picker';


//===========================
// Constants
//===========================

// the most of the work area's height the card may take
const SCREEN_FILL = 0.9;

// how long the page gets to report its height before the window is shown regardless
const REVEAL_FALLBACK_MS = 600;


//===========================
// Exported functions
//===========================

/**
 * Creates the picker window, sized to a guess and still hidden
 *
 * @param parent decides which display the window is centred on
 * @param preloadPath
 * @param url
 * @param rows one per account
 * @param zoom the Rene factor, which a brand-new window inherits from nothing
 * @returns {BrowserWindow} main owns its lifecycle from here
 */
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

/**
 * Applies the size the page measured for itself and reveals the window
 *
 * @param win
 * @param cssWidth in CSS pixels, so it is multiplied by the factor actually in effect
 * @param cssHeight in CSS pixels, clamped to what the display can hold
 * @returns the size it used, in window points
 */
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


//===========================
// Helper functions
//===========================

/**
 * The zoom factor a window is actually rendering at
 *
 * @param win
 * @returns 1 when the webContents cannot answer
 * @private
 */
function zoomOf(win: BrowserWindow): number {
  try {
    return win.webContents.getZoomFactor() || 1;
  } catch {
    return 1;
  }
}

/**
 * Shows the window and takes real OS focus, once
 *
 * @param win
 * @private
 */
function reveal(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isVisible()) return;
  win.show();
  win.focus();
}
