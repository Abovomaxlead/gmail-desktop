// Sends state into the mail (and other) views: whether a page may raise notifications, the
// drag-to-save answer, and the mail drop's result, lock and progress. Everything here only
// needs a view's WebContents by account and surface, which is why the manager is not
// imported here: it is handed in as a lookup instead.

import {
  IPC,
  type NotifyState,
  type MailDropResult,
  type MailDropLock,
  type MailDropSaveProgress,
} from '../core/ipc';
import type { WebContents } from 'electron';
import type { Surface } from '../../renderer/lib/surfaces';


//===========================
// Types
//===========================

/** What this module needs from the view manager: a view's WebContents by account and
 * surface, and every account's mail view at once, for a message sent to all of them. */
export interface ViewLookup {
  webContents(accountKey: string, surface: Surface): WebContents | undefined;
  mailViews(): Iterable<WebContents>;
}


//===========================
// Messages
//===========================

export class MailViewMessages {
  private readonly dropRefused = new Set<string>();

  constructor(
    private readonly views: ViewLookup,
    private readonly mayDragToSave: (accountKey: string) => boolean | null,
  ) {}

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
    const wc = this.views.webContents(accountKey, surface);
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
    if (!allowed && !this.dropRefused.has(accountKey)) {
      this.dropRefused.add(accountKey);
      console.log(`[maildrop] no dropzone for ${accountKey}: outside the work domain`);
    }
    const wc = this.views.webContents(accountKey, 'mail');
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.MAIL_DROP_ALLOWED, allowed);
  }

  sendDropResult(accountKey: string, result: MailDropResult): void {
    const wc = this.views.webContents(accountKey, 'mail');
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
    for (const wc of this.views.mailViews()) {
      if (!wc.isDestroyed()) wc.send(channel, arg);
    }
  }
}
