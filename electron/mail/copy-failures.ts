// What a copy keeps of the mail that did not land, so the panel can name it and one button can
// send exactly that mail again. Kept apart from mail-copy.ts's tally, which counts and does not
// remember.


//===========================
// Types
//===========================

export interface FailedFileRef {
  threadId: string;
  subject: string;
  messageId: string;
}

export interface FailedFile<F extends FailedFileRef> {
  file: F;
  error: string;
  maybeLanded: boolean;
}

export interface TargetFailures<T extends { email: string }, F extends FailedFileRef> {
  target: T;
  files: FailedFile<F>[];
}

export interface FailureLine {
  subject: string;
  error: string;
  maybeLanded: boolean;
}

export interface RetryHeld {
  retryId: string;
  serial: number;
}


//===========================
// Constants
//===========================

const UNKNOWN_ERROR = 'onbekende fout';


//===========================
// Exported functions
//===========================

/**
 * The files of one mailbox whose copy failed
 *
 * @param files in the order of the drag
 * @param outcomes one per file, in the same order; a missing one never started
 * @returns {FailedFile[]}
 */
export function failedFiles<F extends FailedFileRef>(
  files: F[],
  outcomes: Array<{ kind: string; error?: string; maybeLanded?: boolean } | undefined>,
): FailedFile<F>[] {
  const out: FailedFile<F>[] = [];
  files.forEach((file, i) => {
    const outcome = outcomes[i];
    if (outcome?.kind !== 'failed') return;
    out.push({ file, error: outcome.error || UNKNOWN_ERROR, maybeLanded: outcome.maybeLanded === true });
  });
  return out;
}

/**
 * Every file of a mailbox that could not be written to at all
 *
 * @param files
 * @param error why the mailbox could not be opened
 * @returns {FailedFile[]}
 */
export function wholeTargetFailed<F extends FailedFileRef>(files: F[], error: string): FailedFile<F>[] {
  return files.map((file) => ({ file, error, maybeLanded: false }));
}

export function failureLines<F extends FailedFileRef>(list: FailedFile<F>[]): FailureLine[] {
  return list.map((f) => ({ subject: f.file.subject, error: f.error, maybeLanded: f.maybeLanded }));
}

/**
 * What a copy leaves to retry
 *
 * @param targets one entry per mailbox written to
 * @returns the mailboxes that lost mail, or null when none did
 */
export function copyFailuresOf<T extends { email: string }, F extends FailedFileRef>(
  targets: TargetFailures<T, F>[],
): TargetFailures<T, F>[] | null {
  const left = targets.filter((t) => t.files.length > 0);
  return left.length > 0 ? left : null;
}

/**
 * How many conversations a batch lost, in the unit the job line speaks
 *
 * @param targets the copy's failures
 * @param pullFailedThreads conversations the batch could not fetch at all
 * @returns {number} distinct conversations
 */
export function failedConversations(
  targets: TargetFailures<{ email: string }, FailedFileRef>[],
  pullFailedThreads: string[],
): number {
  const threads = new Set(pullFailedThreads);
  for (const t of targets) for (const f of t.files) threads.add(f.file.threadId);
  return threads.size;
}

/**
 * Why a retry may not run now
 *
 * @param s what the controller knows at the moment the button was pressed
 * @returns the sentence for the panel, or null when the retry may run
 */
export function retryRefusal(s: {
  wanted: string;
  held: RetryHeld | null;
  serial: number;
  jobDriving: boolean;
  jobActive: boolean;
  pulling: boolean;
  copying: boolean;
}): string | null {
  if (s.jobDriving || s.jobActive) return 'Er loopt een klus. Wacht tot die klaar is.';
  if (s.pulling) return 'Er wordt al mail opgehaald.';
  if (s.copying) return 'Er wordt al gekopieerd.';
  if (!s.held || s.held.retryId !== s.wanted || s.held.serial !== s.serial) {
    return 'Deze lijst is verlopen. Sleep de mail opnieuw.';
  }
  return null;
}
