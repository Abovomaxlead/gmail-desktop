import { BrowserWindow, WebContentsView } from 'electron';

// Een view over het hele venster, bovenóp de Gmail-view, met een doorzichtige
// achtergrond. Nodig omdat de Gmail-view een native laag bóven de
// sidebar-pagina is: een modal die in díe pagina getekend wordt zit er altijd
// achter, en de view wegduwen haalt Gmail juist van het scherm.
//
// Doorzichtigheid vraagt twee dingen die allebei moeten kloppen: deze view moet
// een doorzichtige achtergrondkleur hebben, én de geladen pagina moet zelf geen
// achtergrond tekenen. Ontbreekt één van beide, dan schildert Chromium er een
// dichte laag overheen en is Gmail onzichtbaar.
export class OverlayView {
  private view: WebContentsView | null = null;
  private pending: unknown = null;
  private ready = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly url: string,
    private readonly channel: string,
  ) {
    this.win.on('resize', () => this.applyBounds());
  }

  open(payload: unknown): void {
    if (this.win.isDestroyed()) return;
    this.pending = payload;
    if (!this.view) this.create();
    else this.win.contentView.addChildView(this.view); // opnieuw bovenop leggen
    this.view!.setVisible(true);
    this.applyBounds();
    this.flush();
  }

  close(): void {
    if (!this.view || this.win.isDestroyed()) return;
    this.view.setVisible(false);
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
      // Venster al afgebroken — niets meer los te koppelen.
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

  private applyBounds(): void {
    if (!this.view || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }
}
