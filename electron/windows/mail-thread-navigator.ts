// Opens a specific Gmail thread in the mail view and, when asked, pops it out into Gmail's
// own reading window. The one thing both need is the mail view's WebContents for an account,
// which is why the manager is not imported here: it is handed in as a lookup instead.
//
// Only Gmail can open a working pop-out, and its button exists only while the thread is
// open -- so popOutThread opens the thread, clicks the button, and sends the view back. The
// restore waits for the pop-out window rather than the click, since Gmail works
// asynchronously in between, and goes back regardless after POPOUT_WINDOW_WAIT_MS.

import type { BrowserWindow, WebContents } from 'electron';
import { mailSearchHash } from '../gmail/google-urls';
import { anchorMessage } from '../gmail/message-anchor';
import { notifyLog } from '../notify/notify-log';
import { titleShowsSubject } from '../notify/notify-match';


//===========================
// Types
//===========================

/** What the navigator needs from the view manager: just the mail view's WebContents for
 * one account, or undefined when it has none. */
export interface MailViewLookup {
  mailWebContents(accountKey: string): WebContents | undefined;
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

const POPOUT_CLICK_TRIES = 12;
const POPOUT_CLICK_INTERVAL_MS = 250;
const POPOUT_WINDOW_WAIT_MS = 2000;


//===========================
// Navigator
//===========================

export class MailThreadNavigator {
  /** Which anchor owns a mail view. A later click bumps it, and the one still looking
   * stops. */
  private readonly anchorRun = new Map<string, number>();
  private readonly popoutExpectUntil = new Map<string, number>();

  constructor(private readonly views: MailViewLookup) {}

  /**
   * Whether a pop-out window opening right now was asked for by popOutThread
   *
   * What tells apart Gmail's own pop-out, which the manager points at the message too, from
   * a popup the page opened on its own.
   *
   * @param accountKey
   */
  isPopoutExpected(accountKey: string): boolean {
    return Date.now() < (this.popoutExpectUntil.get(accountKey) ?? 0);
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
    const wc = this.views.mailWebContents(accountKey);
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
    const run = this.claimMailView(accountKey);
    void wc.executeJavaScript(`location.hash = ${JSON.stringify(`#inbox/${threadId}`)}`).catch(() => {});
    if (!messageId) return;
    void this.anchorMailMessage(wc, accountKey, messageId, () => this.anchorRun.get(accountKey) !== run);
  }

  /**
   * Says this navigation owns the mail view now
   *
   * @param accountKey
   * @returns the run number, which stops being the current one the moment anything else
   *   sends this view somewhere
   * @private
   */
  private claimMailView(accountKey: string): number {
    const run = (this.anchorRun.get(accountKey) ?? 0) + 1;
    this.anchorRun.set(accountKey, run);
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
    const wc = this.views.mailWebContents(accountKey);
    if (!wc || wc.isDestroyed()) return false;
    this.claimMailView(accountKey);
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
    const wc = this.views.mailWebContents(accountKey);
    if (!wc || wc.isDestroyed()) return false;
    const before = await this.readHash(wc);
    const titleBefore = wc.getTitle();
    // Already there means there is nothing to wait for: the conversation on screen is the
    // one that was asked for, and no navigation is going to change the title.
    const alreadyOpen = before === `#inbox/${threadId}`;
    const showsTheThread = (title: string): boolean =>
      alreadyOpen || (subject ? titleShowsSubject(title, subject) : title !== titleBefore);
    this.popoutExpectUntil.set(accountKey, Date.now() + 6000);
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
      this.claimMailView(accountKey);
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
