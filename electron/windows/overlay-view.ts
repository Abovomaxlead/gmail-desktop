// A view spanning the window on top of the Gmail view, with a transparent
// background: the Gmail view is a native layer above the sidebar page, so a modal
// drawn inside that page would sit behind it. Transparency needs both a transparent
// background colour here and a page that paints none, or Chromium covers Gmail
// completely. Bounds default to the area below the topbar rather than the whole
// window (our bar is the titlebar, and covering it makes the window undraggable),
// and follow the renderer zoom factor, which is 2 in Rene mode.
//
// Being on top is not something a view keeps by itself. contentView paints its children
// in order and every addChildView appends, so any view attached after this one covers it
// — and the manager attaches one the first time each account and surface is opened, plus
// one per account during the background warm-up that runs over the first half-minute of
// a session. An overlay opened before those is buried by them while still believing it is
// open: setVisible(true), correct bounds, nothing on screen. That is how the reconnect
// banner, which opens about a second and a half after start and from then on only ever
// update()s, could be up for a whole session without once being seen. So the overlay
// re-asserts its place whenever it is opened or updated, and raise() lets the owner do
// the same after attaching a view of its own. Re-adding a view that is already a child
// moves it to the top rather than duplicating it, which is what makes this cheap enough
// to do unconditionally.
import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';



//===========================
// Types
//===========================

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}


//===========================
// Overlay
//===========================

export class OverlayView {
  private view: WebContentsView | null = null;
  private pending: unknown = null;
  private ready = false;
  private rows = 1;
  private visible = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly channel: string,
    private readonly boundsFor: (
      win: { width: number; height: number },
      rows: number,
    ) => Rect = (w) => contentBounds(w, barScale(win)),
  ) {
    this.win.on('resize', () => this.applyBounds());
  }

  /**
   * Shows the overlay, creating its view the first time
   *
   * @param payload sent to the page once it is listening
   * @param rows how many rows the bounds should account for
   */
  open(payload: unknown, rows = 1): void {
    if (this.win.isDestroyed()) return;
    this.pending = payload;
    this.rows = rows;
    if (!this.view) this.create();
    else this.win.contentView.addChildView(this.view);
    this.view!.setVisible(true);
    this.visible = true;
    this.applyBounds();
    this.flush();
  }

  /**
   * Puts the overlay back on top of whatever has been attached since
   *
   * Safe at any time: it does nothing while closed, and re-adding an existing child
   * reorders rather than duplicates.
   */
  raise(): void {
    if (!this.view || !this.visible || this.win.isDestroyed()) return;
    try {
      this.win.contentView.addChildView(this.view);
    } catch {
    }
  }

  /**
   * Hides the overlay and detaches it from the window
   */
  close(): void {
    if (!this.view || this.win.isDestroyed()) return;
    this.view.setVisible(false);
    this.visible = false;
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
    }
  }

  /**
   * Builds the view; the transparent background is what keeps Gmail visible under it
   *
   * @private
   */
  private create(): void {
    const view = new WebContentsView({
      webPreferences: { preload: this.preloadPath, contextIsolation: true },
    });
    view.setBackgroundColor('#00000000');
    view.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.flush();
    });
    void view.webContents.loadURL(this.url);
    this.win.contentView.addChildView(view);
    this.view = view;
  }

  /**
   * Sends the pending payload once the page is loaded
   *
   * @private
   */
  private flush(): void {
    if (!this.ready || !this.view || this.pending === null) return;
    if (this.view.webContents.isDestroyed()) return;
    this.view.webContents.send(this.channel, this.pending);
    this.pending = null;
  }

  /**
   * Replaces the payload of an overlay that is already open
   *
   * @param payload
   * @param rows
   */
  update(payload: unknown, rows = this.rows): void {
    if (!this.view || this.win.isDestroyed()) return;
    this.pending = payload;
    this.rows = rows;
    // An overlay that is only ever updated after its first open would otherwise never
    // get another chance to be on top, which is exactly the reconnect banner's shape.
    this.raise();
    this.applyBounds();
    this.flush();
  }

  /**
   * Whether the overlay is currently shown
   *
   * @returns true while open
   */
  isOpen(): boolean {
    return this.visible;
  }

  /**
   * Sends a message to the overlay's page on any channel
   *
   * @param channel
   * @param payload
   */
  send(channel: string, payload: unknown): void {
    if (!this.view || this.win.isDestroyed() || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send(channel, payload);
  }

  /**
   * Resizes the view to the window's current content size
   *
   * @private
   */
  private applyBounds(): void {
    if (!this.view || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    this.view.setBounds(this.boundsFor({ width, height }, this.rows));
  }
}


//===========================
// Helper functions
//===========================

/**
 * The renderer's zoom factor, which the default bounds follow
 *
 * @param win
 * @returns the factor, or 1 when the window cannot be asked
 * @private
 */
function barScale(win: BrowserWindow): number {
  try {
    return win.webContents.getZoomFactor();
  } catch {
    return 1;
  }
}
