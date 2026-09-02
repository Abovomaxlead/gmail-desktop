// What a label-emptying is allowed to act on, decided away from the network.
//
// This app has never removed mail it did not create. Every destructive path it has works from a
// marker label it applied in the same call that made the message. This feature removes mail from
// the mailbox holding the originals, on the user's word, so the one thing worth making
// structurally true is that it can only ever act on ids somebody was actually shown.
//
// That is what the handle below is. A count remembers its ids here and answers a handle; the
// purge takes the handle and nothing else. Mail arriving between the two is not in the store and
// therefore survives, an unknown handle is refused rather than re-derived, and `take` consumes
// what it hands out, so one count buys exactly one purge.
//
// The tree resolution is not here: `labelTreeMembers` in label-tree.ts already answers which
// labels belong to a dragged label, and Gmail's nesting being naming rather than containment is
// its problem to know about, not this file's.

//===========================
// Types
//===========================

/** One label of the tree, as the count reports it. Ids deliberately absent: the renderer is
 * told how many, never which. */
export interface PurgeLabel {
  name: string;
  labelId: string;
  messages: number;
}

/** What a count answers. The handle is the only way back to the ids behind it. */
export interface PurgeCount {
  handle: string;
  email: string;
  label: string;
  labels: PurgeLabel[];
  total: number;
  /** True when the listing stopped at PURGE_LIST_MAX, so the counts are a floor and not a total */
  capped: boolean;
}

export interface PurgeOutcome {
  trashed: number;
  failed: number;
  /** Gmail's own message for the chunk that stopped it, absent when nothing stopped it */
  error?: string;
}

/** One label's listing, as the controller collected it. */
export interface CountedLabel {
  name: string;
  labelId: string;
  ids: string[];
}

export interface PurgeStore {
  /**
   * Remembers a counted listing and answers the counts plus the handle that names it
   *
   * Replaces whatever was held before. One at a time on purpose: a second listing means the
   * user asked a new question, and the old answer must stop being actionable at that moment.
   */
  put(arg: { email: string; label: string; byLabel: CountedLabel[]; capped: boolean }): PurgeCount;
  /**
   * The ids behind a handle, for the labels named
   *
   * Consumes the handle: one count buys one purge. Answers null for a handle this store does not
   * currently hold, which covers a second click, a stale window and a handle from a listing that
   * has since been replaced.
   */
  take(handle: string, labels: string[]): { email: string; ids: string[] } | null;
}


//===========================
// Constants
//===========================

/** Where a listing stops. Far past any real label -- fifty thousand ids is a hundred list pages
 * -- and here so that a page loop that never terminates cannot allocate without end. When it
 * bites, the count says so rather than quietly reporting a smaller label than there is. */
export const PURGE_LIST_MAX = 50_000;


//===========================
// Exported functions
//===========================

/**
 * A store holding the one listing that may currently be purged
 *
 * @param newHandle injected so a test can name a handle, and so nothing here reaches for a
 *   random source of its own
 * @returns the store
 */
export function createPurgeStore(newHandle: () => string): PurgeStore {
  let held: { handle: string; email: string; byLabel: CountedLabel[] } | null = null;

  return {
    put({ email, label, byLabel, capped }): PurgeCount {
      const handle = newHandle();
      held = { handle, email, byLabel };
      return {
        handle,
        email,
        label,
        labels: byLabel.map((l) => ({ name: l.name, labelId: l.labelId, messages: l.ids.length })),
        total: byLabel.reduce((sum, l) => sum + l.ids.length, 0),
        capped,
      };
    },
    take(handle, labels): { email: string; ids: string[] } | null {
      if (!held || held.handle !== handle) return null;
      const wanted = new Set(labels);
      const ids = held.byLabel.filter((l) => wanted.has(l.name)).flatMap((l) => l.ids);
      const { email } = held;
      // Consumed whether or not the caller named anything this store knows: the question has
      // been answered, and answering it twice is what a double click looks like.
      held = null;
      return { email, ids };
    },
  };
}
