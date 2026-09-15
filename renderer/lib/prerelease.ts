// Whether the updater may offer prereleases, and nothing else.
//
// electron-updater decides this for itself in AppUpdater's constructor --
// `allowPrerelease = hasPrereleaseComponents(currentVersion)` -- so once you received betas
// because you happened to be running one, and installing a stable build silently ended that
// with no way back in. This turns it into something the user owns, within what the relay says
// they may have.
//
// Shared rather than duplicated, and here rather than under electron/ because the renderer
// cannot import from there: the main process sets the updater's flag from this, and the
// Updates section explains the same decision back to the user. Two copies of the rule is how
// a switch comes to show a channel the app is not on.
//
// Not this module's job: refusing to go backwards. That is electron-updater's
// `allowDowngrade`, false by default, and update-controller sets it explicitly beside the flag
// this decides -- worth knowing because the `channel` setter would quietly turn it on.

import { hasPrereleaseTag } from './version';


//===========================
// Exported functions
//===========================

/**
 * Whether prereleases may be offered
 *
 * @param chosen the user's setting, undefined when they have never touched it
 * @param currentVersion the running app's version
 * @param eligible the relay's answer about beta access, undefined while it has not answered.
 *   A refusal wins over the setting; doubt leaves the old rule alone, because an install that
 *   cannot ask is not an install that was told no.
 * @returns the choice when there is one, otherwise the rule that applied before the setting
 */
export function prereleaseAllowed(
  chosen: boolean | undefined,
  currentVersion: string,
  eligible: boolean | undefined,
): boolean {
  if (eligible === false) return false;
  if (typeof chosen === 'boolean') return chosen;
  return hasPrereleaseTag(currentVersion);
}
