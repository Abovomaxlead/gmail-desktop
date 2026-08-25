// Whether the updater may offer prereleases, and nothing else.
//
// electron-updater decides this for itself in AppUpdater's constructor --
// `allowPrerelease = hasPrereleaseComponents(currentVersion)` -- so today you receive betas
// because you happen to be running one, and installing a stable build silently ends that with
// no way back in. This turns it into something the user owns, while keeping the old rule as
// the answer for anyone who has never touched the setting.
//
// Not this module's job: refusing to go backwards. That is electron-updater's `allowDowngrade`,
// false by default, and update-controller sets it explicitly beside the flag this decides --
// worth knowing because the `channel` setter would quietly turn it on.

import { hasPrereleaseTag } from '../../renderer/lib/version';


//===========================
// Exported functions
//===========================

/**
 * Whether prereleases may be offered
 *
 * @param chosen the user's setting, undefined when they have never touched it
 * @param currentVersion the running app's version
 * @returns the choice when there is one, otherwise the rule that applied before the setting
 */
export function prereleaseAllowed(chosen: boolean | undefined, currentVersion: string): boolean {
  if (typeof chosen === 'boolean') return chosen;
  return hasPrereleaseTag(currentVersion);
}
