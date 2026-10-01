// Whether the updater may offer prereleases, and nothing else.
//
// electron-updater decides this for itself in AppUpdater's constructor --
// `allowPrerelease = hasPrereleaseComponents(currentVersion)` -- so you received betas because
// you happened to be running one, and installing a stable build silently ended that with no
// way back in. That rule is gone: a beta reaches an installation because somebody asked for
// one, never because of the version it already carries.
//
// Which means the default is off, and betas are opt-in. Until the tester gate exists (a relay
// endpoint answering whether this account is in the tester group -- see the
// feature/beta-access-gate branch) the switch in Updates is the only thing standing between a
// user and an unfinished version, so it may not default to on for the installations that are
// on a beta today.
//
// The consequence is deliberate and visible: an install on a beta with the switch off is
// offered nothing until a finished version is published, and the Updates section says exactly
// that (prereleaseStuckOnBeta). A repository whose newest release is a prerelease has no
// /releases/latest at all, which arrives as an error and is reported as the no-release state
// rather than as a failure -- see update-error.ts.
//
// Not this module's job: refusing to go backwards. That is electron-updater's `allowDowngrade`,
// false by default, and update-controller sets it explicitly beside the flag this decides --
// worth knowing because the `channel` setter would quietly turn it on.


//===========================
// Exported functions
//===========================

/**
 * Whether prereleases may be offered
 *
 * @param chosen the user's setting, undefined when they have never touched it
 * @returns true only when the user asked for prereleases
 */
export function prereleaseAllowed(chosen: boolean | undefined): boolean {
  return chosen === true;
}
