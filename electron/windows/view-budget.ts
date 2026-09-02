// The low-memory rule, in one tested place instead of scattered across the call sites that
// warm views, keep calendar views around, and discard what is off screen.
//
// Low memory means only the view on screen stays loaded: every other one is discarded, views
// are never warmed ahead of being asked for, and calendar views are not created at all.
//
// "Every other one" is the whole point, and the first cut of this got it wrong by sweeping
// mail views alone. An account can hold a view per surface -- mail, calendar, drive, docs,
// sheets, slides, keep, contacts, chat -- and each is its own renderer costing the same as the
// mail one. Sweeping mail only left the Google-app views resident and the setting did nothing
// noticeable. The rule is per view, never per account.
//
// The trade-off -- an unlinked mailbox gives no notifications and no unread count while off
// screen -- is a caller concern; this module only decides what goes.

import type { ViewId } from './profile-view-manager';


//===========================
// Exported functions
//===========================

/**
 * Which live views must go
 *
 * @param opts live is every view that exists; active is the one on screen, null when none is
 * @returns the views to discard, in the order given
 */
export function viewsToDiscard(opts: { live: ViewId[]; active: ViewId | null }): ViewId[] {
  return opts.live.filter((view) => !(opts.active && sameView(view, opts.active)));
}

/**
 * Whether a view may be built ahead of being asked for -- warmed in advance, or, for a
 * calendar, created before its surface is ever opened
 *
 * @param lowMemory
 */
export function mayBuildAheadOfDemand(lowMemory: boolean): boolean {
  return !lowMemory;
}


//===========================
// Helper functions
//===========================

/**
 * Whether two ids name the same view
 *
 * Both halves have to match: one account's calendar being on screen is no reason to keep that
 * same account's mail view loaded.
 *
 * @param a
 * @param b
 * @returns true when the account and the surface both match
 * @private
 */
function sameView(a: ViewId, b: ViewId): boolean {
  return a.accountKey === b.accountKey && a.surface === b.surface;
}
