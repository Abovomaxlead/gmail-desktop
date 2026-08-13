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
// silently is the one outcome the design says must not happen (spec decision 8), so every
// one of those endings is turned into a flag main can ask about, and showToast falls back
// to a system Notification while that flag is set.
//
// The watchdog behind that flag runs in two stages, because did-finish-load proves far
// less than it looks like it proves. It fires happily on a page whose preload exposed no
// bridge, on one that then throws in React, on one whose ResizeObserver never runs — and
// on a local app:// load it fires within a few dozen milliseconds, so a single timer that
// it cancels is cancelled long before any of those can be noticed. Every failure this
// watchdog exists for would have slipped straight through. So loading the document only
// re-arms the timer for the second stage, and the one signal that clears it is a real size
// report: the page rendered, reached the bridge, and measured itself. Anything short of
// that eventually reads as broken, which is the honest answer — nothing is on screen.
//
// Going broken is announced, not only recorded, because by the time it is noticed the
// stack is usually not empty: the notification that created this window was accepted a
// second earlier and is sitting in the controller, and so is every one that followed it.
// The flag alone only redirects the next notification; these are already past that fork
// and nothing would ever look at them again. So the owner is told once per transition and
// gets those out by another route. Told a turn late, deliberately — going broken can be
// discovered inside ensure(), which is inside a send() the controller is in the middle of,
// and the owner's answer is to empty that same controller. The flag is set immediately
// either way, so nothing arriving in between is lost.
//
// noteAlive is public for that reason. A size report is proof of life whoever ends up
// wanting it, and the controller drops some of them (an empty stack, a collapse that
// re-lays out instead of resizing); dropping one must not cost the window its health.
//
// Recovery is intact: did-finish-load is bound with `on` rather than `once`, so a renderer
// that crashes and reloads gets its zoom factor back, gets the queued stack pushed at it
// again, and clears the flag the moment it reports a size again.

import { BrowserWindow, screen } from 'electron';
import { containsPoint, exceedsWorkArea, toastWindowBounds, type ToastRect } from './toast-layout';
import { notifyLog } from '../notify/notify-log';
import { TOAST_WIDTH } from '../../renderer/lib/toast';


//===========================
// Constants
//===========================

/** Stage one: how long the page gets, from window creation, to load its document at all.
 * Only a load that neither finishes nor fails ever reaches this — a real load error
 * arrives on did-fail-load in milliseconds — so it is set generously. In dev the page
 * comes from the Next server, which compiles the route on the first request, and treating
 * a slow compile as a dead window would drain perfectly good toasts to the OS. */
export const TOAST_LOAD_TIMEOUT_MS = 5000;

/** Stage two: how long the page then gets, from did-finish-load, to report its first
 * size. This is the stage that catches a document that loaded and a page that does not
 * work. It covers script evaluation, React mounting, the state round trip through main and
 * a layout pass, so it is not tight either: a false positive here costs a working stack,
 * while being late only costs a few seconds before the same mail arrives as a system
 * toast. */
export const TOAST_RENDER_TIMEOUT_MS = 2500;

/** Chromium's console levels arrive as integers on this Electron. Named here so a page
 * error in the log reads as one. */
const CONSOLE_LEVELS = ['verbose', 'info', 'warning', 'error'] as const;

/** Chromium reports a load cancelled by a newer navigation as a failure. That is not a
 * broken page, and treating it as one would strand the window on a reload. */
const ERR_ABORTED = -3;

/** How many times a stack that cannot paint may be thrown away and built again before the
 * app stops trying. Spent attempts are returned the moment a rebuilt window reports a
 * size, so this bounds a run of consecutive failures rather than the session: what it is
 * here for is the page that is broken for a reason a rebuild cannot fix — a missing
 * document, a render error — where retrying per notification would mean a new window per
 * mail, forever. */
export const TOAST_REBUILD_ATTEMPTS = 3;


//===========================
// Window
//===========================

