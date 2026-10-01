// Folding the relay's membership answers onto the stored mailboxes, in both directions.
//
// Membership is the relay's to say -- the Gmail API answers "who may reach mailbox X" and never
// the inverse -- so this is the only thing that can tell a delegation that was revoked from one
// that was never there. The URL is not decided here at all: that is the switcher's, and
// delegated-health.ts owns the question of whether it still works.
//
// Adding is safe and removing is not, and the difference is what this module is for. The relay
// answers for the requester it was asked as (requestDelegatedMailboxes: "which mailboxes the
// requester may reach"), and requestersInOrder() walks every own account, so one account's set
// is not the whole truth. Absence proves a revocation only when every own account has answered
// and at least one of them named something.
//
// The one caller runs after detection has settled -- maybeStartDelegatedApiScan() is called from
// settleDetection() in accounts/detection-controller.ts -- so "every own account" is the whole
// list rather than however many had been probed so far.
//
// That bar is high enough to be unreachable when an own account has no OAuth token to be asked
// with, so what this module cannot settle it hands on as `unconfirmed`: delegated-access.ts
// asks the token endpoint per mailbox, where a refusal names the mailbox instead of leaving it
// absent from a set.


//===========================
// Types
//===========================

/** What one requester's ask of the relay came to. `ok: false` covers every way an answer did
 * not arrive: no usable token for that account, the relay refusing, the network failing. An
 * account that was never asked leaves no entry at all, which counts the same way. */
export type RequesterAnswer =
  | { ok: true; email: string; mailboxes: string[] }
  | { ok: false; email: string; error: string };

/** Why removal was allowed or refused, for the line that goes to notify.log. A store that
 * silently kept a revoked mailbox is what made this bug unreadable from the log. */
export type ReconcileReason = 'reconciled' | 'incomplete' | 'empty' | 'no-answer';

export interface Reconciliation {
  /** Addresses the relay named that the store does not hold */
  add: string[];
  /** Addresses to drop, in the spelling the store holds them in; empty unless `complete` */
  remove: string[];
  /** Addresses no answer that arrived named, in the spelling the store holds them in. Equal
   * to `remove` when `complete`, and otherwise the mailboxes that are unaccounted for rather
   * than proven gone -- delegated-access.ts is what may still settle those. */
  unconfirmed: string[];
  /** True only when every own account answered and named something, which is the one case in
   * which an address being absent means it was revoked */
  complete: boolean;
  why: ReconcileReason;
}


//===========================
// Exported functions
//===========================

/**
 * Works out what to add to the store and what may be removed from it
 *
 * @param arg the stored addresses, one answer per requester that was asked, and how many own
 *   accounts there are to ask -- fewer answers than accounts is the same doubt as a failure
 * @returns what to add, what may be removed, and why
 */
export function reconcileDelegations(arg: {
  stored: string[];
  answers: RequesterAnswer[];
  requesters: number;
}): Reconciliation {
  const { stored, answers, requesters } = arg;
  const answered = answers.filter((a): a is Extract<RequesterAnswer, { ok: true }> => a.ok);
  const named = new Set(answered.flatMap((a) => a.mailboxes.map((m) => m.trim().toLowerCase())));
  const held = new Set(stored.map((e) => e.trim().toLowerCase()));

  // Always safe, whatever the others did: one requester naming a mailbox is proof it exists.
  const add = [...named].filter((e) => !held.has(e));

  const why = removalReason(answers, answered.length, requesters, named.size);
  const unconfirmed = stored.filter((e) => !named.has(e.trim().toLowerCase()));
  return {
    add,
    remove: why === 'reconciled' ? unconfirmed : [],
    unconfirmed,
    complete: why === 'reconciled',
    why,
  };
}


//===========================
// Helper functions
//===========================

/**
 * Whether absence in the answers proves a revocation, and if not, what stopped it
 *
 * @param answers every answer that came back
 * @param okCount how many of them arrived
 * @param requesters how many own accounts there are
 * @param namedCount how many addresses the answers named between them
 * @returns 'reconciled' when removal is allowed
 * @private
 */
function removalReason(
  answers: RequesterAnswer[],
  okCount: number,
  requesters: number,
  namedCount: number,
): ReconcileReason {
  if (okCount === 0 || requesters === 0) return 'no-answer';
  // Every own account, not just every answer that happened to arrive: an account with no usable
  // token is never asked, so it fails silently and would otherwise look like unanimity.
  if (okCount < requesters || answers.length !== okCount) return 'incomplete';
  // A relay answering 200 with an empty list is a deploy mid-rollout, a lost scope, an account
  // outside the domain -- not a person having every delegation revoked in the same second.
  if (namedCount === 0) return 'empty';
  return 'reconciled';
}
