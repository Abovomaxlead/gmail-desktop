// A view spanning the window on top of the Gmail view, with a transparent
// background: the Gmail view is a native layer above the sidebar page, so a modal
// drawn inside that page would sit behind it. Transparency needs both a transparent
// background colour here and a page that paints none, or Chromium covers Gmail
// completely. Bounds default to the area below the topbar rather than the whole
// window (our bar is the titlebar, and covering it makes the window undraggable),
// and follow the renderer zoom factor, which is 2 in Rene mode.
import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function barScale(win: BrowserWindow): number {
  try {
    return win.webContents.getZoomFactor();
  } catch {
    return 1;
  }
}

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

  close(): void {
    if (!this.view || this.win.isDestroyed()) return;
    this.view.setVisible(false);
    this.visible = false;
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
    }
  }

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

  private flush(): void {
    if (!this.ready || !this.view || this.pending === null) return;
    if (this.view.webContents.isDestroyed()) return;
    this.view.webContents.send(this.channel, this.pending);
    this.pending = null;
  }

  update(payload: unknown, rows = this.rows): void {
    if (!this.view || this.win.isDestroyed()) return;
    this.pending = payload;
    this.rows = rows;
    this.applyBounds();
    this.flush();
  }

  isOpen(): boolean {
    return this.visible;
  }

  send(channel: string, payload: unknown): void {
    if (!this.view || this.win.isDestroyed() || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send(channel, payload);
  }

  private applyBounds(): void {
    if (!this.view || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    this.view.setBounds(this.boundsFor({ width, height }, this.rows));
  }
}
