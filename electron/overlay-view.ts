import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';

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

// De zoomfactor van de balk. In Rene-modus staat het venster op 200%, dus tekent
// de balk twee keer zo hoog en moet een overlay eronder ook twee keer zo laag
// beginnen — dezelfde `scale` die contentBounds voor de Gmail-view gebruikt.
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
    // Waar de view komt. Standaard het hele gebied ónder de topbar (een modal
    // met backdrop) — precies wat contentBounds voor de Gmail-view uitrekent.
    // Niet het hele venster: onze balk ís de titelbalk, dus een view daarover
    // maakt het venster onversleepbaar en de tabs onaanklikbaar zolang de modal
    // openstaat. De modal centreert zich zelf in de view die hij krijgt, dus een
    // kortere view is genoeg — er hoort geen extra marge bij.
    // Een melding die Gmail bruikbaar moet laten geeft hier een eigen rechthoek:
    // een view over het hele gebied vangt namelijk álle klikken op.
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
