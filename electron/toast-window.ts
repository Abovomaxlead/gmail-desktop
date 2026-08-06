// The one window the stack lives in. One window for all the cards, not one per card:
// stacking, ordering and the gap between cards are then plain CSS in a single document
// instead of five windows main has to keep in formation as they come and go.
//
// Three properties carry the whole design. `focusable: false` is the important one — a
// toast that steals focus from whatever you are typing in is worse than no toast, and
// Windows still delivers mouse input to a non-focusable window, so clicking and hovering
// keep working while the keyboard stays where it was. `transparent` with a page that
// paints no background is what lets the cards be rounded and separated; and mouse events
// are ignored by default so the transparent strips between the cards do not swallow
// clicks meant for whatever is behind them. The page turns that off while the pointer is
// actually over a card, which it can do because `forward: true` keeps mouse moves coming.
//
// The window is created once and hidden when the stack empties rather than destroyed, so
// the next card appears without a reload. Sizing follows compose-account-window.ts: the
// page measures its own card and reports it, main resizes to that and only then shows,
// which is what keeps a resize from ever being seen.

import { BrowserWindow, screen } from 'electron';
import { TOAST_WIDTH, exceedsWorkArea, toastWindowBounds, type ToastRect } from './toast-layout';

export class ToastWindow {
  private win: BrowserWindow | null = null;
  private lastSize: { width: number; height: number } | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly zoom: () => number,
    /** The window whose display the stack should appear on; null falls back to primary. */
    private readonly anchor: () => BrowserWindow | null,
    private readonly onReady: () => void,
  ) {}

  /** Creates the window on first use. Returns null when creation failed. */
  private ensure(): BrowserWindow | null {
    if (this.win && !this.win.isDestroyed()) return this.win;
    try {
      const win = new BrowserWindow({
        width: TOAST_WIDTH,
        height: 1,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        alwaysOnTop: true,
        acceptFirstMouse: true,
        show: false,
        webPreferences: { preload: this.preloadPath, contextIsolation: true },
      });
      win.setIgnoreMouseEvents(true, { forward: true });
      const applyZoom = (): void => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        try {
          win.webContents.setZoomFactor(this.zoom());
        } catch {
        }
      };
      applyZoom();
      win.webContents.once('did-finish-load', () => {
        applyZoom();
        this.onReady();
      });
      win.on('closed', () => {
        if (this.win === win) this.win = null;
      });
      void win.loadURL(this.url);
      this.win = win;
      return win;
    } catch (e) {
      console.warn('[toast] window creation failed:', e);
      this.win = null;
      return null;
    }
  }

  send(channel: string, payload: unknown): void {
    const win = this.ensure();
    if (!win || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  /** Lets the page take clicks while the pointer is over a card, and pass them through otherwise. */
  setInteractive(on: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  private workArea(): ToastRect {
    const anchor = this.anchor();
    const display =
      anchor && !anchor.isDestroyed()
        ? screen.getDisplayMatching(anchor.getBounds())
        : screen.getPrimaryDisplay();
    return display.workArea;
  }

  /** True when a stack of this measured height would not fit the screen it is on. */
  wouldOverflow(cssHeight: number): boolean {
    return exceedsWorkArea(this.workArea(), cssHeight, this.zoom());
  }

  /** Applies the size the page measured, anchors it bottom-right, and shows the window. */
  applySize(cssWidth: number, cssHeight: number): void {
    const win = this.ensure();
    if (!win || win.isDestroyed()) return;
    this.lastSize = { width: cssWidth, height: cssHeight };
    win.setBounds(toastWindowBounds(this.workArea(), this.lastSize, this.zoom()));
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true);
  }

  /** Re-anchors to the current work area, for a resolution or taskbar change. */
  reposition(): void {
    if (!this.win || this.win.isDestroyed() || !this.lastSize) return;
    this.win.setBounds(toastWindowBounds(this.workArea(), this.lastSize, this.zoom()));
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.win.setIgnoreMouseEvents(true, { forward: true });
  }

  destroy(): void {
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
