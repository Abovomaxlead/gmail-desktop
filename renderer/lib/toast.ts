// Types shared between main, the toast page and the preload bridge, in renderer/lib for
// the same reason compose-account.ts is: main imports from here, the page imports from
// here, and neither has to reach into the other's tree. A toast with no `expiresAt` stays
// until it is dismissed, which is the default; the field is only set for accounts whose
// per-account persist switch is off. `account` is absent on the toasts that belong to the
// app rather than to a mailbox — an update, a finished download, a failed account link —
// and those never carry actions. `messageId` is what the archive and mark-read buttons
// need, so it is present only on push-sourced mail, where main got it from the Gmail API;
// a notification relayed from the Gmail page knows its subject but not its message id.
// Such a relayed one carries `webNotifyId` instead: the id the page gave it, which a click
// has to travel back with, because only that page still holds the subject the thread
// lookup matches against.

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
  /** The page-side id of a notification relayed from a Gmail view. */
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
}

export type ToastAction = 'archive' | 'read';
