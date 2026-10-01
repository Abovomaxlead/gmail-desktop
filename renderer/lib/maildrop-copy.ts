// Shapes a mail-drop copy travels in, in renderer/lib so main and the modal read one
// declaration instead of two that have to be kept equal by hand.
//
// A job is a walk over many batches: the driver owns the copy, the modal watches it, and the
// numbers arrive on the progress channel while the panel itself is described once.


//===========================
// Types
//===========================

/** How far a job has got, as the copy progress reports it. Both numbers are conversations,
 * the unit `job.total` speaks. */
export interface JobLine {
  batch: number;
  batches: number;
  done: number;
  total: number;
}

/** What main sends with a driven batch: which label is walking, and where it is being filed.
 * The numbers travel separately, in JobLine, because they change while this does not. */
export interface JobPanel {
  label: string;
  targets: string[];
}

export type JobEndOutcome =
  | 'completed'
  | 'kept'
  | 'rolled-back'
  | 'rolled-back-partial'
  | 'stuck';

/** What became of a job, sent once when its walk is over. The outcomes are the job plan's own
 * vocabulary plus 'stuck' for a job left open on a failed batch. */
export interface JobEnd {
  jobId: string;
  label: string;
  targets: string[];
  outcome: JobEndOutcome;
  batches: number;
  copiedBatches: number;
  done: number;
  total: number;
  error?: string;
}

export interface ByMailbox {
  email: string;
  copied: number;
}

/** The main process's copy-progress payload, including the paused and rollback states the
 * modal draws. */
export interface CopyProgress {
  phase: 'check' | 'copy' | 'rollback';
  done: number;
  total: number;
  paused?: boolean;
  byMailbox?: ByMailbox[];
  /** Present only during a batched job; absent for a plain drag. */
  job?: JobLine;
  /** Sent when the driver takes over, which is the moment the modal stops owning the copy and
   * the panel becomes the job's. */
  panel?: JobPanel;
  /** Sent once, when the walk is over. The driver's copy has no return path to the modal, so
   * this is the only thing that can end the job phase. */
  jobEnd?: JobEnd;
}

export interface RollbackMailboxOutcome {
  email: string;
  /** Every message id the sweep confirmed it acted on, across every round it took. */
  swept: string[];
  /** False when the retry budget ran out while the marker still listed something -- not a
   * failure, just not finished yet; the next start resumes it on its own. */
  converged: boolean;
  refused?: 'permission' | 'auth';
  reason?: string;
}

export interface RollbackOutcome {
  mailboxes: RollbackMailboxOutcome[];
  complete: boolean;
}

/** A run this app never heard the end of, waiting for the same keep-or-rollback answer a live
 * run's stop dialog already asks. */
export interface PendingOrphan {
  runId: string;
  byMailbox: { email: string; inserted: number }[];
}

/** A job this app never heard the end of, waiting for the same kind of answer PendingOrphan
 * asks for one run. */
export interface PendingJob {
  jobId: string;
  label: string;
  batch: number;
  batches: number;
  done: number;
  total: number;
  mode: 'new' | 'all';
}

/** What a copy answers when it was stopped rather than run to its own end -- neither the
 * success nor the failure `ok` flag distinguishes between the two. */
export interface StoppedResult {
  stopped: true;
  mode: 'keep' | 'rollback';
  copied: number;
  byMailbox: ByMailbox[];
  rollback?: RollbackOutcome;
  error?: string;
  warnings?: string[];
  /** Set only when this is a whole job's end rather than one copy's, which is what makes the
   * report speak of the job instead of listing a batch's mailboxes. */
  job?: JobEnd;
}

/** What a dragged label turned out to carry: the label the drag started on, and every label
 * under it with the conversations it holds. */
export interface MailDropTree {
  dragged: string;
  members: Array<{ name: string; threads: number }>;
}
