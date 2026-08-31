import { BrowserWindow, screen } from 'electron';
import { containsPoint, exceedsWorkArea, toastWindowBounds, type ToastRect } from './toast-layout';
import { notifyLog } from '../notify/notify-log';
import { TOAST_WIDTH } from '../../renderer/lib/toast';


//===========================
// Constants
//===========================

export const TOAST_LOAD_TIMEOUT_MS = 5000;

export const TOAST_RENDER_TIMEOUT_MS = 2500;

const CONSOLE_LEVELS = ['verbose', 'info', 'warning', 'error'] as const;

const ERR_ABORTED = -3;

export const TOAST_REBUILD_ATTEMPTS = 3;

/** How long without spending an attempt before the budget above is whole again.
 *
 * The bound on its own put the original bug back one layer down. Attempts are spent in a
 * single burst -- three render timeouts is eleven seconds -- and nothing ever gave them
 * back: the one signal that does is a size report, and a stack the presenter is routing
 * around is never handed a card to measure. So eleven bad seconds cost every notification
 * until the app was restarted, which is the "sometimes I get a Windows notification"
 * this exists to end.
 *
 * Measured from the last attempt actually spent, never from a refusal, or a machine that
 * gets a notification a minute would push the spell out for ever and never refill. The
 * same shape and the same cure as RECOVER_AFTER_MS in gmail/quota.ts: a budget that only
 * ever goes down turns one bad burst into a permanent verdict. A page that genuinely
 * cannot paint therefore costs three windows a minute rather than a loop, and keeps
 * notifying through the system shelf the whole time. */
export const TOAST_REBUILD_RECOVER_AFTER_MS = 60_000;


//===========================
// Window
//===========================

export class ToastWindow {
  private win: BrowserWindow | null = null;
  private lastSize: { width: number; height: number } | null = null;
  private destroyed = false;
  private broken = false;
  private rebuilds = 0;
  /** When an attempt was last spent, so a quiet spell can give the budget back. */
  private lastRebuildAt = 0;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly zoom: () => number,
    private readonly onReady: () => void,
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
      // into the file rather than a devtools console nobody has open on an invisible window
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
      win.webContents.on('did-finish-load', () => {
        notifyLog(
          `[toast] document loaded: ${JSON.stringify(win.webContents.getTitle())} at ${win.webContents.getURL()}`,
        );
        this.setZoomFactor(win);
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
      this.markBroken('no window to put a stack in');
      return null;
    }
  }

  /**
   * Whether the stack can be trusted to appear
   *
   * A question about right now rather than a verdict on the session: rebuild() can fix it.
   *
   * @returns true while nothing put on the stack would reach a screen
   */
  isBroken(): boolean {
    return this.destroyed || this.broken;
  }

  /**
   * Throws away a window that could not be made to paint
   *
   * The next send() builds a fresh one. Reloading the same window keeps whatever state
   * stopped it painting, which is why nothing short of this has ever fixed it.
   *
   * @returns false when there is nothing to be done — destroyed, or the attempts are
   *   spent — so the caller can stop asking
   */
  rebuild(): boolean {
    if (this.destroyed) return false;
    this.refillAttempts();
    if (this.rebuilds >= TOAST_REBUILD_ATTEMPTS) {
      notifyLog(`[toast] giving up on the stack after ${this.rebuilds} rebuilds`);
      return false;
    }
    this.rebuilds += 1;
    this.lastRebuildAt = Date.now();
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
   * Gives the rebuild budget back once the trouble has stopped
   *
   * Nothing to give back while none is spent, which is also what keeps a stack that came
   * back to life on its own out of the clock entirely: noteAlive zeroes the count, and this
   * then has nothing to do.
   *
   * @private
   */
  private refillAttempts(): void {
    if (this.rebuilds === 0) return;
    if (Date.now() - this.lastRebuildAt < TOAST_REBUILD_RECOVER_AFTER_MS) return;
    notifyLog(
      `[toast] no rebuild for ${TOAST_REBUILD_RECOVER_AFTER_MS / 1000}s, the stack gets its ${TOAST_REBUILD_ATTEMPTS} attempts back`,
    );
    this.rebuilds = 0;
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
   * applyReneZoom misses this window, which is kept for the session, so without this the
   * stack is sized for one zoom and painted at another. Repositioning is part of it, since
   * lastSize is in CSS pixels and the page would not re-measure — the CSS did not change.
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
   * `forward: true` brings mouse moves to a click-through window but no leave, so a
   * pointer that goes off the edge in one movement leaves its last card hovered for good.
   * Only ever asked while something is hovered.
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
   * Not the display the app window is on: a monitor the user is not looking at is the one
   * place a notification must not go, and the taskbar does not move when a window does.
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
    const wasBroken = this.broken;
    this.noteAlive();
    this.lastSize = { width: cssWidth, height: cssHeight };
    const bounds = toastWindowBounds(this.workArea(), this.lastSize, this.zoom());
    win.setBounds(bounds);
    const shown = !win.isVisible();
    if (shown) win.showInactive();
    win.setAlwaysOnTop(true);
    notifyLog(
      `[toast] page measured ${cssWidth}x${cssHeight} css -> window ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}` +
        `${shown ? ' (shown)' : ' (already up)'}${wasBroken ? ' — and it is alive again' : ''}`,
    );
  }

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
