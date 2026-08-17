// Decides when delegated-mailbox discovery via the relay may run.
//
// Discovery asks on behalf of one of the user's own accounts, so it is useless until
// detection has found one. An explicit precondition rather than an ordering assumption
// between two call sites, since a one-shot latch that fires too early never runs again.

/**
 * Whether the relay may be asked for delegated mailboxes yet
 *
 * @param ownAccountCount how many own accounts detection has found so far
 * @param alreadyStarted whether the one-shot scan has run
 * @returns true only on the first call that has an account to ask on behalf of
 */
export function canRunDelegatedApiScan(ownAccountCount: number, alreadyStarted: boolean): boolean {
  return !alreadyStarted && ownAccountCount > 0;
}
