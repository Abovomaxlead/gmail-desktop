// Reading a version string the way semver does, for the one question both processes ask of
// it: is this a prerelease? Shared rather than duplicated, because the main process decides
// which releases to offer and the settings panel explains that decision back to the user.

/**
 * Tells whether a version carries a prerelease component
 *
 * @param version as written in package.json, so no leading 'v'
 * @returns true for '0.3.1-beta.13', false for '0.3.1' and for build metadata alone
 */
export function hasPrereleaseTag(version: string): boolean {
  // Build metadata comes after '+' and never makes a version a prerelease: semver orders
  // 0.3.1+20260824 as plain 0.3.1.
  const core = version.trim().split('+')[0];
  const dash = core.indexOf('-');
  return dash > 0 && core.slice(dash + 1).length > 0;
}
