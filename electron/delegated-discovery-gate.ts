// Decides when delegated-mailbox discovery via the relay may run.
//
// Discovery asks the relay on behalf of one of the user's own accounts (see
// `requestersInOrder` in main.ts), so it can only produce something useful once account
// detection has found at least one such account. It used to be wired unconditionally into
// `did-finish-load`, which fires before `startDetection()` has populated `profiles` with
// anything: at that instant there are zero authuser accounts, the loop over requesters runs
// zero times, and a one-shot latch made sure it was never tried again for the life of the
// process. This gate turns "has detection found an account yet" into an explicit, testable
// precondition instead of an implicit ordering assumption between two independent call sites.
export function canRunDelegatedApiScan(ownAccountCount: number, alreadyStarted: boolean): boolean {
  return !alreadyStarted && ownAccountCount > 0;
}
