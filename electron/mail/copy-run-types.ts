// What one copy run records about itself, so a cancelled run can be undone.
//
// Split off into its own module because the two halves of cancelling need the same shape
// without needing each other: the copy loop writes these records while it uploads, and the
// sweep pass (copy-marker-sweep.ts) reads a run's marker label id back to know what to act on.
// Neither has to import the other.
//
// The identity that matters here is no longer inferred at all. Earlier, a severed insert's
// RFC822 Message-ID had to be searched for and guessed at, because the header sits on every
// copy of a mail anywhere and cannot tell this run's own insert apart from one that was
// already there. The marker label closes that: every insert this run makes carries a label
// unique to the run, folded into the same POST that creates the message, so "what this run
// created" is membership under that label, not an inference from evidence that was never
// exclusive to begin with.
//
// A sweep acts only on the markerLabelId a run's own journal header recorded when the label
// was created -- never on an id re-derived by searching for the label's name again. That is
// what keeps a coincidental name collision unsweepable: if a mailbox owner happens to have
// hand-made a label with the same name, no run's journal names its id, so nothing this app
// does can ever act on it.


//===========================
// Types
//===========================

/** Identifies one invocation of the copy, not one drag. A drag can be copied more than once
 * — a 'check' pass and then an 'all' pass share a drop serial — and each of those runs owns
 * a separate set of inserts to undo. */
export type CopyRunId = string;

/** How a paused run was told to end. 'keep' leaves everything that already landed where it
 * is; 'rollback' asks for it to go to the trash. Either way the run's marker is swept off the
 * mailbox before the run is considered finished -- 'keep' strips it, 'rollback' trashes
 * whatever still carries it. */
export type CopyStopMode = 'keep' | 'rollback';

/** One message this run inserted, written the moment the insert answered */
export interface CopyJournalEntry {
  runId: CopyRunId;
  /** The mailbox it landed in, and the one whose token can trash it again */
  email: string;
  /** Gmail's own message id from the insert answer. The only safe key to undo by. */
  gmailId: string;
  threadId?: string;
  /** The labels the user asked for -- never includes the run's own marker, which rides the
   * same insert but is tracked separately (see MarkerLabel) so this field stays exactly what
   * it says: what the user chose. */
  labelIds: string[];
}

/** One mailbox's own marker label for this run, recorded the moment the label is created --
 * before any file is uploaded to that mailbox, so an insert can never go out without it. */
export interface MarkerLabel {
  email: string;
  markerLabelId: string;
}

/** What became of one mailbox in a marker sweep. Kept per mailbox rather than per message
 * because permission is a property of the mailbox: a delegated target the relay cannot open
 * fails for all of its messages at once, and that is what the user has to be told. */
export interface RollbackMailboxOutcome {
  email: string;
  /** Every message id the sweep confirmed it acted on, across every round it took. */
  swept: string[];
  /** False when the retry budget ran out while the marker still listed something. Left for
   * the next resumed sweep -- never reported as failed, and never as done, since nothing here
   * says the mail is not simply lagging behind Gmail's own index. */
  converged: boolean;
  /** Set when the mailbox itself refused outright, so the caller never confuses "this will
   * finish once we look again" with "this mailbox cannot be reached at all". */
  refused?: 'permission' | 'auth';
  /** The refusal's own message, alongside `refused`. */
  reason?: string;
}

/** The whole sweep pass, mailbox by mailbox */
export interface RollbackOutcome {
  runId: CopyRunId;
  mailboxes: RollbackMailboxOutcome[];
  /** True only when every mailbox converged with no refusal. */
  complete: boolean;
}


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================


//===========================
// Helper functions
//===========================