export class ToastWindow {
  private win: BrowserWindow | null = null;
  private lastSize: { width: number; height: number } | null = null;
  private destroyed = false;
  private broken = false;
  private rebuilds = 0;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly zoom: () => number,
    private readonly onReady: () => void,
    /** The stack has just stopped being able to appear. Called once per transition into
     * broken, never on the way back out, and never while destroyed — whatever is queued
     * has to leave by another route now. */
    private readonly onBroken: () => void,
  ) {}

  /**
   * Creates the window on first use
   *
   * @returns {BrowserWindow|null} null when creation failed, or once destroyed
   * @private
   */
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
      notifyLog(`[toast] building the window for ${this.url} (zoom ${this.zoom()})`);
      // Everything the page says about itself, in the file rather than in a devtools console
      // nobody has open on a window that never appears. A page that throws while mounting,
      // a bridge that is not there, a failed import — all of it arrives here, and all of it
      // was invisible before. The page is a handful of cards, so there is no volume problem.
      win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        const where = sourceId ? ` (${sourceId}:${line})` : '';
        notifyLog(`[toast] page says [${CONSOLE_LEVELS[level] ?? level}] ${message}${where}`);
      });
      win.webContents.on('render-process-gone', (_e, details) => {
        this.markBroken(`the page's process is gone (${details.reason})`);
      });
      win.webContents.on('preload-error', (_e, path, error) => {
        notifyLog(`[toast] preload ${path} failed: ${String(error)}`);
      });
      win.webContents.on('unresponsive', () => notifyLog('[toast] the page stopped responding'));
      win.webContents.on('did-start-loading', () => notifyLog(`[toast] loading ${this.url}`));
      // `on`, not `once`: a renderer that crashed and reloaded needs the zoom factor
      // applied again, and needs the queued stack pushed to it again.
      win.webContents.on('did-finish-load', () => {
        // The title is the cheapest lie-detector there is for this window. A dev server
        // serving its own 404 page loads perfectly, finishes, renders — and titles itself
        // "404: This page could not be found." That has cost two debugging sessions, and it
        // is one line to rule out.
        notifyLog(
          `[toast] document loaded: ${JSON.stringify(win.webContents.getTitle())} at ${win.webContents.getURL()}`,
        );
        this.setZoomFactor(win);
        // Stage two starts here. The document is loaded, which says nothing about whether
        // the page works, so the timer is re-armed rather than cleared and the flag is
        // left exactly as it was: only a size report may say this window is healthy.
        this.armReadyTimer(TOAST_RENDER_TIMEOUT_MS);
        this.onReady();
      });
      win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === ERR_ABORTED) return;
        this.markBroken(`page failed to load (${code} ${description}) at ${url}`);
      });
      win.on('closed', () => {
        if (this.win === win) this.win = null;
      });
      this.armReadyTimer(TOAST_LOAD_TIMEOUT_MS);
      void win.loadURL(this.url);
      this.win = win;
      return win;
    } catch (e) {
      notifyLog(`[toast] window creation failed: ${String(e)}`);
      this.win = null;
      // No window at all is as broken as a window that never paints, and main has to be
      // told either way or the notification goes nowhere.
      this.markBroken('no window to put a stack in');
      return null;
    }
  }

  /**
   * Whether the stack can be trusted to appear
   *
   * Answered for every notification, not once, because the page can come back — and since
   * rebuild() is what brings it back, this is a question about right now rather than a
   * verdict on the session.
   *
   * @returns true while nothing put on the stack would reach a screen
   */
  isBroken(): boolean {
    return this.destroyed || this.broken;
  }

  /**
   * Throws away a window that could not be made to paint
   *
   * The next send() builds a fresh one. This is the only thing that has ever fixed the
   * failure it exists for: the flag is cleared by a size report, a broken page never
   * reports one, and reloading the same window keeps whatever state stopped it painting.
   *
   * Attempts are returned in full by the first size report from a rebuilt window, in
   * noteAlive: what must be bounded is a page failing over and over, not a session that
   * once had a slow load.
   *
   * @returns false when there is nothing to be done — destroyed, or the attempts are
   *   spent — so the caller can stop asking
   */
  rebuild(): boolean {
    if (this.destroyed) return false;
    if (this.rebuilds >= TOAST_REBUILD_ATTEMPTS) {
      notifyLog(`[toast] giving up on the stack after ${this.rebuilds} rebuilds`);
      return false;
    }
    this.rebuilds += 1;
    notifyLog(`[toast] rebuilding the stack (attempt ${this.rebuilds})`);
    this.clearReadyTimer();
    const dead = this.win;
    this.win = null;
    this.lastSize = null;
    this.broken = false;
    if (dead && !dead.isDestroyed()) dead.destroy();
    return true;
  }

  /**
   * Starts a watchdog stage, replacing whatever stage was running
   *
   * @param ms how long the page gets before it counts as broken
   * @private
   */
  private armReadyTimer(ms: number): void {
    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      // Nothing to log a code for here — nothing failed, the page simply never came back
      // with a size, which from the outside is indistinguishable from a page that hung.
      this.markBroken(`page reported no size within ${ms}ms`);
    }, ms);
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /**
   * The one signal that proves the whole chain works
   *
   * The page rendered, reached the bridge and measured itself. Public because a size report
   * is proof of life even when the controller has no use for the measurement itself.
   */
  noteAlive(): void {
    this.clearReadyTimer();
    this.broken = false;
    // A stack that paints has spent no attempts: what the budget guards against is a page
    // that fails over and over, and this one just proved it does not.
    this.rebuilds = 0;
  }

  /**
   * Records that nothing put on the stack would reach a screen
   *
   * @param reason as it goes into the log
   * @private
   */
  private markBroken(reason: string): void {
    this.clearReadyTimer();
    if (this.broken) return;
    notifyLog(`[toast] ${reason}`);
    this.broken = true;
    // Next turn, not this one: this can be reached from inside a send() the controller is
    // running, and the owner answers by emptying that controller. A page that came back in
    // the meantime, or a window torn down in the meantime, has nothing to announce.
    setImmediate(() => {
      if (this.destroyed || !this.broken) return;
      try {
        this.onBroken();
      } catch (e) {
        notifyLog(`[toast] broken handler failed: ${String(e)}`);
      }
    });
  }

  private setZoomFactor(win: BrowserWindow): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    try {
      win.webContents.setZoomFactor(this.zoom());
    } catch {
    }
  }

  /**
   * Re-applies the Rene zoom factor to a window that outlives the setting being toggled
   *
   * applyReneZoom only reaches the main window and the profile views, and this window is
   * created once and kept for the session, so without this the factor stays at whatever it
   * was when the first notification arrived while toastWindowBounds goes on reading the
   * live one — a stack sized for one zoom and painted at another. Repositioning is part of
   * it: lastSize is in CSS pixels, so the bounds the new factor implies are computable
   * without waiting for the page to measure itself again, which it would not do anyway
   * since nothing about the CSS changed.
   */
  applyZoom(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.setZoomFactor(this.win);
    this.reposition();
  }

  /**
   * Sends a message to the page, building the window if it is not up yet
   *
   * @param channel
   * @param payload
   */
  send(channel: string, payload: unknown): void {
    const win = this.ensure();
    if (!win || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  /**
   * Lets the page take clicks while the pointer is over a card, and pass them through
   * otherwise
   *
   * @param on
   */
  setInteractive(on: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  /**
   * Whether the pointer is over the stack at all, asked of the system rather than the page
   *
   * The page cannot answer it: `forward: true` keeps mouse moves coming to a click-through
   * window but there is no leave to go with them, so a pointer that goes off the window
   * edge in one movement never reports anything again and the card it was last over stays
   * hovered — its close box lit, its expiry paused — until another notification arrives.
   *
   * Cheap because it is only ever asked while something is hovered, and only then.
   *
   * @returns false when there is no window, which is the honest answer
   */
  containsCursor(): boolean {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return false;
    try {
      return containsPoint(this.win.getBounds(), screen.getCursorScreenPoint());
    } catch {
      return false;
    }
  }

  /**
   * The screen the stack appears on, always the primary display
   *
   * The stack used to follow the display the app window was on, which put the notifications
   * on a second monitor as soon as the window was dragged there — and a monitor the user is
   * not looking at is the one place a notification must not go. There is exactly one screen
   * worth watching for mail, it is the same one the taskbar and every other system
   * notification uses, and it does not move when a window does.
   *
   * @returns {ToastRect}
   * @private
   */
  private workArea(): ToastRect {
    return screen.getPrimaryDisplay().workArea;
  }

  /**
   * Whether a stack of this measured height would fit the screen it is on
   *
   * @param cssHeight
   * @returns true when it would not
   */
  wouldOverflow(cssHeight: number): boolean {
    return exceedsWorkArea(this.workArea(), cssHeight, this.zoom());
  }

  /**
   * Applies the size the page measured, anchors it bottom-right, and shows the window
   *
   * @param cssWidth
   * @param cssHeight
   */
  applySize(cssWidth: number, cssHeight: number): void {
    const win = this.ensure();
    if (!win || win.isDestroyed()) return;
    // A size can only come from a page that rendered, measured itself and reached the
    // bridge, which is the whole handshake the watchdog is waiting on.
    const wasBroken = this.broken;
    this.noteAlive();
    this.lastSize = { width: cssWidth, height: cssHeight };
    const bounds = toastWindowBounds(this.workArea(), this.lastSize, this.zoom());
    win.setBounds(bounds);
    const shown = !win.isVisible();
    if (shown) win.showInactive();
    win.setAlwaysOnTop(true);
    // The last link in the chain, and until now the only one that left no trace: everything
    // else says a card was accepted, this says it is on a screen, where, and how big.
    notifyLog(
      `[toast] page measured ${cssWidth}x${cssHeight} css -> window ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}` +
        `${shown ? ' (shown)' : ' (already up)'}${wasBroken ? ' — and it is alive again' : ''}`,
    );
  }

  /**
   * Re-anchors to the current work area, for a resolution or taskbar change
   */
  reposition(): void {
    if (!this.win || this.win.isDestroyed() || !this.lastSize) return;
    this.win.setBounds(toastWindowBounds(this.workArea(), this.lastSize, this.zoom()));
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isVisible()) notifyLog('[toast] stack empty, hiding the window');
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
