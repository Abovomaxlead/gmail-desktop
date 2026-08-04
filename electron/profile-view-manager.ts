// Owns one WebContentsView per (account, surface) and everything done to them. The map
// key is "<accountKey>:<surface>" and an accountKey may itself contain a colon
// (delegated keys are "d:<email>"), so it is recovered by splitting on the LAST one. A
// preloading view is parked off-window and stays visible: an invisible view counts as
// occluded and Gmail then never builds its message list, so show() and hideAll() must
// skip warming views. State a page load destroys — the tweak CSS the preload injected,
// the audio mute that silences Gmail's in-page chime — is re-sent on every load, so the
// manager holds the last value itself. Discarding a mail view reports 0 unread so the
// badge total forgets it; a window.open passes only when the app itself asked for it.
import { BrowserWindow, WebContentsView } from 'electron';
import { contentBounds } from './layout';
import {
  IPC,
  type GmailTweakState,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
} from './ipc';
import { attachExternalLinkHandling } from './external-links';
import type { KeyInput } from './shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, type Surface } from '../renderer/lib/surfaces';
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

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private lastGmailTweaks: GmailTweakState = { composeInNewWindow: false };
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
    private readonly onCompose: (accountKey: string) => void = () => {},
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
      if (channel === IPC.COMPOSE_REQUEST && surface === 'mail') this.onCompose?.(acctKey);
    });
    void view.webContents.loadURL(urlOverride ?? SURFACE_CONFIG[surface].url(ref));
    view.webContents.on('before-input-event', (_e, input) => this.onInput(acctKey, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(acctKey));
      if (surface === 'mail') view.webContents.setAudioMuted(this.getSilent(acctKey));
      if (surface === 'mail') view.webContents.send(IPC.GMAIL_TWEAKS, this.lastGmailTweaks);
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
    if (!wc || wc.isDestroyed()) return;
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  async popOutThread(accountKey: string): Promise<boolean> {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
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
    if (surface === 'mail') wc.setAudioMuted(state.silent);
  }

  pushGmailTweaks(state: GmailTweakState): void {
    this.lastGmailTweaks = state;
    for (const [key, view] of this.views) {
      if (!key.endsWith(':mail')) continue;
      const wc = view.webContents;
      if (!wc || wc.isDestroyed()) continue;
      wc.send(IPC.GMAIL_TWEAKS, state);
    }
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
