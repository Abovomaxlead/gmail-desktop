// Cancelling a pull while it runs.
//
// The copy has a gate of its own (copy-control.ts) and this is deliberately not it. That one can
// pause and resume, and its stop carries a mode -- keep what landed, or trash it -- because a copy
// has been inserting mail into somebody else's mailbox and the user has to say what becomes of it.
// A pull has sent nothing to Google. There is nothing in a mailbox to undo and so no mode to choose
// between, which leaves a gate with one state change in it: running, then stopping, and no way
// back. Reusing the copy's gate here would mean carrying a pause nobody offers and a stopMode with
// one legal value, and every reader would have to work out which half applies.
//
// wait() only keeps new work from starting. It is the shape mapLimit already takes for its fourth
// parameter (`shouldWait?: () => Promise<'continue' | 'stop'>`, core/concurrency.ts), which checks
// it before claiming each item and ends that worker for good on 'stop' -- so a cancelled pull
// leaves its loop where it stands rather than being unwound by a thrown error.
//
// What is already on the wire when stop() is called would otherwise run to its own end, and a
// cancel would be as slow as the slowest conversation still being fetched. signal() is what severs
// it: aborted the instant stop() is called, and always the same object, so a listener attached at
// the start of the pull still fires however late the stop arrives.


//===========================
// Types
//===========================

export interface PullControl {
  /** Asked before each piece of work is claimed. Answers at once either way -- there is no pause
   * for a caller to be suspended by.
   *
   * Handed to mapLimit detached from the object it came off -- `activePull?.wait`, twice in
   * mail-drop-controller.ts -- so it must never read `this`. The implementation below closes over
   * its state instead, which is what makes that call site correct rather than lucky. */
  wait(): Promise<'continue' | 'stop'>;
  /** One-way and idempotent: there is no resume, and Escape and the button may both arrive for
   * the same pull. */
  stop(): void;
  /** Whether a stop has been asked for */
  stopped(): boolean;
  /** Aborted the instant stop() is called. The same object for the life of this control. */
  signal(): AbortSignal;
}


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * A gate one pull checks before it starts each next piece of work
 *
 * @returns the gate, running until something stops it
 */
export function createPullControl(): PullControl {
  let stopping = false;
  const abort = new AbortController();

  return {
    wait: () => Promise.resolve(stopping ? 'stop' : 'continue'),
    stopped: () => stopping,
    signal: () => abort.signal,
    stop(): void {
      // Guarded rather than left to AbortController's own idempotence, so that "stopping is
      // one-way" is stated here and not inferred from what abort() happens to do twice.
      if (stopping) return;
      stopping = true;
      // Cooperative gating stops new work; this cuts what is already running.
      abort.abort();
    },
  };
}


//===========================
// Helper functions
//===========================
