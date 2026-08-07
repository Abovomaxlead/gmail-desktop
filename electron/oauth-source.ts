// Which of the two possible OAuth configs the app should use.
//
// There are two because a colleague installed the app and could not link anything: the
// config holds the client credentials and lived only in userData, put there by hand, so a
// fresh machine had none and every path that needed it gave up quietly. A copy now ships
// inside the app, which is the normal arrangement for a desktop OAuth client — the flow is
// PKCE with a loopback redirect, where Google does not treat the client secret as
// confidential, because a secret inside a distributed binary cannot be one.
//
// Two rules, and the second is the one worth stating:
//
//   1. userData wins. A machine that was set up by hand, or pointed at a different Google
//      project, or given a config through the panel's import button, keeps what it was
//      given. The shipped copy is a floor, not an override.
//
//   2. An unusable userData config falls through to the shipped one rather than killing
//      linking. The file is hand-editable and hand-copied, so a truncated copy or a stray
//      comma is a real way to arrive here — and the failure it used to cause was total and
//      silent. Falling through means a broken local file costs you your own project's
//      settings, not the ability to use the app at all. Anyone who wants their own config
//      back can see it is not in effect and re-import it.
//
// Both inputs are raw file text, so this stays testable without a filesystem, and callers
// hand the winner to the same parsers they already used.

import { checkOAuthConfigFile } from './oauth-config-file';

/** The config text to use, or null when neither source has a usable one. */
export function chooseOAuthConfigText(
  fromUserData: string | null,
  fromBundle: string | null,
): string | null {
  if (fromUserData !== null && checkOAuthConfigFile(fromUserData).ok) return fromUserData;
  if (fromBundle !== null && checkOAuthConfigFile(fromBundle).ok) return fromBundle;
  return null;
}
