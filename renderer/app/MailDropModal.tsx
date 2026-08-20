// The types main hands back for a drag, shared by the sidebar and the mail-drop window.
//
// A copy runs in two rounds: 'check' looks for mail already under a chosen label and asks,
// 'new' and 'all' are the answer. `duplicates` carries a sample of subjects plus the real
// count, and a label drag is hundreds of requests, so the modal follows the progress.


//===========================
// Types
//===========================

export interface MailDropItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}

export interface MailDropCopyAccountResult {
  email: string;
  copied: number;
  skipped: number;
  total: number;
  error?: string;
}

export type MailDropCopyMode = 'check' | 'new' | 'all';

export interface MailDropCopyDuplicate {
  email: string;
  labelId: string;
  count: number;
  subjects: string[];
}

export interface MailDropCopyResult {
  ok: boolean;
  copied: number;
  skipped: number;
  total: number;
  accounts: MailDropCopyAccountResult[];
  error?: string;
  needsConfirm?: boolean;
  duplicates?: MailDropCopyDuplicate[];
  newCount?: number;
}

/** How far the copy has got, over all the chosen mailboxes at once. No mailbox is named:
 * both the check and the copy run several of them alongside each other, so singling one out
 * would say something untrue. */
export interface MailDropCopyProgress {
  phase: 'check' | 'copy';
  done: number;
  total: number;
}

export interface MailDropExistingLabel {
  labelId: string;
  count: number;
}

export interface MailDropExistingInMailbox {
  email: string;
  labels: MailDropExistingLabel[];
  error?: string;
}

export interface MailDropExisting {
  accounts: MailDropExistingInMailbox[];
  scanned: number;
  serial: number;
  answered: number;
}
