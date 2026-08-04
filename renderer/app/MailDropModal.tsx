'use client';

// The mail-drop modal and the types the main process hands back for a drag; the modal
// itself still only shows "Test". A copy runs in two rounds: 'check' looks for mail
// that already sits under a chosen label and asks, 'new' and 'all' are the user's
// answer. `duplicates` carries a sample of subjects plus the real count, and a label
// drag is hundreds of requests, so the modal follows the progress. The component
// fills its own view, which main sizes to exactly what the window should be.
export interface MailDropItem {
  threadId: string;
  subject: string;
  saved: number;
  error?: string;
}

export interface MailDropCopyTarget {
  email: string;
  labelIds: string[];
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

export interface MailDropCopyProgress {
  phase: 'check' | 'copy';
  done: number;
  total: number;
  email: string;
}

export function MailDropModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900">
      <p className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Test</p>
      <button
        onClick={onClose}
        className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        Sluiten
      </button>
    </div>
  );
}
