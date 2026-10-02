// The types main hands back for a drag, shared by the sidebar and the mail-drop window.
//
// A copy runs in two rounds: 'check' looks for mail already under a chosen label and asks,
// 'new' and 'all' are the answer. `duplicates` carries a sample of subjects plus the real
// count, and a label drag is hundreds of requests, so the modal follows the progress.


import type { JobEnd, JobLine, JobPanel, MailDropTree } from '../lib/maildrop-copy';


//===========================
// Types
//===========================

export interface MailDropItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}

/** Everything main sends with a drag, or answers when the modal asks what the open drag is.
 * `driven` marks a batch a running job is showing rather than a fresh drag, and the language
 * fields travel with it the way ToastState carries them, since this window has no prefs of
 * its own. */
export interface MailDropPreview {
  items: MailDropItem[];
  tree?: MailDropTree | null;
  panel?: JobPanel;
  job?: JobLine;
  driven?: boolean;
  pullRetryId?: string;
  /** A finished job's report, sent only while its retry offer is held; never a drag to pick for */
  jobEnd?: Omit<JobEnd, 'jobId'>;
  locale?: 'en' | 'nl';
  reneMode?: boolean;
  /** Whether the app is drawing dark; this window cannot read the class the sidebar page puts
   * on itself */
  dark?: boolean;
}

export interface MailDropCopyAccountResult {
  email: string;
  copied: number;
  skipped: number;
  total: number;
  error?: string;
  failures?: { subject: string; error: string; maybeLanded: boolean }[];
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
  retryId?: string;
  /** A job retry's conversations that still could not be fetched; their subject may be empty */
  unfetched?: { subject: string; error: string; maybeLanded: boolean }[];
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
