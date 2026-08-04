// Whether an account's unread count may be shown at all. The taskbar badge total
// (electron/main.ts) and the account tab both read this one predicate so they
// cannot drift apart. Opt-out, not opt-in: an account whose owner never touched
// the setting has no `badgeCount` key, and that absence must still show a count.
// `showAll` is the Appearance master switch and overrides the per-account choice.
export function accountCountVisible(badgeCount: boolean | undefined, showAll = true): boolean {
  if (!showAll) return false;
  return badgeCount !== false;
}
