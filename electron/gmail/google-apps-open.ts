// Where a Google app opens when clicked: in the app, in its own window, or in the system
// browser. Three named destinations rather than a boolean per setting, so no two callers
// recompute the precedence differently.
//
// The decision itself lives in renderer/lib/google-apps.ts, because the bar needs it too and
// Next.js compiles nothing outside renderer/; these only keep the names main knows.

import type { GoogleAppsPrefs } from '../core/prefs-store';
import { filterPinned } from '../../renderer/lib/google-apps';

export type { GoogleAppTarget } from '../../renderer/lib/google-apps';
export { googleAppTarget } from '../../renderer/lib/google-apps';

/**
 * Keeps only the pinned apps this build still knows
 *
 * @param pinned the keys out of prefs.json, which outlives the app version
 * @param known the surface keys this build has
 * @returns the pinned keys that can still be drawn
 */
export function pinnedSurfaces(pinned: readonly string[], known: readonly string[]): string[] {
  return filterPinned(pinned, known);
}
