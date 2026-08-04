// Where a Google app opens when clicked: in the app, in its own window, or in the
// system browser. Three named destinations rather than a boolean per setting, so no
// caller has to recompute the precedence and reach a different answer than the one
// next to it.
//
// The decision itself and the pinned-app filtering live in
// renderer/lib/google-apps.ts, because the bar needs them too and Next.js compiles
// nothing outside renderer/; these functions only keep the names the main process
// knows them by. Filtering matters because prefs.json outlives the app version: a
// pinned key for an app a later release removed would leave an empty button or throw
// in SURFACE_CONFIG[key]. `import type` for prefs-store keeps this file off the
// filesystem and out of an import cycle.

import type { GoogleAppsPrefs } from './prefs-store';
import { filterPinned } from '../renderer/lib/google-apps';

export type { GoogleAppTarget } from '../renderer/lib/google-apps';
export { googleAppTarget } from '../renderer/lib/google-apps';

export function pinnedSurfaces(pinned: readonly string[], known: readonly string[]): string[] {
  return filterPinned(pinned, known);
}
