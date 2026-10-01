// Which mailboxes the "add a delegated mailbox" button has to offer.
//
// Discovery and adding used to be the same act: whatever the relay named was written into the
// store, so pressing the button once dragged in every mailbox the domain had ever delegated,
// and the automatic sweep at startup did the same behind your back. Adding is now a choice a
// person makes, which needs a list to choose from -- this is that list, and nothing here
// writes anything.
//
// Absence is not reasoned about at all, unlike delegated-reconcile.ts: a mailbox one requester
// names is offered, whatever the other requesters said or failed to say. Offering too much
// costs a row nobody ticks; offering too little hides a mailbox the person came here to add.

import type { RequesterAnswer } from './delegated-reconcile';


//===========================
// Exported functions
//===========================

/**
 * The mailboxes to put in front of the user, addresses lowercased and in one order
 *
 * @param arg every answer that came back, what the store already holds, and the user's own
 *   addresses -- detection owns those, and a delegated row for one would draw it twice
 * @returns what may be added, sorted so the list does not reshuffle between two asks
 */
export function pickableMailboxes(arg: {
  answers: RequesterAnswer[];
  stored: string[];
  own: string[];
}): string[] {
  const held = new Set(arg.stored.map((e) => e.trim().toLowerCase()));
  const own = new Set(arg.own.map((e) => e.trim().toLowerCase()));
  const named = new Set(
    arg.answers
      .filter((a): a is Extract<RequesterAnswer, { ok: true }> => a.ok)
      .flatMap((a) => a.mailboxes.map((m) => m.trim().toLowerCase())),
  );
  return [...named].filter((e) => !held.has(e) && !own.has(e)).sort();
}
