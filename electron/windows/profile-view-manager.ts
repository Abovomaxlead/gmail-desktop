// Owns one WebContentsView per (account, surface) and everything done to them. The map key
// is "<accountKey>:<surface>", and since an accountKey may itself contain a colon it is
// recovered by splitting on the LAST one.
//
// A preloading view is parked off-window and stays visible: an invisible view counts as
// occluded and Gmail never builds its message list, so show() and hideAll() skip warming
// views. State a page load destroys, like the audio mute, is re-sent on every load.

import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { contentBounds } from './layout';
import {
  IPC,
  type NotifyState,
  type MailDropPayload,
  type MailDropResult,
  type MailDropSaveProgress,
  type MailDropLock,
} from '../core/ipc';
import { attachExternalLinkHandling } from '../system/external-links';
import { mailSearchHash } from '../gmail/google-urls';
import { notifyLog } from '../notify/notify-log';
import { titleShowsSubject } from '../notify/notify-match';
import type { KeyInput } from '../menus/shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, surfacesForRef, type Surface } from '../../renderer/lib/surfaces';
import { accountKey, type AccountRef } from '../accounts/account-ref';

export type { Surface };


//===========================
// Types
//===========================

/** One view, named by the account and the surface it shows. */
export interface ViewId {
  accountKey: string;
  surface: Surface;
}

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

/** What the mail view reports about itself between tries: where it thinks it is, what it
 * is showing, and whether the button is there yet. */
interface PopoutProbe {
  hash: string;
  title: string;
  hasButton: boolean;
}


//===========================
// Constants
//===========================

const SESSION_PARTITION = 'persist:google';

const viewKey = (acctKey: string, surface: Surface) => `${acctKey}:${surface}`;
const acctKeyOfViewKey = (vk: string) => vk.slice(0, vk.lastIndexOf(':'));

const WARM_BOUNDS = { x: -4000, y: 0, width: 1280, height: 900 };

const POPOUT_CLICK_TRIES = 12;
const POPOUT_CLICK_INTERVAL_MS = 250;
const POPOUT_WINDOW_WAIT_MS = 2000;


//===========================
// Manager
//===========================

