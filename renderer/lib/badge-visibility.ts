// Whether an account's unread count may be shown at all — the taskbar badge
// total (electron/main.ts's excludedBadgeKeys) and the account tab
// (renderer/app/AccountTab.tsx, via Topbar) both need the same answer to the
// same question, or the per-account "Badge" setting hides the number in one
// place and leaves it in the other. One predicate, read from both sides, so
// they cannot drift apart. Lives here rather than in either caller: it's the
// one place both the Electron main process and the Next.js renderer can
// import from — see the header of surfaces.ts for why renderer/lib is that
// place. Keep this module pure data/logic — no Electron or DOM imports.
//
// Opt-out, not opt-in: the toggle defaults to on, so an account whose owner
// never touched the setting has no `badgeCount` key at all, and that absence
// must still show a count. Flipping this comparison would silently blank
// every count for every user who never opened Settings.
export function accountCountVisible(badgeCount: boolean | undefined): boolean {
  return badgeCount !== false;
}
