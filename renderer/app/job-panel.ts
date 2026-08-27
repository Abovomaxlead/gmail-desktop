// One panel for a whole job, not one result panel per batch.
//
// A job of four batches used to draw four panels: the driver showed each batch it was about to
// copy, the window came back to the front in whatever phase the previous batch had left it in,
// and every one of them described a batch -- "Kopieer 25 conversaties", "25 berichten
// gekopieerd" -- while the user was watching one piece of work of a hundred.
//
// The rules that carry risk live here rather than in the page: whether an arriving preview may
// return the panel to its picking phase (the one that landed 717 mails twice on 2026-08-26),
// and what phase a job's end leaves the panel in (a phase with no exit is the bug this
// replaces). Kept as a plain module for the same reason mailbox-rail.ts and drop-outcome.ts
// are: it is the part worth asserting without React.


//===========================
// Types
//===========================

/** How far a job has got, as the copy progress reports it. Both numbers are conversations, the
 * unit `job.total` speaks -- see jobProgress in electron/mail/label-job.ts. */
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

/** What became of a job, sent once when its walk is over. The outcomes are the job plan's own
 * vocabulary (JobOutcome in electron/mail/label-job.ts) plus 'stuck' for a job left open on a
 * failed batch, which is not an outcome the plan file ever gets. */
export interface JobEnd {
  outcome: JobEndOutcome;
  label: string;
  /** Conversations copied across the whole job */
  done: number;
  total: number;
  batches: number;
  copiedBatches: number;
  targets: string[];
  /** The failed batch's own error, for 'stuck' */
  error?: string;
}

/** The little these rules need to know about the panel's phase: what kind it is, and whether the
 * report it is showing is a job's own. The page's whole Phase union satisfies it, and so does a
 * literal in a test. */
export interface PhaseAt {
  kind: string;
  result?: { job?: JobEnd };
}

export type JobEndOutcome =
  | 'completed'
  | 'kept'
  | 'rolled-back'
  | 'rolled-back-partial'
  | 'stuck';

/** Where a job's end leaves the panel. Never a phase of its own: 'done' and 'stopped' are the
 * two the close button already works in. */
export interface EndPhase {
  kind: 'done' | 'stopped';
  mode?: 'keep' | 'rollback';
  /** False only when a rollback left mail it could not account for */
  complete?: boolean;
  error?: string;
}


//===========================
// Constants
//===========================

/** Every outcome a job can end on, so a test can walk them all rather than trust a list of
 * cases someone remembered to write. */
export const JOB_END_OUTCOMES: JobEndOutcome[] = [
  'completed',
  'kept',
  'rolled-back',
  'rolled-back-partial',
  'stuck',
];


//===========================
// Exported functions
//===========================

/**
 * Whether an arriving preview may return the panel to its picking phase
 *
 * The one rule this module exists for. A driven batch is a job showing what it is about to copy
 * itself; picking clears the chosen mailboxes and puts Kopieer live, so offering it for mail the
 * driver already has in flight is an invitation to copy the same batch twice -- pressed nine
 * seconds into batch 2 on 2026-08-26, and 717 of 719 mails landed twice.
 *
 * @param preview what main sent
 * @returns false for a driven batch, true for a real drag
 */
export function previewMayPick(preview: { driven?: boolean }): boolean {
  return preview.driven !== true;
}

/**
 * Whether the panel already belongs to a job rather than to one batch
 *
 * Batch one's copy is the picker's own, so its answer comes back to that window -- and by then the
 * driver may already have taken the panel over, or the job may already have reported its end on
 * it. Either way that answer describes one batch of a job the panel is speaking for, and letting
 * it through draws the per-batch report this replaced.
 *
 * @param cur the phase the panel is in
 * @returns true while it is showing a job, running or finished
 */
export function panelBelongsToJob(cur: PhaseAt): boolean {
  return (
    cur.kind === 'walking' ||
    ((cur.kind === 'done' || cur.kind === 'stopped') && cur.result?.job !== undefined)
  );
}

/**
 * The phase a job's end leaves the panel in
 *
 * Always one the close button works in. The panel sits in its job phase for as long as the walk
 * lasts, and this is the only way out of it -- which is why every outcome has to land here,
 * including a job stuck on a failed batch.
 *
 * @param end what main sent when the walk finished
 * @returns the phase, with the mode and completeness the stopped report reads
 */
export function phaseAfterJobEnd(end: JobEnd): EndPhase {
  switch (end.outcome) {
    case 'completed':
      return { kind: 'done' };
    case 'stuck':
      return { kind: 'done', error: end.error ?? 'De klus is gestopt op een batch die mislukte' };
    case 'kept':
      return { kind: 'stopped', mode: 'keep', complete: true };
    case 'rolled-back':
      return { kind: 'stopped', mode: 'rollback', complete: true };
    case 'rolled-back-partial':
      return { kind: 'stopped', mode: 'rollback', complete: false };
  }
}

/**
 * The panel's title
 *
 * Counts the job while one is walking and the batch on screen otherwise. The whole point of one
 * continuous panel: a hundred conversations in four batches is one piece of work, and a title
 * that says 25 three times reads as three.
 *
 * @param arg the conversations on screen, the job line if there is one, and whether the drag
 *   itself failed
 * @returns the heading, ready to draw
 */
export function panelTitle(arg: { items: number; job: JobLine | null; failed?: boolean }): string {
  if (arg.failed) return 'Slepen mislukt';
  const n = arg.job ? arg.job.total : arg.items;
  return n === 1 ? 'Kopieer 1 conversatie' : `Kopieer ${n} conversaties`;
}

/**
 * The two lines under the title while a job walks
 *
 * @param arg the job line, and the mailboxes the job files into
 * @returns where it is filing and how far it has got, either of them empty when it is not known
 *   yet -- there is a moment between the driver taking over and the next batch's first progress
 *   where the numbers do not exist
 */
export function panelBody(arg: { job: JobLine | null; targets: string[] }): {
  into: string;
  progress: string;
} {
  const { job, targets } = arg;
  return {
    into: targets.length === 0 ? '' : `Wordt gekopieerd naar ${joinNames(targets)}`,
    progress: job
      ? `Batch ${job.batch} van ${job.batches} — ${job.done} van ${job.total} gekopieerd`
      : '',
  };
}

/**
 * The line the panel closes a job with
 *
 * @param end
 * @returns one sentence, in the same voice the batch reports use
 */
export function jobEndText(end: JobEnd): string {
  switch (end.outcome) {
    case 'completed':
      return `Klus afgerond — ${end.done} van ${end.total} conversaties gekopieerd`;
    case 'kept':
      return `Klus gestopt — ${end.done} van ${end.total} conversaties blijven gekopieerd`;
    case 'rolled-back':
      return 'Klus gestopt en ongedaan gemaakt';
    case 'rolled-back-partial':
      return 'Klus gestopt, ongedaan maken niet overal gelukt';
    case 'stuck':
      return `Klus gestopt op batch ${end.copiedBatches + 1} van ${end.batches}${
        end.error ? ` — ${end.error}` : ''
      }`;
  }
}


//===========================
// Helper functions
//===========================

/**
 * Mailbox addresses as a person reads them out
 *
 * @param names
 * @returns comma-separated with 'en' before the last, which is how the rest of this panel
 *   already writes a list
 * @private
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} en ${names[names.length - 1]}`;
}
