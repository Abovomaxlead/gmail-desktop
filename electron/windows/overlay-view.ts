// A transparent view spanning the window above the Gmail view, which is a native layer over
// the sidebar page — a modal drawn inside that page would sit behind it. Transparency needs
// both a transparent colour here and a page that paints none. Bounds default to below the
// topbar, since covering our own titlebar makes the window undraggable.
//
// Being on top is not something a view keeps by itself: contentView paints its children in
// order and every addChildView appends, so anything attached later buries the overlay while
// it still believes it is open. So it re-asserts its place on open and update, and raise()
// lets the owner do the same. Re-adding an existing child reorders rather than duplicates.
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
    // Whether opening this overlay should take the keyboard with it. A panel with a search
    // box has to: a view added to the window keeps drawing without ever being focused, so its
    // autoFocus lands in a page that receives nothing and what you type goes to Gmail behind
    // it. A banner must not, for the same reason read the other way round -- it appears while
    // someone is typing, and taking the keyboard off them mid-sentence is worse than being
    // ignored.
    private readonly takesFocus = false,
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
    // On open only, never on raise(): raise is about who is on top, and pulling the keyboard
    // away from a view halfway through a sentence is exactly what it must not do.
    if (this.takesFocus) this.view!.webContents.focus();
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
      // Again here, because the first open is the one that builds this view: focusing a page
      // that has not loaded yet is asking a window that does not exist to take the keyboard,
      // and the first drop after a start would be the one drop that still typed into Gmail.
      if (this.takesFocus && this.visible) view.webContents.focus();
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
