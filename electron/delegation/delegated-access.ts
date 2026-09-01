// Whether one mailbox is still reachable at all, asked mailbox by mailbox instead of as a set.
//
// delegated-reconcile.ts folds the relay's membership lists onto the store, and refuses to
// remove anything unless every own account answered. That is the right rule for an argument
// from absence, but it is unreachable for the setup most people have: an own account with no
// OAuth token of its own is never asked, so the answer set is forever 'incomplete' and a
// revoked delegation stays in the sidebar for good.
//
// This is the other kind of evidence, and it does not argue from absence. The token endpoint
// mints against Google's delegation record per call, so a refusal names this mailbox and this
// requester: 403 is "you are not a delegate of that mailbox". Every requester that could be
// asked saying 403 is a revocation, proven for that mailbox alone -- no other mailbox and no
// other account's silence enters into it.
//
// Everything else stays doubt. A network failure, a 5xx, a requester with no token to ask
// with: none of those say anything about the delegation record, and a mailbox is only ever
// dropped on a verdict, never on the absence of one.


//===========================
// Types
//===========================

/** One ask of the relay's token endpoint, for one mailbox as one requester. A requester that
 * could not be asked -- no usable token -- leaves no attempt behind, which reads as doubt
 * rather than as a refusal. */
export type AccessAttempt = { ok: true } | { ok: false; status: number };

/** What the attempts together prove about one mailbox. 'unknown' is not a soft 'revoked':
 * nothing may be removed on it. */
export type AccessVerdict = 'granted' | 'revoked' | 'unknown';


//===========================
// Constants
//===========================

// The relay's "this requester is not a delegate of that mailbox". Every other status is about
// the ask rather than about the delegation: 0 never reached the relay, 401 is the requester's
// own token, 5xx is the relay itself.
const NOT_A_DELEGATE = 403;


//===========================
// Exported functions
//===========================

/**
 * What a mailbox's asks add up to
 *
 * @param attempts one entry per requester that was actually asked, in any order
 * @returns 'revoked' only when at least one requester was asked and every one of them was
 *   told this mailbox is not theirs to reach
 */
export function accessVerdict(attempts: AccessAttempt[]): AccessVerdict {
  if (attempts.some((a) => a.ok)) return 'granted';
  if (attempts.length === 0) return 'unknown';
  return attempts.every((a) => !a.ok && a.status === NOT_A_DELEGATE) ? 'revoked' : 'unknown';
}