export class ProfileViewManager {
  private views = new Map<string, WebContentsView>();
  private activeViewKey: string | null = null;
  private notifClickUntil = new Map<string, number>();
  private warming = new Set<string>();
  private popoutExpectUntil = new Map<string, number>();
  private dropRefused = new Set<string>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountKey: string, count: number) => void,
    private readonly onActivate: (
      accountKey: string,
      surface: Surface,
      threadId?: string,
      subject?: string,
    ) => void,
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
    private readonly onViewAttached: () => void = () => {},
    private readonly mayDragToSave: (accountKey: string) => boolean | null = () => true,
  ) {
    this.win.on('resize', () => this.relayout());
  }

  /**
   * Builds the view for one account and surface, if it is not there yet
   *
   * The one funnel every caller of ensureView/show/warm passes through before a view is
   * ever built, which is why a pair outside surfacesForRef is refused here rather than
   * trusted to every caller to have checked first.
   *
   * @param ref
   * @param surface
   * @param visible
   * @param urlOverride skips the refusal, for a URL the app worked out itself
   */
  ensureView(ref: AccountRef, surface: Surface, visible: boolean, urlOverride?: string): void {
    if (this.win.isDestroyed()) return;
    const acctKey = accountKey(ref);
    const k = viewKey(acctKey, surface);
    if (this.views.has(k)) {
      if (visible) this.show(ref, surface);
      return;
    }

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
        else if (channel === IPC.MAIL_DROP_ALLOWED_GET) {
          const allowed = this.mayDragToSave(acctKey);

          if (allowed === null) return;

          if (!allowed && !this.dropRefused.has(k)) {
            this.dropRefused.add(k);
            console.log(`[maildrop] geen dropzone voor ${acctKey}: buiten het werkdomein`);
          }
          view.webContents.send(IPC.MAIL_DROP_ALLOWED, allowed);
        }
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) {
        if (args[1]) notifyLog(`[notify] ${acctKey} lookup ${JSON.stringify(args[1])}`);

        const meta = args[1] as { body?: unknown } | undefined;
        this.onActivate(
          acctKey,
          surface,
          typeof args[0] === 'string' ? args[0] : undefined,
          typeof meta?.body === 'string' ? meta.body : undefined,
        );
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

  /**
   * Brings one view to the front and hides the rest, warming views excepted
   *
   * @param ref
   * @param surface
   */
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

  /**
   * Loads a view off-window so it is ready when it is asked for
   *
   * @param ref
   * @param surface
   */
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

  /**
   * Stops warming a view, unless it is the one on screen
   *
   * @param accountKey
   * @param surface
   */
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

  /**
   * Which account a view belongs to, for an event that arrives from the page itself
   *
   * @param wc
   * @returns the account key, or null when the page is not one of ours
   */
  keyForWebContents(wc: WebContents): string | null {
    for (const [vk, view] of this.views) {
      if (view.webContents === wc) return acctKeyOfViewKey(vk);
    }
    return null;
  }

  isShowing(accountKey: string, surface: Surface): boolean {
    return this.activeViewKey === viewKey(accountKey, surface);
  }

  /**
   * Whether a view is built at all, on screen or not
   *
   * Apart from isShowing because the low-memory sweep needs to know what exists before it
   * decides what to throw away.
   *
   * @param accountKey
   * @param surface
   * @returns true when the view is live
   */
  hasView(accountKey: string, surface: Surface): boolean {
    return this.views.has(viewKey(accountKey, surface));
  }

  /**
   * Every view that exists, across all nine surfaces
   *
   * The sweep has to see all of them: an account can hold a Drive, Docs or Chat view as well
   * as its mail one, and those cost the same renderer each. A hidden scrape view is not
   * included -- withHiddenView never registers one here.
   *
   * @returns one entry per live view
   */
  liveViewIds(): ViewId[] {
    return [...this.views.keys()].map((vk) => ({
      accountKey: acctKeyOfViewKey(vk),
      surface: vk.slice(vk.lastIndexOf(':') + 1) as Surface,
    }));
  }

  /**
   * The view on screen, surface included
   *
   * activeKey() answers with the account alone, which is not enough to decide what to keep:
   * looking at one account's calendar must not spare that account's mail view.
   *
   * @returns the visible view, or null when none is
   */
  activeViewId(): ViewId | null {
    if (!this.activeViewKey) return null;
    return {
      accountKey: acctKeyOfViewKey(this.activeViewKey),
      surface: this.activeViewKey.slice(this.activeViewKey.lastIndexOf(':') + 1) as Surface,
    };
  }

  /**
   * Tears a view down
   *
   * A discarded mail view reports 0 unread, so the badge total forgets the account.
   *
   * @param accountKey
   * @param surface
   */
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

  /**
   * Opens a URL in the surface it belongs to rather than in the one that asked
   *
   * @param ref
   * @param from the surface the link was clicked in, and the fallback
   * @param url
   * @private
   */
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

  /**
   * Says a notification click is in flight, so what the page opens next is not a popup
   *
   * @param accountKey
   * @param surface
   * @param windowMs how long the click counts as in flight
   */
  markNotificationClickHandled(accountKey: string, surface: Surface, windowMs = 2500): void {
    this.notifClickUntil.set(viewKey(accountKey, surface), Date.now() + windowMs);
  }

  /**
   * Sends the mail view to one conversation
   *
   * @param accountKey
   * @param threadId
   */
  openMailThread(accountKey: string, threadId: string): void {
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) {
      notifyLog(`[notify] ${accountKey} open ${threadId}: no mail view`);
      return;
    }

    console.log(
      `[notify] ${accountKey} open ${threadId} (loading=${wc.isLoading()}, at ${wc.getURL()})`,
    );
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`);
  }

  /**
   * Sends the mail view to Gmail's search for a subject
   *
   * Where a notification click ends up when its thread could not be identified. It beats
   * the alternative, which is opening the account and looking like the click did nothing.
   *
   * @param accountKey
   * @param subject
   * @returns false when the subject is too thin to search for, so the caller can fall back
   *   to the account
   */
  openMailSearch(accountKey: string, subject: string): boolean {
    const hash = mailSearchHash(subject);
    if (!hash) return false;
    const wc = this.views.get(viewKey(accountKey, 'mail'))?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    notifyLog(`[notify] ${accountKey} no thread found, searching for the subject`);
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
    return true;
  }

  /**
   * Pops a conversation out into Gmail's own reading window
   *
   * Only Gmail can open a working pop-out, and its button exists only while the thread is
   * open — so the thread is opened, the button clicked, and the view sent back. The restore
   * waits for the pop-out window rather than the click, since Gmail works asynchronously in
   * between, and goes back regardless after POPOUT_WINDOW_WAIT_MS.
   *
   * @param accountKey
   * @param threadId
   * @param subject what the title should show once the thread is really on screen
   * @returns {Promise<boolean>} true once the button is clicked, false if it never appears
   *   — the caller then opens a thread window of its own. The view is restored either way.
   */
  async popOutThread(accountKey: string, threadId: string, subject?: string): Promise<boolean> {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const before = await this.readHash(wc);
    const titleBefore = wc.getTitle();
    // Already there means there is nothing to wait for: the conversation on screen is the
    // one that was asked for, and no navigation is going to change the title.
    const alreadyOpen = before === `#inbox/${threadId}`;
    const showsTheThread = (title: string): boolean =>
      alreadyOpen || (subject ? titleShowsSubject(title, subject) : title !== titleBefore);
    this.popoutExpectUntil.set(k, Date.now() + 6000);
    let popoutOpened = false;
    const onCreated = (): void => {
      popoutOpened = true;
    };
    wc.once('did-create-window', onCreated);
    try {
      this.openMailThread(accountKey, threadId);
      const clicked = await this.clickPopoutButton(wc, showsTheThread);
      if (clicked) await waitUntil(() => popoutOpened, POPOUT_WINDOW_WAIT_MS);
      notifyLog(`[notify] ${accountKey} pop-out clicked=${clicked} window=${popoutOpened}`);
      this.restoreHash(wc, before, threadId);
      return clicked;
    } finally {
      if (!wc.isDestroyed()) wc.removeListener('did-create-window', onCreated);
    }
  }

  /**
   * The hash the view is on
   *
   * @param wc
   * @returns {Promise<string>} '' when it has none or cannot be asked
   * @private
   */
  private async readHash(wc: WebContents): Promise<string> {
    const hash = await wc.executeJavaScript('location.hash').catch(() => '');
    return typeof hash === 'string' ? hash : '';
  }

  /**
   * Sends the mail view back to where it was before the pop-out
   *
   * A view that was already showing the thread was not disturbed and is left alone —
   * sending it "back" would take the user off the mail they had open. A view with no hash
   * at all goes to the inbox: `location.hash = ''` is not a navigation Gmail acts on.
   *
   * @param wc
   * @param before the hash the view was on
   * @param threadId
   * @private
   */
  private restoreHash(wc: WebContents, before: string, threadId: string): void {
    if (wc.isDestroyed()) return;
    if (before === `#inbox/${threadId}`) {
      notifyLog('[notify] mail view was already on that thread, left as it was');
      return;
    }
    const target = before || '#inbox';
    notifyLog(`[notify] mail view back to ${target}`);
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(target)}`).catch(() => {});
  }

  /**
   * Clicks Gmail's own pop-out button, once the right thread is on screen
   *
   * Matched by Gmail's stable jslog action id first, then by a localized aria-label, and
   * retried because the button appears only once a thread has rendered.
   *
   * Which thread is on screen is the whole difficulty: a navigation sits between opening
   * the thread and clicking, and the previous conversation's button matches this selector
   * throughout. The hash decides nothing — the app writes it itself, so it reads back as
   * the target at once, and Gmail later replaces it with its own permalink id. It is still
   * read, for the log.
   *
   * @param wc
   * @param shows reads the title — the one thing that changes only when the conversation is
   *   really on screen
   * @returns {Promise<boolean>} false when the button never appeared, and the caller opens
   *   its own window on the right thread — a plainer window on the right mail, which beats
   *   Gmail's own on the wrong one
   * @private
   */
  private async clickPopoutButton(
    wc: WebContents,
    shows: (title: string) => boolean,
  ): Promise<boolean> {
    const findButton = `(() => {
      const byLog = Array.from(document.querySelectorAll('button[jslog],[role="button"][jslog]'))
        .find((b) => /(?:^|[;\\s])170693(?:[;\\s]|$)/.test(b.getAttribute('jslog') || ''));
      const byLabel = () => Array.from(document.querySelectorAll('[aria-label]'))
        .find((b) => /nieuw venster|new window|nouvelle fen|neues fenster|nueva ventana|ventana nueva/i
          .test(b.getAttribute('aria-label') || ''));
      return byLog || byLabel() || null;
    })()`;

    const probeScript = `(() => {
      const btn = ${findButton};
      return { hash: location.hash, title: document.title || '', hasButton: !!btn };
    })()`;
    const clickScript = `(() => {
      const btn = ${findButton};
      if (!btn) return false;
      btn.click();
      return true;
    })()`;
    let last: PopoutProbe | null = null;
    for (let i = 0; i < POPOUT_CLICK_TRIES; i++) {
      const probe = (await wc
        .executeJavaScript(probeScript)
        .catch(() => null)) as PopoutProbe | null;
      last = probe;
      if (probe && probe.hasButton && shows(probe.title)) {
        const clicked = await wc.executeJavaScript(clickScript).catch(() => false);
        if (clicked) return true;
      }
      await new Promise((r) => setTimeout(r, POPOUT_CLICK_INTERVAL_MS));
    }
    notifyLog(`[notify] pop-out gave up, last seen ${JSON.stringify(last)}`);
    return false;
  }

  /**
   * Tells a page whether it may raise notifications, and mutes Gmail's chime with it
   *
   * The mute is re-sent on every load, because a page load destroys it.
   *
   * @param accountKey
   * @param surface
   * @param state
   */
  pushNotifyAllowed(accountKey: string, surface: Surface, state: NotifyState): void {
    const wc = this.views.get(viewKey(accountKey, surface))?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.NOTIFY_ALLOWED, state);
    if (surface === 'mail') wc.setAudioMuted(state.silent);
  }

  /**
   * Runs something against a page nobody sees, then throws the page away
   *
   * @param url
   * @param fn
   * @returns {Promise<T>} whatever fn answered
   */
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

  /**
   * Reloads the view the user is looking at, and only that one
   *
   * The way back from a Gmail page that has stopped responding, without disturbing the
   * other accounts.
   */
  reloadActive(): void {
    if (!this.activeViewKey) return;
    const wc = this.views.get(this.activeViewKey)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.reload();
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

  /**
   * Tells every Gmail view that mail is being pulled, or that it no longer is
   *
   * Every view and not the one that was dragged from: the pull is one module-level job, so a
   * lock that covered a single view left switching accounts as a way to start a second one.
   *
   * @param lock
   */
  sendDropLock(lock: MailDropLock): void {
    this.sendToMailViews(IPC.MAIL_DROP_LOCK, lock);
  }

  /**
   * Tells every Gmail view how far the pull has got
   *
   * @param progress conversations pulled and conversations to pull
   */
  sendDropProgress(progress: MailDropSaveProgress): void {
    this.sendToMailViews(IPC.MAIL_DROP_SAVE_PROGRESS, progress);
  }

  /**
   * Sends to the mail surface of every account, skipping the other surfaces
   *
   * @param channel
   * @param arg
   * @private
   */
  private sendToMailViews(channel: string, arg: unknown): void {
    for (const [vk, v] of this.views) {
      // The key is `${accountKey}:${surface}` and an account key may hold colons of its own,
      // so the surface is read off the end rather than by splitting the whole key.
      if (vk.slice(vk.lastIndexOf(':') + 1) !== 'mail') continue;
      if (!v.webContents.isDestroyed()) v.webContents.send(channel, arg);
    }
  }

  /**
   * Opens Gmail's own account switcher and reads what is in it
   *
   * The list lives in an ogs.google.com frame that is only built once the switcher is
   * opened, so it is toggled open, read, and toggled shut again.
   *
   * @param accountKey
   * @param scrapeJs runs inside the switcher frame
   * @returns {Promise<Array<{email: string, href: string}>>} empty when the frame never
   *   appeared
   */
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


//===========================
// Helper functions
//===========================

/**
 * Polls until something is true, or until the time is up
 *
 * @param done
 * @param timeoutMs
 * @param stepMs
 * @returns {Promise<void>} which says nothing about which of the two ended the wait
 * @private
 */
async function waitUntil(done: () => boolean, timeoutMs: number, stepMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
