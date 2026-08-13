// Types shared between main, the toast page and the preload bridge, in renderer/lib for
// the same reason compose-account.ts is: main imports from here, the page imports from
// here, and neither has to reach into the other's tree. A toast with no `expiresAt` stays
// until it is dismissed, which is the default; the field is only set for accounts whose
// per-account persist switch is off. `account` is absent on the toasts that belong to the
// app rather than to a mailbox — an update, a finished download, a failed account link —
// and those never carry actions. `messageId` is what the archive and mark-read buttons
// need, so it is present only on push-sourced mail, where main got it from the Gmail API;
// a notification relayed from the Gmail page knows its subject but not its message id.
// Such a relayed one carries `webNotifyId` instead: the name main filed the source view
// under, which a click has to travel back with, because only that page still holds the
// subject the thread lookup matches against.


//===========================
// Types
//===========================

export type ToastKind = 'mail' | 'update' | 'download' | 'error' | 'test';

export interface ToastAccount {
  /** The account key activateNotification expects, not the address. */
  key: string;
  email: string;
  label: string;
  color: string;
  avatarUrl: string;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
  account?: ToastAccount;
  threadId?: string;
  messageId?: string;
  /** A notification relayed from a Gmail view, keyed by webNotifySourceKey — not the bare
   * page-side id, which collides between views. */
  webNotifyId?: string;
  /** Epoch ms. Absent means it stays until dismissed. */
  expiresAt?: number;
}

export interface ToastSummary {
  count: number;
  /** The account every collapsed toast came from, or null when they were mixed. */
  accountKey: string | null;
}

export interface ToastStack {
  toasts: Toast[];
  summary: ToastSummary | null;
}

export interface ToastState extends ToastStack {
  locale: 'en' | 'nl';
  reneMode: boolean;
  /** Whether to draw the cards dark, already resolved. The stack is its own window and so
   * its own document, and the dark class is only ever put on the main one, so the page
   * cannot read the theme the way every other surface does. Resolved by main rather than
   * sent as the three-way choice, because deciding what "system" means a second time here
   * is a second place for the answer to drift from the app's. */
  dark: boolean;
}

export type ToastAction = 'archive' | 'read';


//===========================
// Constants
//===========================

/** The width the page lays out its cards to, and the width the window is sized to — read
 * from here by both sides so the two can never drift apart. */
export const TOAST_WIDTH = 380;


//===========================
// Exported functions
//===========================

/**
 * The name main files a relayed notification's source view under
 *
 * Every page numbers its own notifications from 1 and no page knows about any other, so
 * the page-side id alone collides: two accounts both raise a "w1" and whichever spoke last
 * wins, which sends the click to the wrong view and opens an unrelated conversation. A
 * reload reproduces it within a single account. Pairing the id with the WebContents that
 * sent it is unique for as long as that view lives — and once it does not, there is nothing
 * left to resolve the thread with anyway, so the toast falls back to opening the account.
 *
 * @param senderId
 * @param pageId
 * @returns the key
 */
export function webNotifySourceKey(senderId: number, pageId: string): string {
  return `${senderId}:${pageId}`;
}
