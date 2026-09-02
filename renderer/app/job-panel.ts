// One panel for a whole job, not one result panel per batch.
//
// The rules that carry risk live here rather than in the page -- whether an arriving preview may
// return the panel to its picking phase, and what phase a job's end leaves the panel in -- kept
// as a plain module so it can be asserted without React.

import { type UiStrings } from './strings';
import { type JobLine, type JobEnd, type JobEndOutcome } from '../lib/maildrop-copy';


//===========================
// Types
//===========================

/** The little these rules need to know about the panel's phase: what kind it is, and whether the
 * report it is showing is a job's own. The page's whole Phase union satisfies it, and so does a
 * literal in a test. */
export interface PhaseAt {
  kind: string;
  result?: { job?: JobEnd };
}

/** What the footer can ask of the copy in flight. The page's own union, mirrored here because
 * the rule about which refusals are worth reporting is this module's, not the page's. */
export type JobControlAction =
  | 'pause'
  | 'resume'
  | 'stop-keep'
  | 'stop-rollback-batch'
  | 'stop-rollback-job';

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

// Written as the keys of a record rather than as an array, because an array of a union is
// under no obligation to hold all of it: the hand-listed version compiled and tested green
// with an outcome missing, which is exactly the hole the list was supposed to close. A
// Record<JobEndOutcome, true> does not compile until every member is there.

/** Every outcome a job can end on, so a test can walk them all rather than trust a list of
 * cases someone remembered to write. */
export const JOB_END_OUTCOMES = Object.keys({
  completed: true,
  kept: true,
  'rolled-back': true,
  'rolled-back-partial': true,
  stuck: true,
} satisfies Record<JobEndOutcome, true>) as JobEndOutcome[];


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
 * @param S the active string set
 * @returns the phase, with the mode and completeness the stopped report reads
 */
export function phaseAfterJobEnd(end: JobEnd, S: UiStrings): EndPhase {
  switch (end.outcome) {
    case 'completed':
      return { kind: 'done' };
    case 'stuck':
      return { kind: 'done', error: end.error ?? S.mdJobStuckDefault };
    case 'kept':
      return { kind: 'stopped', mode: 'keep', complete: true };
    case 'rolled-back':
      return { kind: 'stopped', mode: 'rollback', complete: true };
    case 'rolled-back-partial':
      return { kind: 'stopped', mode: 'rollback', complete: false };
    // Two belts. The `never` assignment is the compile-time one: with every member of
    // JobEndOutcome answered above, `end.outcome` narrows to `never` here, so a sixth member
    // fails to compile in this function. The return under it is the runtime belt, for an outcome
    // that never went through this compiler at all -- main and the renderer are separate builds.
    default: {
      const unhandled: never = end.outcome;
      return { kind: 'done', error: unknownOutcome(unhandled, S) };
    }
  }
}

/**
 * Whether a panel message may put the panel into its walking phase
 *
 * A job announces itself on the progress channel, and that channel keeps delivering after the
 * walk is over. Taking a finished report back into the walking phase would put the panel behind
 * a phase whose only exit -- the job end -- has already been sent and will not come again.
 *
 * @param cur the phase the panel is in
 * @returns false once the panel is showing a job that has reported its end
 */
export function panelMayWalk(cur: PhaseAt): boolean {
  return !panelBelongsToJob(cur) || cur.kind === 'walking';
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
 * @param S the active string set
 * @returns the heading, ready to draw
 */
export function panelTitle(
  arg: { items: number; job: JobLine | null; failed?: boolean },
  S: UiStrings,
): string {
  if (arg.failed) return S.mdDragFailed;
  const n = arg.job ? arg.job.total : arg.items;
  return S.mdCopyTitle(n);
}

/**
 * The two lines under the title while a job walks
 *
 * @param arg the job line, and the mailboxes the job files into
 * @param S the active string set
 * @returns where it is filing and how far it has got, either of them empty when it is not known
 *   yet -- there is a moment between the driver taking over and the next batch's first progress
 *   where the numbers do not exist
 */
export function panelBody(
  arg: { job: JobLine | null; targets: string[] },
  S: UiStrings,
): {
  into: string;
  progress: string;
} {
  const { job, targets } = arg;
  return {
    into: targets.length === 0 ? '' : S.mdCopyingTo(joinNames(targets, S)),
    progress: job ? S.mdJobProgress(job.batch, job.batches, job.done, job.total) : '',
  };
}

// A refused pause is the exception and has to stay silent: the stop dialog pauses and opens in
// the same click, and between two batches there is no copy in flight to take that pause -- a
// normal moment in every job, not a failure worth a red line.

/**
 * What the panel should say when the gate did not take an action
 *
 * @param action what was asked
 * @param result what main answered, or undefined when the call never got there
 * @param S the active string set
 * @returns the line to show, or null when there is nothing worth reporting
 */
export function controlFailureText(
  action: JobControlAction,
  result: { ok: boolean; error?: string } | undefined | null,
  S: UiStrings,
): string | null {
  if (result?.ok) return null;
  if (action === 'pause' || action === 'resume') return null;
  const why = result?.error ?? S.mdControlNoAnswer;
  return S.mdStopFailed(why);
}

/**
 * The line the panel closes a job with
 *
 * @param end
 * @param S the active string set
 * @returns one sentence, in the same voice the batch reports use
 */
export function jobEndText(end: JobEnd, S: UiStrings): string {
  switch (end.outcome) {
    case 'completed':
      return S.mdJobDone(end.done, end.total);
    case 'kept':
      return S.mdJobStoppedKept(end.done, end.total);
    case 'rolled-back':
      return S.mdJobRolledBack;
    case 'rolled-back-partial':
      return S.mdJobRolledBackPartial;
    case 'stuck':
      return S.mdJobStuck(end.copiedBatches + 1, end.batches, end.error ?? '');
    // The same two belts as phaseAfterJobEnd, for the same reason and with the same words: this
    // is the panel's closing line and the page draws it in three places, so a switch that fell
    // through returned undefined and drew an empty line where the job's result belongs.
    default: {
      const unhandled: never = end.outcome;
      return unknownOutcome(unhandled, S);
    }
  }
}


//===========================
// Helper functions
//===========================

/**
 * The line both switches fall back on for an outcome this build has never heard of
 *
 * The parameter is `never` on purpose: without a cast, the only value that can be passed is one
 * the compiler has already narrowed to `never`, which is what the default of an exhaustive switch
 * hands over. So the fallback cannot be reached from a switch that still has a case missing.
 *
 * @param outcome what arrived, which the compiler believes cannot exist
 * @param S the active string set
 * @returns the sentence, naming the outcome so a screenshot or a log says which one it was
 * @private
 */
function unknownOutcome(outcome: never, S: UiStrings): string {
  return S.mdJobUnknownOutcome(String(outcome));
}

/**
 * Mailbox addresses as a person reads them out
 *
 * @param names
 * @param S the active string set
 * @returns comma-separated with the locale's own word for 'and' before the last, which is how
 *   the rest of this panel already writes a list
 * @private
 */
function joinNames(names: string[], S: UiStrings): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${S.mdListAnd} ${names[names.length - 1]}`;
}
