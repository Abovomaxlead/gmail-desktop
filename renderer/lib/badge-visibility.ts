// Whether an account's unread count may be shown at all. The taskbar badge total
// (electron/main.ts) and the account tab both read this one predicate so they
// cannot drift apart. Opt-out, not opt-in: an account whose owner never touched
// the setting has no `badgeCount` key, and that absence must still show a count.

/**
 * Whether an account's unread count may be shown at all
 *
 * @param badgeCount the per-account choice; absent means the owner never touched it, which
 *   must still show a count
 * @param showAll the Appearance master switch, which overrides that choice
 * @returns true when the count may be drawn
 */
export function accountCountVisible(badgeCount: boolean | undefined, showAll = true): boolean {
  if (!showAll) return false;
  return badgeCount !== false;
}
