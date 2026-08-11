// Owns one WebContentsView per (account, surface) and everything done to them. The map
// key is "<accountKey>:<surface>" and an accountKey may itself contain a colon
// (delegated keys are "d:<email>"), so it is recovered by splitting on the LAST one. A
// preloading view is parked off-window and stays visible: an invisible view counts as
// occluded and Gmail then never builds its message list, so show() and hideAll() must
// skip warming views. State a page load destroys — the audio mute that silences Gmail's
// in-page chime — is re-sent on every load, so the manager holds the last value itself.
// Discarding a mail view reports 0 unread so the badge total forgets it; a window.open
// passes only when the app itself asked for it.
import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { contentBounds } from './layout';
import {
  IPC,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
} from './ipc';
import { attachExternalLinkHandling } from './external-links';
import type { KeyInput } from './shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, surfacesForRef, type Surface } from '../renderer/lib/surfaces';
import { accountKey, type AccountRef } from './account-ref';

export type { Surface };

export interface Profile {
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
const viewKey = (acctKey: string, surface: Surface) => `${acctKey}:${surface}`;
const acctKeyOfViewKey = (vk: string) => vk.slice(0, vk.lastIndexOf(':'));

const WARM_BOUNDS = { x: -4000, y: 0, width: 1280, height: 900 };

// How long the pop-out dance may take: the button has ~3s to render, and the window it
// opens ~2s to actually appear before the mail view is sent back without it.
const POPOUT_CLICK_TRIES = 12;
const POPOUT_CLICK_INTERVAL_MS = 250;
const POPOUT_WINDOW_WAIT_MS = 2000;

/** Polls `done` until it is true or `timeoutMs` has passed; says nothing about which. */
async function waitUntil(done: () => boolean, timeoutMs: number, stepMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeViewKey: string | null = null;
  private notifClickUntil = new Map<string, number>();
  private warming = new Set<string>();
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
    private readonly getSilent: (accountKey: string) => boolean,
    private readonly getOpenMode: () => 'app' | 'window',
    private readonly getUiScale: () => number = () => 1,
    private readonly onMailDrop: (accountKey: string, payload: MailDropPayload) => void = () => {},
    /** A view has just been attached, and contentView paints its children in order, so
     * anything that has to stay above the Gmail layer has just been covered by it. Fired
     * for the warm-up and the hidden scratch view too: both attach a real child and both
     * bury an open overlay exactly as thoroughly as a visible one does. */
    private readonly onViewAttached: () => void = () => {},
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
    // The one funnel every caller of ensureView/show/warm passes through before a view is
    // ever built: a (ref, surface) pair outside surfacesForRef has no URL to load —
    // SURFACE_CONFIG[surface].url(ref) below would throw — so it is refused here, once,
    // rather than trusted to every caller (a sidebar click, a keyboard shortcut, the
    // fallback after removing an account) to have checked first.
    if (!urlOverride && !surfacesForRef(ref).includes(surface)) {
      console.warn(`[view] refusing to open ${surface} for ${acctKey}: no url captured yet`);
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
        // Diagnostic, sent by the WEB_NOTIFY_CLICK handler in preload.ts and logged here
        // because a console line inside a Gmail view is somewhere nobody is looking. It
        // records how the thread id beside it was arrived at — the one thing a click that
        // opens the wrong conversation otherwise leaves no trace of.
        if (args[1]) console.log(`[notify] ${acctKey} lookup`, args[1]);
        this.onActivate(acctKey, surface, typeof args[0] === 'string' ? args[0] : undefined);
      }
    });
    void view.webContents.loadURL(urlOverride ?? SURFACE_CONFIG[surface].url(ref));
    view.webContents.on('before-input-event', (_e, input) => this.onInput(acctKey, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(acctKey));
      if (surface === 'mail') view.webContents.setAudioMuted(this.getSilent(acctKey));
    });
    view.webContents.once('destroyed', () => {
      if (this.views.get(k) !== view) return;
      this.views.delete(k);
      this.warming.delete(k);
      if (this.activeViewKey === k) this.activeViewKey = null;
      if (this.win.isDestroyed()) return;
      try {
        this.win.contentView.removeChildView(view);
      } catch {
      }
    });
    this.win.contentView.addChildView(view);
    this.onViewAttached();
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
    this.warming.delete(k);
    for (const [vk, v] of this.views) v.setVisible(vk === k || this.warming.has(vk));
    this.activeViewKey = k;
    this.applyBounds(view);
  }

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

  cool(accountKey: string, surface: Surface): void {
    const k = viewKey(accountKey, surface);
    this.warming.delete(k);
    const view = this.views.get(k);
    if (!view || this.activeViewKey === k) return;
    view.setVisible(false);
  }

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

  /** Which account a view belongs to, for an event that arrives from the page itself. */
  keyForWebContents(wc: WebContents): string | null {
    for (const [vk, view] of this.views) {
      if (view.webContents === wc) return acctKeyOfViewKey(vk);
    }
    return null;
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
    if (surface === 'mail') this.onUnread(accountKey, 0);
  }

  hideAll(): void {
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
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    view.setBounds(contentBounds({ width, height }, this.getUiScale()));
  }

  private openInOwningSurface(ref: AccountRef, from: Surface, url: string): void {
    const target = surfaceForUrl(url) ?? from;
    this.ensureView(ref, target, false);
    const wc = this.views.get(viewKey(accountKey(ref), target))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    void wc.loadURL(url);
    this.onActivate(accountKey(ref), target);
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

  openMailThread(accountKey: string, threadId: string): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) {
      // Silent until now, and it is one of the ways a notification opens nothing: the view
      // for this mailbox has not been built yet, or was torn down.
      console.log(`[notify] ${accountKey} open ${threadId}: no mail view`);
      return;
    }
    // What the hash is set on matters as much as what it is set to. A view still loading
    // navigates to its own URL afterwards and takes the hash with it, and a hash that is
    // already the target fires no hashchange at all — both end with the notified mail not
    // on screen, and neither can be told from the outside.
    console.log(
      `[notify] ${accountKey} open ${threadId} (loading=${wc.isLoading()}, at ${wc.getURL()})`,
    );
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  /**
   * Pops `threadId` out into Gmail's own reading window and leaves the mail view where it
   * was. The detour through that view is unavoidable: only Gmail can open a working
   * pop-out, and the button that does it only exists while the thread is open. So the
   * thread is opened here, the button is clicked, and the view is sent back — without
   * that last step "open in a new window" also leaves the message sitting in the main
   * window, which is the one thing it promises not to do.
   *
   * The restore waits for the pop-out window to exist rather than for the click to
   * return, because Gmail does asynchronous work in between and a view already on its way
   * back opens nothing. It is a race with a deadline, not a guarantee: after
   * POPOUT_WINDOW_WAIT_MS the view goes back regardless, since a main window left on the
   * message is the bug being fixed.
   *
   * Resolves true once the button is clicked, false if it never appears — the caller then
   * opens a thread window of its own. The view is restored either way.
   */
  async popOutThread(accountKey: string, threadId: string): Promise<boolean> {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const before = await this.readHash(wc);
    this.popoutExpectUntil.set(k, Date.now() + 6000);
    let popoutOpened = false;
    const onCreated = (): void => {
      popoutOpened = true;
    };
    wc.once('did-create-window', onCreated);
    try {
      this.openMailThread(accountKey, threadId);
      const clicked = await this.clickPopoutButton(wc);
      if (clicked) await waitUntil(() => popoutOpened, POPOUT_WINDOW_WAIT_MS);
      console.log(`[notify] ${accountKey} pop-out clicked=${clicked} window=${popoutOpened}`);
      this.restoreHash(wc, before, threadId);
      return clicked;
    } finally {
      if (!wc.isDestroyed()) wc.removeListener('did-create-window', onCreated);
    }
  }

  /** The hash the view is on, or '' when it has none or cannot be asked. */
  private async readHash(wc: WebContents): Promise<string> {
    const hash = await wc.executeJavaScript('location.hash').catch(() => '');
    return typeof hash === 'string' ? hash : '';
  }

  // A view that was already showing the thread was not disturbed and is left alone —
  // sending it "back" would take the user off the mail they had open. A view with no hash
  // at all goes to the inbox: `location.hash = ''` is not a navigation Gmail acts on.
  private restoreHash(wc: WebContents, before: string, threadId: string): void {
    if (wc.isDestroyed()) return;
    if (before === `#inbox/${threadId}`) {
      console.log('[notify] mail view was already on that thread, left as it was');
      return;
    }
    const target = before || '#inbox';
    console.log(`[notify] mail view back to ${target}`);
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(target)}`).catch(() => {});
  }

  // Matched by Gmail's stable jslog action id first, then by a localized aria-label. The
  // button only appears once the thread has rendered, so this retries rather than asking
  // once.
  private async clickPopoutButton(wc: WebContents): Promise<boolean> {
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
    for (let i = 0; i < POPOUT_CLICK_TRIES; i++) {
      const clicked = await wc.executeJavaScript(clickScript).catch(() => false);
      if (clicked) return true;
      await new Promise((r) => setTimeout(r, POPOUT_CLICK_INTERVAL_MS));
    }
    return false;
  }

  pushNotifyAllowed(accountKey: string, surface: Surface, state: NotifyState): void {
    const wc = this.views.get(viewKey(accountKey, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, state);
    if (surface === 'mail') wc.setAudioMuted(state.silent);
  }

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
    this.onViewAttached();
    view.setBounds({ x: -4000, y: 0, width: 1280, height: 900 });
    try {
      await view.webContents.loadURL(url);
      return await fn(view.webContents);
    } finally {
      try {
        this.win.contentView.removeChildView(view);
      } catch {
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }

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

  async scrapeSwitcher(accountKey: string, scrapeJs: string): Promise<Array<{ email: string; href: string }>> {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return [];
    const toggleJs = `(() => {
      var re = /@[a-z0-9.-]+\\.[a-z]{2,}/i;
      var a = Array.from(document.querySelectorAll('a[aria-label]'))
        .find(function (x) { return re.test(x.getAttribute('aria-label') || ''); });
      if (a) { a.click(); return true; }
      return false;
    })()`;
    try {
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
      await wc.executeJavaScript(toggleJs).catch(() => false);
    }
  }
}
