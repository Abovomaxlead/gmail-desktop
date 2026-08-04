// Which Google apps can be pinned to the bar, and where each app opens. The order
// of the checks in googleAppTarget is the decision: a per-app exception beats the
// master switch, and the master switch beats alwaysNewWindow. filterPinned drops
// unknown and duplicate keys, since prefs may name an app a later version removed.
// electron/google-apps-open.ts re-exports these so main and the bar agree.

import { APP_SURFACES, SURFACE_CONFIG, type Surface } from './surfaces';

export const PINNABLE_SURFACES: readonly Surface[] = ['calendar', ...APP_SURFACES];

export type GoogleAppTarget = 'in-app' | 'new-window' | 'external';

export function googleAppTarget(
  surface: string,
  prefs: { openInApp: boolean; alwaysNewWindow: boolean; excluded: readonly string[] },
): GoogleAppTarget {
  if (prefs.excluded.includes(surface)) return 'external';
  if (!prefs.openInApp) return 'external';
  if (prefs.alwaysNewWindow) return 'new-window';
  return 'in-app';
}

export function surfaceLabel(surface: Surface): string {
  return SURFACE_CONFIG[surface].label;
}

export function pinnedSurfaces(pinned: readonly string[]): Surface[] {
  return filterPinned(pinned, PINNABLE_SURFACES) as Surface[];
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
