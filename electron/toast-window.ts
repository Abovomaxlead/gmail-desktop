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
//
// That sizing handshake is also the failure mode this file has to defend against, and it
// is why isBroken() exists. Nothing here shows the window: showInactive() is only ever
// reached from applySize, which only runs once the page has measured itself and reported
// a size. So every way the page can fail to report — a missing toasts.html, a preload that
// did not expose the bridge, a render error, a throwing ResizeObserver — ends in the same
// place: a window stuck at show: false, forever, while main still believes it has a
// working stack and keeps handing it notifications. The result is not a broken toast, it
// is total silence, with no window, no system toast and no log line. Mail arriving
// silently is the one outcome the design says must not happen (spec decision 8), so a
// load failure and a missed handshake are both turned into a flag main can ask about, and
// showToast falls back to a system Notification while that flag is set. The watchdog is
// what covers the failures that are not a load error at all — did-finish-load fires
// happily on a page that then throws in React, and only the absent size report tells us.
//
// The flag clears itself if the page ever does come up, because did-finish-load is bound
// with `on` rather than `once`: a renderer that crashes and reloads gets its zoom factor
// back and its stack back with it.

import { BrowserWindow, screen } from 'electron';
import { exceedsWorkArea, toastWindowBounds, type ToastRect } from './toast-layout';
import { TOAST_WIDTH } from '../renderer/lib/toast';

/** How long the page gets, from window creation, to finish loading and report a size
 * before the window is declared broken. Generous next to a local file load, and it costs
 * nothing when the page is fine: the first of the two signals clears the timer. */
export const TOAST_READY_TIMEOUT_MS = 1000;

/** Chromium reports a load cancelled by a newer navigation as a failure. That is not a
 * broken page, and treating it as one would strand the window on a reload. */
const ERR_ABORTED = -3;

export class ToastWindow {
  private win: BrowserWindow | null = null;
  private lastSize: { width: number; height: number } | null = null;
  private destroyed = false;
  private loadFailed = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly zoom: () => number,
    /** The window whose display the stack should appear on; null falls back to primary. */
    private readonly anchor: () => BrowserWindow | null,
    private readonly onReady: () => void,
  ) {}

  /** Creates the window on first use. Returns null when creation failed, or once destroyed. */
  private ensure(): BrowserWindow | null {
    if (this.destroyed) return null;
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
      this.setZoomFactor(win);
      // `on`, not `once`: a renderer that crashed and reloaded needs the zoom factor
      // applied again, and needs the queued stack pushed to it again.
      win.webContents.on('did-finish-load', () => {
        this.setZoomFactor(win);
        this.noteAlive();
        this.onReady();
      });
      win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === ERR_ABORTED) return;
        console.warn(`[toast] page failed to load (${code} ${description}) at ${url}`);
        this.loadFailed = true;
        this.clearReadyTimer();
      });
      win.on('closed', () => {
        if (this.win === win) this.win = null;
      });
      this.armReadyTimer();
      void win.loadURL(this.url);
      this.win = win;
      return win;
    } catch (e) {
      console.warn('[toast] window creation failed:', e);
      this.win = null;
      // No window at all is as broken as a window that never paints, and main has to be
      // told either way or the notification goes nowhere.
      this.loadFailed = true;
      return null;
    }
  }

  /** True while the stack cannot be trusted to appear, so main raises a system toast
   * instead. Answered for every notification, not once, because the page can come back. */
  isBroken(): boolean {
    return this.destroyed || this.loadFailed;
  }

  private armReadyTimer(): void {
    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      // Nothing to log a code for here — the load did not fail, the page simply never
      // came back with a size, which is indistinguishable from the outside.
      console.warn(`[toast] page reported nothing within ${TOAST_READY_TIMEOUT_MS}ms`);
      this.loadFailed = true;
    }, TOAST_READY_TIMEOUT_MS);
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /** Either half of the handshake proves the page is there, so either clears the flag. */
  private noteAlive(): void {
    this.clearReadyTimer();
    this.loadFailed = false;
  }

  private setZoomFactor(win: BrowserWindow): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    try {
      win.webContents.setZoomFactor(this.zoom());
    } catch {
    }
  }

  /** Re-applies the Rene zoom factor to a window that outlives the setting being toggled.
   * applyReneZoom only reaches the main window and the profile views, and this window is
   * created once and kept for the session, so without this the factor stays at whatever it
   * was when the first notification arrived while toastWindowBounds goes on reading the
   * live one — a stack sized for one zoom and painted at another. Repositioning is part of
   * it: lastSize is in CSS pixels, so the bounds the new factor implies are computable
   * without waiting for the page to measure itself again, which it would not do anyway
   * since nothing about the CSS changed. */
  applyZoom(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.setZoomFactor(this.win);
    this.reposition();
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
    // A size can only come from a page that rendered, measured itself and reached the
    // bridge, which is the whole handshake the watchdog is waiting on.
    this.noteAlive();
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
    this.destroyed = true;
    this.clearReadyTimer();
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
