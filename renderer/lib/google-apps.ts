// Which Google apps can be pinned to the bar, and where each app opens. The order of
// the checks in googleAppTarget is the decision: both master switches settle every app
// at once and so come first, and the per-app exclusion only gets a say when neither
// did. That is why the settings panel disables the exclusion list while either master
// switch is set - a list that cannot change any outcome must not invite a choice.
// filterPinned drops unknown and duplicate keys, since prefs may name an app a later
// version removed. electron/google-apps-open.ts re-exports these so main and the bar
// agree.
//
// Pinning is one list for the whole app, but a pin opens for whichever account is in
// view, and a delegated mailbox has no Drive or Docs of its own. pinnedSurfacesFor is
// therefore what the bar renders: the stored pins narrowed to what that account can
// actually open, so a button that would throw is never drawn in the first place.

import { APP_SURFACES, SURFACE_CONFIG, type Surface } from './surfaces';

export const PINNABLE_SURFACES: readonly Surface[] = ['calendar', ...APP_SURFACES];

export type GoogleAppTarget = 'in-app' | 'new-window' | 'external';

export function googleAppTarget(
  surface: string,
  prefs: { openInApp: boolean; alwaysNewWindow: boolean; excluded: readonly string[] },
): GoogleAppTarget {
  if (!prefs.openInApp) return 'external';
  if (prefs.alwaysNewWindow) return 'new-window';
  if (prefs.excluded.includes(surface)) return 'external';
  return 'in-app';
}

export function surfaceLabel(surface: Surface): string {
  return SURFACE_CONFIG[surface].label;
}

export function pinnedSurfaces(pinned: readonly string[]): Surface[] {
  return filterPinned(pinned, PINNABLE_SURFACES) as Surface[];
}

export function pinnedSurfacesFor(
  pinned: readonly string[],
  openable: readonly Surface[],
): Surface[] {
  return pinnedSurfaces(pinned).filter((s) => openable.includes(s));
}

export function filterPinned(pinned: readonly string[], known: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of pinned) {
    if (!known.includes(key)) continue;
    if (out.includes(key)) continue;
    out.push(key);
  }
  return out;
}
