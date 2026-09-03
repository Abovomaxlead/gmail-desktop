// Owns one WebContentsView per (account, surface) and everything done to them. The map key
// is "<accountKey>:<surface>", and since an accountKey may itself contain a colon it is
// recovered by splitting on the LAST one.
//
// A preloading view is parked off-window and stays visible: an invisible view counts as
// occluded and Gmail never builds its message list, so show() and hideAll() skip warming
// views. State a page load destroys, like the audio mute, is re-sent on every load.

import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { contentBounds } from './layout';
import { viewLeftItsHome } from './view-home';
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
import { anchorMessage } from '../gmail/message-anchor';
import { notifyLog } from '../notify/notify-log';
import { titleShowsSubject } from '../notify/notify-match';
import type { KeyInput } from '../menus/shortcuts';
import { SURFACES, SURFACE_CONFIG, surfaceForUrl, surfacesForRef, type Surface } from '../../renderer/lib/surfaces';
import { accountKey, type AccountRef } from '../accounts/account-ref';
import { SESSION_PARTITION } from '../core/session-partition';

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
  /** The URL each view belongs to. Set by the app and never by the page, so a redirect
   * the app did not ask for is recognisable as one -- see view-home.ts. */
  private homeUrls = new Map<string, string>();
  private activeViewKey: string | null = null;
  private notifClickUntil = new Map<string, number>();
  private warming = new Set<string>();
  private popoutExpectUntil = new Map<string, number>();
  private dropRefused = new Set<string>();
  /** Whether the settings panel has every view hidden. Keyboard focus belongs to the shell
   * while it is, and to the view on screen otherwise. */
  private surfacesHidden = false;
  /** Which anchor owns a mail view. A later click bumps it, and the one still looking
   * stops. */
  private anchorRun = new Map<string, number>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onUnread: (accountKey: string, count: number) => void,
    private readonly onActivate: (
      accountKey: string,
      surface: Surface,
      threadId?: string,
      subject?: string,
      messageId?: string,
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
      surface,
      getOpenMode: this.getOpenMode,
      openInApp: (url) => this.openInOwningSurface(ref, surface, url),
      isNotificationClickInFlight: () => Date.now() < (this.notifClickUntil.get(k) ?? 0),
      isPopoutExpected: () => Date.now() < (this.popoutExpectUntil.get(k) ?? 0),
    });
    view.webContents.on('ipc-message', (_e, channel, ...args) => {
      if (surface === 'mail') {
        if (channel === IPC.UNREAD_UPDATE) this.onUnread(acctKey, Number(args[0]) || 0);
        else if (channel === IPC.ACCOUNT_IDENTITY) {
          const identity = args[0] as
            | Partial<{ email: unknown; name: unknown; avatarUrl: unknown }>
            | undefined;
          if (
            typeof identity?.email === 'string' &&
            typeof identity.name === 'string' &&
            typeof identity.avatarUrl === 'string'
          ) {
            this.onIdentity(acctKey, identity as { email: string; name: string; avatarUrl: string });
          }
        } else if (channel === IPC.MAIL_DROP) {
          const payload = args[0] as Partial<MailDropPayload> | undefined;
          if (
            payload &&
            Array.isArray(payload.items) &&
            typeof payload.authuser === 'string' &&
            typeof payload.ik === 'string'
          ) {
            this.onMailDrop(acctKey, payload as MailDropPayload);
          }
        } else if (channel === IPC.MAIL_DROP_ALLOWED_GET) {
          this.pushMailDropAllowed(acctKey);
        }
      }
      if (channel === IPC.NOTIFICATION_ACTIVATE) {
        if (args[1]) notifyLog(`[notify] ${acctKey} lookup ${JSON.stringify(args[1])}`);

        const meta = args[1] as { body?: unknown; messageId?: unknown } | undefined;
        this.onActivate(
          acctKey,
          surface,
          typeof args[0] === 'string' ? args[0] : undefined,
          typeof meta?.body === 'string' ? meta.body : undefined,
          typeof meta?.messageId === 'string' ? meta.messageId : undefined,
        );
      }
    });
    const home = urlOverride ?? SURFACE_CONFIG[surface].url(ref);
    this.homeUrls.set(k, home);
    void view.webContents.loadURL(home);
    view.webContents.on('before-input-event', (_e, input) => this.onInput(acctKey, input as unknown as KeyInput));
    view.webContents.on('did-finish-load', () => {
      view.webContents.setZoomLevel(this.getZoom(acctKey));
      if (surface === 'mail') view.webContents.setAudioMuted(this.getSilent(acctKey));
    });
    view.webContents.once('destroyed', () => {
      if (this.views.get(k) !== view) return;
      this.views.delete(k);
      this.homeUrls.delete(k);
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
    this.surfacesHidden = false;
    this.applyBounds(view);
    // Keyboard focus has to travel with the view, or it stays with the one that just went
    // invisible. before-input-event only reaches the focused webContents, so a switch that
    // leaves focus behind drops Ctrl+1..9, Ctrl+N and the zoom keys on the floor -- and the
    // user has to click the page to get them back.
    this.focusActiveSurface();
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

  /**
   * Where a view currently sits
   *
   * Beside titleOf because the delegated health watch needs both: the title says which
   * mailbox is on screen, and this says whether the view is still on the url that was
   * supposed to put it there.
   *
   * @param accountKey
   * @param surface
   * @returns the url, or null when there is no live view
   */
  urlOf(accountKey: string, surface: Surface): string | null {
    const view = this.views.get(viewKey(accountKey, surface));
    if (!view || view.webContents.isDestroyed()) return null;
    try {
      return view.webContents.getURL();
    } catch {
      return null;
    }
  }

  /**
   * Sends a view that was redirected away back to the url it belongs to
   *
   * The cure for a delegated mailbox opened while signed out: the url is still the right
   * one, the view was simply carried off it, and nothing else in the app was watching. A
   * view that has not moved is left exactly as it is -- reloading one out from under the
   * user is not a repair.
   *
   * @param accountKey
   * @param surface
   * @returns true when the view was actually sent back
   */
  sendHome(accountKey: string, surface: Surface): boolean {
    const k = viewKey(accountKey, surface);
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    const home = this.homeUrls.get(k) ?? null;
    if (!viewLeftItsHome(home, wc.getURL())) return false;
    void wc.loadURL(home!);
    return true;
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
   * included — withHiddenView never registers one here.
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
    this.homeUrls.delete(k);
    this.warming.delete(k);
    if (this.activeViewKey === k) {
      this.activeViewKey = null;
      this.focusActiveSurface();
    }
    if (surface === 'mail') this.onUnread(accountKey, 0);
  }

  hideAll(): void {
    for (const [vk, v] of this.views) if (!this.warming.has(vk)) v.setVisible(false);
    this.surfacesHidden = true;
    this.focusActiveSurface();
  }

  showActive(): void {
    this.surfacesHidden = false;
    if (this.activeViewKey) {
      const view = this.views.get(this.activeViewKey);
      if (view) {
        view.setVisible(true);
        this.applyBounds(view);
      }
    }
    this.focusActiveSurface();
  }

  /**
   * Puts keyboard focus on the surface that is on screen
   *
   * The shortcuts (Ctrl+1..9, Ctrl+N, the zoom keys) arrive as before-input-event, and
   * Electron sends that to the focused webContents only. Three states used to leave the
   * window focused with nothing inside it focused -- a window nobody had clicked in yet, a
   * switch that hid the view holding focus, and the settings panel hiding every view -- and
   * in all three the keys reached no handler at all. Called wherever what is on screen
   * changes, so there is always exactly one place the keys land.
   */
  focusActiveSurface(): void {
    // Only ever moves focus inside a window that already has it: focusing a webContents can
    // raise its window on Windows, and a view built while the user is in another app must
    // not pull them out of it. The window's own focus event calls this again, so a window
    // that was busy elsewhere is put right the moment it comes back.
    if (this.win.isDestroyed() || !this.win.isFocused()) return;
    const k = this.activeViewKey;
    const view = k && !this.surfacesHidden && !this.warming.has(k) ? this.views.get(k) : undefined;
    if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    else if (!this.win.webContents.isDestroyed()) this.win.webContents.focus();
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
  openInOwningSurface(ref: AccountRef, from: Surface, url: string): void {
    const target = surfaceForUrl(url) ?? from;
    this.ensureView(ref, target, false);
    const k = viewKey(accountKey(ref), target);
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    this.homeUrls.set(k, url);
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
   * Sends the mail view to one conversation, and to one message inside it
   *
   * The thread is what Gmail is navigated by; the message is what the notification was
   * about, and without it Gmail picks one of its own — an older one, which is the bug this
   * argument exists for. Pointing at it is a second step because Gmail navigates on its own
   * clock, so it runs unawaited and says in the log how it went.
   *
   * @param accountKey
   * @param threadId
   * @param messageId the mail the card named, when it is known
   */
  openMailThread(accountKey: string, threadId: string, messageId?: string): void {
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) {
      notifyLog(`[notify] ${accountKey} open ${threadId}: no mail view`);
      return;
    }

    notifyLog(
      `[notify] ${accountKey} open thread=${JSON.stringify(threadId)}` +
        ` message=${JSON.stringify(messageId ?? 'none')}` +
        ` (loading=${wc.isLoading()}, at ${wc.getURL()})`,
    );
    // Claimed before the navigation, and whether or not this one has a message to point at:
    // sending the view somewhere else is exactly what makes an anchor still looking for the
    // last conversation wrong, and it would otherwise unfold what it finds when it arrives.
    const run = this.claimMailView(k);
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`).catch(() => {});
    if (!messageId) return;
    void this.anchorMailMessage(wc, accountKey, messageId, () => this.anchorRun.get(k) !== run);
  }

  /**
   * Says this navigation owns the mail view now
   *
   * @param k the view key
   * @returns the run number, which stops being the current one the moment anything else
   *   sends this view somewhere
   * @private
   */
  private claimMailView(k: string): number {
    const run = (this.anchorRun.get(k) ?? 0) + 1;
    this.anchorRun.set(k, run);
    return run;
  }

  /**
   * Unfolds the message the notification was about, once the conversation is on screen
   *
   * @param wc
   * @param accountKey for the log line, which is the only place the outcome is reported —
   *   a message that cannot be found leaves the conversation open, which is where the app
   *   stood before this existed
   * @param messageId
   * @param superseded true once a later click has taken this view over
   * @private
   */
  private async anchorMailMessage(
    wc: WebContents,
    accountKey: string,
    messageId: string,
    superseded: () => boolean,
  ): Promise<void> {
    const seen = await anchorMessage(
      (script) => (wc.isDestroyed() ? Promise.resolve(null) : wc.executeJavaScript(script)),
      messageId,
      { superseded },
    );
    notifyLog(`[notify] ${accountKey} message ${messageId} on screen: ${seen}`);
  }

  /**
   * Points Gmail's own pop-out window at the message too
   *
   * @param win the window Gmail opened
   * @param accountKey
   * @param messageId
   * @private
   */
  private async anchorPopout(
    win: BrowserWindow,
    accountKey: string,
    messageId: string,
  ): Promise<void> {
    const gone = (): boolean => win.isDestroyed() || win.webContents.isDestroyed();
    const seen = await anchorMessage(
      (script) => (gone() ? Promise.resolve(null) : win.webContents.executeJavaScript(script)),
      messageId,
    );
    notifyLog(`[notify] ${accountKey} pop-out message ${messageId} on screen: ${seen}`);
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
    const k = viewKey(accountKey, 'mail');
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    this.claimMailView(k);
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
   * @returns true once the button is clicked, false if it never appears
   *   — the caller then opens a thread window of its own. The view is restored either way.
   */
  async popOutThread(
    accountKey: string,
    threadId: string,
    subject?: string,
    messageId?: string,
  ): Promise<boolean> {
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
    // The pop-out is Gmail's own window on the same conversation, so it opens on the same
    // message the view would have — the wrong one. It is pointed at the mail as well.
    const onCreated = (created: BrowserWindow): void => {
      popoutOpened = true;
      if (!messageId || !created) return;
      // Created is not loaded: Chromium has the window, Gmail has not drawn in it yet, and
      // starting the looking here would spend the whole budget on the page load.
      const start = (): void => void this.anchorPopout(created, accountKey, messageId);
      if (created.webContents.isLoading()) created.webContents.once('did-finish-load', start);
      else start();
    };
    wc.once('did-create-window', onCreated);
    try {
      this.openMailThread(accountKey, threadId);
      const clicked = await this.clickPopoutButton(wc, showsTheThread);
      if (clicked) await waitUntil(() => popoutOpened, POPOUT_WINDOW_WAIT_MS);
      notifyLog(`[notify] ${accountKey} pop-out clicked=${clicked} window=${popoutOpened}`);
      // The view is leaving this conversation, so nothing may still be looking in it.
      this.claimMailView(k);
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
   * @returns '' when it has none or cannot be asked
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
   * @returns false when the button never appeared, and the caller opens
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
   * Pushes the current drag-to-save answer to an account's mail view
   *
   * The page only asks a bounded number of times after it loads, so an account that
   * registers only after that window closed would otherwise never learn the answer -- this
   * is the push side that reaches it once the account exists.
   *
   * @param accountKey
   */
  pushMailDropAllowed(accountKey: string): void {
    const allowed = this.mayDragToSave(accountKey);
    if (allowed === null) return;
    const k = viewKey(accountKey, 'mail');
    if (!allowed && !this.dropRefused.has(k)) {
      this.dropRefused.add(k);
      console.log(`[maildrop] no dropzone for ${accountKey}: outside the work domain`);
    }
    const wc = this.views.get(k)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.MAIL_DROP_ALLOWED, allowed);
  }

  /**
   * Runs something against a page nobody sees, then throws the page away
   *
   * @param url
   * @param fn
   * @returns whatever fn answered
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
    this.reloadViewKey(this.activeViewKey);
  }

  reloadAll(): void {
    for (const vk of [...this.views.keys()]) this.reloadViewKey(vk);
  }

  /**
   * Reloads one view, sending it back to where it belongs if it is no longer there
   *
   * webContents.reload() reloads wherever the page has ended up, which is right for a page
   * the user navigated and wrong for one Google redirected. A delegated mailbox opened while
   * signed out lands on a login page and, once the user signs back in, on the signed-in
   * account's own inbox -- so a plain reload cemented the wrong mailbox in the delegated
   * view instead of recovering it.
   *
   * @param vk the view key
   * @private
   */
  private reloadViewKey(vk: string): void {
    const wc = this.views.get(vk)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const home = this.homeUrls.get(vk) ?? null;
    if (viewLeftItsHome(home, wc.getURL())) void wc.loadURL(home!);
    else wc.reload();
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
 * @returns which says nothing about which of the two ended the wait
 * @private
 */
async function waitUntil(done: () => boolean, timeoutMs: number, stepMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
