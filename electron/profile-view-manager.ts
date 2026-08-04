import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import { IPC, type NotifyState, type MailDropPayload, type MailDropResult } from './ipc';
import { attachExternalLinkHandling } from './external-links';
import type { KeyInput } from './shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, type Surface } from '../renderer/lib/surfaces';
import { accountKey, type AccountRef } from './account-ref';

export type { Surface };

export interface Profile {
  // Self-describing account identity: an authuser slot or a delegated mailbox.
  // Replaces the bare integer index that used to be threaded everywhere.
  ref: AccountRef;
  kind: AccountRef['kind'];
  email: string;
  name: string;
  avatarUrl: string;
  color: string;
  order?: number;
  label?: string;
}

const SESSION_PARTITION = 'persist:google';
// View-map key: "<accountKey>:<surface>". accountKey may itself contain ':'
// (delegated keys are "d:<email>"), so split on the LAST ':' to recover it.
const viewKey = (acctKey: string, surface: Surface) => `${acctKey}:${surface}`;
const acctKeyOfViewKey = (vk: string) => vk.slice(0, vk.lastIndexOf(':'));

// Waar een view staat die aan het voorladen is. Buiten het venster in plaats van
// op setVisible(false), om dezelfde reden als bij withHiddenView: een onzichtbare
// view geldt als bedekt en Gmail bouwt zijn berichtenlijst dan niet op. Hij heeft
// ook een echt formaat nodig, anders past er geen lijst in.
const WARM_BOUNDS = { x: -4000, y: 0, width: 1280, height: 900 };

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeViewKey: string | null = null;
  // Views whose notification click the app just handled itself: Gmail's own
  // click handler fires window.open with the same thread shortly after, which
  // must be suppressed (it would open a duplicate window / force a reload).
  private notifClickUntil = new Map<string, number>();
  // Views die op dit moment buiten het venster staan voor te laden. Ze moeten
  // zichtbaar blijven om te kunnen renderen, dus show() en hideAll() mogen ze niet
  // meenemen in hun "alles behalve de actieve gaat uit".
  private warming = new Set<string>();
  // Views for which the app is actively triggering Gmail's pop-out button, so
  // the resulting pop-out window.open should be allowed through (vs Gmail's own
  // auto pop-out on a notification click, which is suppressed).
  private popoutExpectUntil = new Map<string, number>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountKey: string, count: number) => void,
    private readonly onActivate: (accountKey: string, surface: Surface, threadId?: string) => void,
    private readonly onIdentity: (
      accountKey: string,
      identity: { email: string; name: string; avatarUrl: string },
    ) => void,
    private readonly onInput: (accountKey: string, input: KeyInput) => void,
    private readonly getZoom: (accountKey: string) => number,
    // Whether this account's mail view should be audio-muted. Gmail plays its
    // own new-mail chime as in-page audio (the "Sounds for email notifications"
    // setting), independent of the OS notification and of our banner gate, so
    // the only way to silence it without touching the mailbox owner's Gmail
    // settings is to mute the view's audio output.
    private readonly getSilent: (accountKey: string) => boolean,
    private readonly getOpenMode: () => 'app' | 'window',
    // Zoom factor of the topbar renderer (2 in Rene mode) — the content view
    // must sit below the visually taller topbar.
    private readonly getUiScale: () => number = () => 1,
    // Een mail is naar de dropzone in deze view gesleept.
    private readonly onMailDrop: (accountKey: string, payload: MailDropPayload) => void = () => {},
  ) {
    this.win.on('resize', () => this.relayout());
  }

  ensureView(ref: AccountRef, surface: Surface, visible: boolean, urlOverride?: string): void {
    if (this.win.isDestroyed()) return;
    const acctKey = accountKey(ref);
    const k = viewKey(acctKey, surface);
    if (this.views.has(k)) {
      if (visible) this.show(ref, surface);
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
        backgroundThrottling: SURFACE_CONFIG[surface].backgroundThrottling,
      },
    });
    attachExternalLinkHandling(view.webContents, {
      getOpenMode: this.getOpenMode,
      openInApp: (url) => this.openInOwningSurface(ref, surface, url),
      isNotificationClickInFlight: () => Date.now() < (this.notifClickUntil.get(k) ?? 0),
      isPopoutExpected: () => Date.now() < (this.popoutExpectUntil.get(k) ?? 0),
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (surface === 'mail') {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(acctKey, Number(args[0]) || 0);
        else if (channel === IPC.ACCOUNT_IDENTITY) this.onIdentity(acctKey, args[0]);
        else if (channel === IPC.MAIL_DROP) this.onMailDrop(acctKey, args[0] as MailDropPayload);
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) {
        this.onActivate(acctKey, surface, typeof args[0] === 'string' ? args[0] : undefined);
      }
    });
    void view.webContents.loadURL(urlOverride ?? SURFACE_CONFIG[surface].url(ref));
    view.webContents.on('before-input-event', (_e, input) => this.onInput(acctKey, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(acctKey));
      // Apply the mute on every (re)load — a reload resets the audio state, and
      // this runs before Gmail can play a chime, unlike a delayed IPC push.
      if (surface === 'mail') view.webContents.setAudioMuted(this.getSilent(acctKey));
    });
    // A Google page can close itself (e.g. Gmail's full-page compose calls
    // window.close() after sending). Drop the dead view from the map so timers
    // like refreshNotifyAllowed don't crash on a destroyed webContents.
    view.webContents.once('destroyed', () => {
      if (this.views.get(k) !== view) return;
      this.views.delete(k);
      this.warming.delete(k);
      if (this.activeViewKey === k) this.activeViewKey = null;
      // On app quit the window is torn down before its views; touching
      // contentView then throws "Object has been destroyed".
      if (this.win.isDestroyed()) return;
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        // View/window already gone during teardown — nothing to detach.
      }
    });
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(k, view);
    if (visible) this.show(ref, surface);
  }

  show(ref: AccountRef, surface: Surface): void {
    if (this.win.isDestroyed()) return;
    this.ensureView(ref, surface, false);
    const k = viewKey(accountKey(ref), surface);
    const view = this.views.get(k);
    if (!view) return;
    // Wordt een view die aan het voorladen is nu de echte, dan is zijn warmloop
    // voorbij: applyBounds haalt hem hieronder terug in het venster.
    this.warming.delete(k);
    // Een warme view blijft zichtbaar, anders breekt zijn voorladen stil af. Hij
    // staat buiten het venster, dus overlapt de actieve view niet.
    for (const [vk, v] of this.views) v.setVisible(vk === k || this.warming.has(vk));
    this.activeViewKey = k;
    this.applyBounds(view);
  }

  // Laadt de view van dit account op de achtergrond in: buiten het venster
  // geparkeerd en zichtbaar, zodat Gmail zijn berichtenlijst opbouwt zonder dat de
  // gebruiker iets ziet. Zo staat een tabblad er meteen als het wordt aangeklikt.
  // De actieve view slaat hij over: die staat al echt in beeld.
  warm(ref: AccountRef, surface: Surface): void {
    if (this.win.isDestroyed()) return;
    this.ensureView(ref, surface, false);
    const k = viewKey(accountKey(ref), surface);
    const view = this.views.get(k);
    if (!view || this.activeViewKey === k) return;
    this.warming.add(k);
    view.setBounds(WARM_BOUNDS);
    view.setVisible(true);
  }

  // Einde van de warmloop: terug naar bedekt. De opgebouwde pagina blijft in het
  // geheugen staan, dus een klik toont hem direct; Chromium mag hem nu throttlen.
  cool(accountKey: string, surface: Surface): void {
    const k = viewKey(accountKey, surface);
    this.warming.delete(k);
    const view = this.views.get(k);
    if (!view || this.activeViewKey === k) return;
    view.setVisible(false);
  }

  // De paginatitel van een view, waaruit af te lezen is of het postvak staat.
  // Null als de view niet (meer) bestaat.
  titleOf(accountKey: string, surface: Surface): string | null {
    const view = this.views.get(viewKey(accountKey, surface));
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      return view.webContents.getTitle();
    } catch {
      return null;
    }
  }

  activeKey(): string | null {
    return this.activeViewKey ? acctKeyOfViewKey(this.activeViewKey) : null;
  }

  isShowing(accountKey: string, surface: Surface): boolean {
    return this.activeViewKey === viewKey(accountKey, surface);
  }

  discardView(accountKey: string, surface: Surface): void {
    const k = viewKey(accountKey, surface);
    const view = this.views.get(k);
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(k);
    this.warming.delete(k);
    if (this.activeViewKey === k) this.activeViewKey = null;
    // A torn-down mail view will never report a fresh unread count again, so its
    // last-reported number would otherwise stick in the taskbar badge total. Report
    // 0 through the same channel so the store forgets it. Only the mail surface
    // feeds unread (see ipc-message above), and a calendar-only discard must not
    // zero a still-live mail view.
    if (surface === 'mail') this.onUnread(accountKey, 0);
  }

  hideAll(): void {
    // Een view die aan het voorladen is blijft staan: hij zit buiten het venster en
    // kan het paneel waarvoor dit wijkt dus niet overlappen, terwijl onzichtbaar
    // maken zijn voorladen stil zou afbreken.
    for (const [vk, v] of this.views) if (!this.warming.has(vk)) v.setVisible(false);
  }

  showActive(): void {
    if (this.activeViewKey) {
      const view = this.views.get(this.activeViewKey);
      if (view) {
        view.setVisible(true);
        this.applyBounds(view);
      }
    }
  }

  relayout(): void {
    if (this.activeViewKey) {
      const view = this.views.get(this.activeViewKey);
      if (view) this.applyBounds(view);
    }
  }

  private applyBounds(view: WebContentsView): void {
    // The window can be torn down while a hidden view is still around; touching
    // its contentView/getContentSize then throws "Object has been destroyed".
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }, this.getUiScale()));
  }

  // An in-app popup opens in the view of the surface that owns its URL (a Docs
  // link in an email must not replace the mail view with the document); URLs no
  // surface owns (e.g. an accounts.google.com popup) load in the view that
  // opened them, as before.
  private openInOwningSurface(ref: AccountRef, from: Surface, url: string): void {
    const target = surfaceForUrl(url) ?? from;
    this.ensureView(ref, target, false);
    const wc = this.views.get(viewKey(accountKey(ref), target))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.loadURL(url);
    this.onActivate(accountKey(ref), target); // brings the window forward and shows the surface
  }

  setZoomForKey(accountKey: string, level: number): void {
    for (const surface of SURFACES) {
      const v = this.views.get(viewKey(accountKey, surface));
      if (v) v.webContents.setZoomLevel(level);
    }
  }
  getActiveZoomLevel(): number {
    if (!this.activeViewKey) return 0;
    return this.views.get(this.activeViewKey)?.webContents.getZoomLevel() ?? 0;
  }

  markNotificationClickHandled(accountKey: string, surface: Surface, windowMs = 2500): void {
    this.notifClickUntil.set(viewKey(accountKey, surface), Date.now() + windowMs);
  }

  // Opens a specific Gmail thread in the account's mail view via a hash-only
  // navigation (instant SPA route, no reload).
  openMailThread(accountKey: string, threadId: string): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  // Triggers Gmail's own "open in a new window" (pop-out) button in the mail
  // view. Only Gmail itself can open a working pop-out — the page needs the
  // opener that set up its content feed — so we click the real button and let
  // the resulting window.open through (a pop-out URL is always allowed). The
  // caller must have opened the thread first so the button exists. Matched by
  // Gmail's stable jslog action id, then a localized aria-label as a fallback.
  // Resolves true once clicked, false if the button never appears (~3s).
  async popOutThread(accountKey: string): Promise<boolean> {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    // Allow the pop-out window.open that our button click is about to produce.
    this.popoutExpectUntil.set(k, Date.now() + 6000);
    const clickScript = `(() => {
      const byLog = Array.from(document.querySelectorAll('button[jslog],[role="button"][jslog]'))
        .find((b) => /(?:^|[;\\s])170693(?:[;\\s]|$)/.test(b.getAttribute('jslog') || ''));
      const byLabel = () => Array.from(document.querySelectorAll('[aria-label]'))
        .find((b) => /nieuw venster|new window|nouvelle fen|neues fenster|nueva ventana|ventana nueva/i
          .test(b.getAttribute('aria-label') || ''));
      const btn = byLog || byLabel();
      if (btn) { btn.click(); return true; }
      return false;
    })()`;
    for (let i = 0; i < 12; i++) {
      const clicked = await wc.executeJavaScript(clickScript).catch(() => false);
      if (clicked) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  pushNotifyAllowed(accountKey: string, surface: Surface, state: NotifyState): void {
    const wc = this.views.get(viewKey(accountKey, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, state);
    // Keep the mail view's audio mute in sync with the sound toggle live, so a
    // pref change takes effect without waiting for a reload. `silent` is only
    // ever true for the mail surface (see notificationSilent).
    if (surface === 'mail') wc.setAudioMuted(state.silent);
  }

  // Laadt een url in een tijdelijke view op dezelfde sessie, laat de aanroeper
  // erin rondkijken, en ruimt hem daarna op. Gebruikt om een label uit te lezen
  // zonder de zichtbare mailview weg te navigeren.
  //
  // De view staat buiten het venster in plaats van op `setVisible(false)`: een
  // onzichtbare view geldt als bedekt, en Gmail bouwt zijn berichtenlijst dan
  // niet op. Hij heeft ook een echt formaat nodig, anders past er geen lijst in.
  async withHiddenView<T>(
    url: string,
    fn: (wc: WebContentsView['webContents']) => Promise<T>,
  ): Promise<T> {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: SESSION_PARTITION,
        contextIsolation: false,
      },
    });
    this.win.contentView.addChildView(view);
    view.setBounds({ x: -4000, y: 0, width: 1280, height: 900 });
    try {
      await view.webContents.loadURL(url);
      return await fn(view.webContents);
    } finally {
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        // Venster al afgebroken tijdens het opruimen.
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }

  // Alleen voor de ontwikkelmodus: een herbouwde preload wordt pas opgepikt bij
  // een nieuwe navigatie, dus herladen we elke view.
  reloadAll(): void {
    for (const v of this.views.values()) {
      if (!v.webContents.isDestroyed()) v.webContents.reload();
    }
  }

  toggleDevTools(): void {
    if (!this.activeViewKey) return;
    const wc = this.views.get(this.activeViewKey)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  sendDropResult(accountKey: string, result: MailDropResult): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.MAIL_DROP_RESULT, result);
  }

  // Discover delegated mailboxes by opening the account's One-Google switcher
  // and scraping its (cross-origin) ogs.google.com widget frame(s) with
  // `scrapeJs`. Operates on the account's existing mail view; the chooser opens
  // briefly and is dismissed again afterwards. Locale-independent: the avatar
  // link is found by the email in its aria-label, never UI text. Best-effort
  // (the ogs widget is Google-internal and may change); returns [] on failure.
  async scrapeSwitcher(accountKey: string, scrapeJs: string): Promise<Array<{ email: string; href: string }>> {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return [];
    // Toggle the chooser via the avatar link (aria-label carries the account
    // email — matched by shape, not localized text).
    const toggleJs = `(() => {
      var re = /@[a-z0-9.-]+\\.[a-z]{2,}/i;
      var a = Array.from(document.querySelectorAll('a[aria-label]'))
        .find(function (x) { return re.test(x.getAttribute('aria-label') || ''); });
      if (a) { a.click(); return true; }
      return false;
    })()`;
    try {
      // Open the chooser (a waffle/app-launcher ogs frame is always present, so
      // we can't gate on frame count — just click, then poll for entries).
      await wc.executeJavaScript(toggleJs).catch(() => false);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const ogsFrames = (wc.mainFrame?.framesInSubtree ?? []).filter((f) =>
          f.url.startsWith('https://ogs.google.com'),
        );
        for (const frame of ogsFrames) {
          const res = await frame.executeJavaScript(scrapeJs).catch(() => null);
          if (Array.isArray(res) && res.length > 0) return res as Array<{ email: string; href: string }>;
        }
      }
      return [];
    } finally {
      // Close the chooser again (toggle) so it doesn't linger on screen.
      await wc.executeJavaScript(toggleJs).catch(() => false);
    }
  }
}
