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
// `showAll` is de hoofdschakelaar uit Weergave (`appearance.showUnreadBadges`).
// Hij staat vóór de keuze per account: uit verbergt élk getal, ook van een account
// dat wél meetelt — dat is wat "Hide all unread badges … regardless of individual
// account settings" betekent. Standaard `true`, zodat een aanroeper die de
// hoofdschakelaar niet kent (of voorkeuren die nog niet binnen zijn) zich gedraagt
// als vóórdat die schakelaar bestond.
export function accountCountVisible(badgeCount: boolean | undefined, showAll = true): boolean {
  if (!showAll) return false;
  return badgeCount !== false;
}
