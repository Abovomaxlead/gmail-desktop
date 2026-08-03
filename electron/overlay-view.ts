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
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
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
    // Waar de view komt. Standaard het hele venster (een modal met backdrop).
    // Een melding die Gmail bruikbaar moet laten geeft hier een eigen rechthoek:
    // een view over het hele venster vangt namelijk álle klikken op.
    private readonly boundsFor: (
      win: { width: number; height: number },
      rows: number,
    ) => Rect = (w) => ({ x: 0, y: 0, width: w.width, height: w.height }),
  ) {
    this.win.on('resize', () => this.applyBounds());
  }

  open(payload: unknown, rows = 1): void {
    if (this.win.isDestroyed()) return;
    this.pending = payload;
    this.rows = rows;
    if (!this.view) this.create();
    else this.win.contentView.addChildView(this.view); // opnieuw bovenop leggen
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

  // Stuurt een nieuwe lading naar een al open view, zonder hem opnieuw bovenop te
  // leggen. Gebruikt om een melding bij te werken terwijl hij blijft staan.
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

  // Een los bericht op een ander kanaal, zonder de openings-payload te
  // vervangen. Voor dingen die tijdens het openstaan gebeuren, zoals voortgang.
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
