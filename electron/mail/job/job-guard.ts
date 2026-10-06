// Who may act while a label job is walking.
//
// Three questions with one thing in common: they are all answered minutes apart from the moment
// the work started, and mail-drop-controller.ts used to answer each of them by reading a
// module-level variable again at the far end. A plan swapped in between, a gate that had already
// decided, a drag that arrived mid-copy -- each read the state of a different moment than the one
// it belonged to. Pulled out here so the answers can be pinned by a test; the controller has none.
//
// Nothing here decides which mail lands where. These answer when a stop takes hold, what the panel
// is told, and which plan a finished batch is written into.


//===========================
// Types
//===========================

/** Enough of a plan to know which one it is. The controller holds far more; the tail of a copy
 * only has to recognise the plan it started out with. */
export interface JobPlanRef {
  jobId: string;
}

/** Enough of a copy run's gate to know whether a stop can still change its outcome. `decided`
 * is set once the run has read its own stop mode, after which the tally is fixed however long
 * the marker sweep that follows takes. */
export interface RunStopState {
  decided: boolean;
  stopping: boolean;
}


//===========================
// Constants
//===========================

/** Shown to the view a second drag came from, since a drag nobody answers reads as one the app
 * lost. */
export const JOB_PULL_BUSY_TEXT =
  'Er loopt een klus die mail kopieert. Wacht tot die klaar is of stop hem eerst.';

/** Answered to a stop that arrived after the run it was aimed at had already settled, and with
 * no job left to carry it. */
export const STOP_TOO_LATE_TEXT = 'Het kopiëren was al klaar';


//===========================
// Exported functions
//===========================

/**
 * Whether a fresh drag may pull while a job is walking
 *
 * Refused rather than made safe. One pull is one module-level drag -- it empties `lastDropSaved`,
 * bumps the drag serial and reopens the preview -- and a walking job is re-entering that same
 * pull per batch, which is what walkJob's own note says it depends on. Letting a second drag in
 * displaced the walking plan: the batch in flight had its result written into the new plan, and
 * the panel left its walking phase while that batch was still uploading, which took Annuleren
 * away from mail that was still going out. Refusing is one line and one message; carrying two
 * drags at once would mean giving every one of those singletons an owner.
 *
 * @param walking whether a job's driver is walking batches right now
 * @returns what to tell the user, or null when the drag may go ahead
 */
export function pullRefusal(walking: boolean): string | null {
  return walking ? JOB_PULL_BUSY_TEXT : null;
}

/**
 * Whether a finished batch's result belongs to the plan now being held
 *
 * The copy captures the plan it was started for and the tail compares it, rather than reading
 * whichever plan happens to be held when the copy answers. Both have to be the same plan: a copy
 * started outside a job never records into one, and a job that ended midway is not written to
 * either.
 *
 * @param started the plan the copy was started for, or null when it was a plain drag
 * @param held the plan being held now, or null when none is
 * @returns true only when they are the same plan
 */
export function sameJobPlan(started: JobPlanRef | null, held: JobPlanRef | null): boolean {
  return !!started && !!held && started.jobId === held.jobId;
}

/**
 * Whether a stop can still change what a run does
 *
 * A run reads its stop mode once, when every upload has drained, and then sweeps its marker
 * labels -- up to five rounds with backoff, so seconds of network per batch. A stop landing in
 * that window used to call the gate and be answered as taken, while the run's tally was already
 * fixed and the walk went on to the next batch. A run that is already stopping is reachable
 * again: its own stop answers for this one.
 *
 * @param run
 * @returns true when the gate still decides something
 */
export function stopReachesRun(run: RunStopState): boolean {
  return !run.decided || run.stopping;
}

/**
 * What a stop the running batch can no longer take means for the job
 *
 * Only the job-wide choice reaches the batches that already finished. A batch the run cannot
 * sweep any more is left where it is -- the same rule a stop between two batches follows, and for
 * the same reason: there is nothing of that batch this stop can still act on.
 *
 * @param action what the panel asked for
 * @returns the intent the walk carries to its next check
 */
export function jobStopFromAction(action: string): 'keep' | 'rollback' {
  return action === 'stop-rollback-job' ? 'rollback' : 'keep';
}


//===========================
// Helper functions
//===========================
