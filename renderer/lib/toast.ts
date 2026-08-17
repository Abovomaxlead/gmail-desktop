// Types shared between main, the toast page and the preload bridge, in renderer/lib so
// neither side has to reach into the other's tree.
//
// A toast with no `expiresAt` stays until dismissed, which is the default. `account` is
// absent on toasts belonging to the app rather than a mailbox, and those carry no actions.
// `messageId` is present only on push-sourced mail; a notification relayed from the Gmail
// page carries `webNotifyId` instead, since only that page still holds the subject the
// thread lookup matches against.


//===========================
// Types
//===========================

export type ToastKind = 'mail' | 'update' | 'download' | 'error' | 'test';

export interface ToastAccount {
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
  webNotifyId?: string;
  expiresAt?: number;
}

export interface ToastSummary {
  count: number;
  accountKey: string | null;
}

export interface ToastStack {
  toasts: Toast[];
  summary: ToastSummary | null;
}

export interface ToastState extends ToastStack {
  locale: 'en' | 'nl';
  reneMode: boolean;
  dark: boolean;
}

export type ToastAction = 'archive' | 'read';


//===========================
// Constants
//===========================

export const TOAST_WIDTH = 380;


//===========================
// Exported functions
//===========================

/**
 * The name main files a relayed notification's source view under
 *
 * Every page numbers its notifications from 1, so the page-side id alone collides and a
 * click lands on the wrong view. Pairing it with the sending WebContents is unique for as
 * long as that view lives, which is exactly as long as the thread can be resolved at all.
 *
 * @param senderId
 * @param pageId
 * @returns the key
 */
export function webNotifySourceKey(senderId: number, pageId: string): string {
  return `${senderId}:${pageId}`;
}
