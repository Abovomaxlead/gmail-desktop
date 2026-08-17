// Which of the two possible OAuth configs the app should use: the hand-placed one in
// userData wins, and the copy shipped inside the app is the floor under it.
//
// An unusable userData config falls through to the shipped one rather than killing linking,
// since that file is hand-edited and a stray comma used to cost the app all of its linking.

import { checkOAuthConfigFile } from './oauth-config-file';

/**
 * Picks the OAuth config the app should run on
 *
 * @param fromUserData raw text of the hand-placed config, or null
 * @param fromBundle raw text of the shipped config, or null
 * @returns the winning text, or null when neither is usable
 */
export function chooseOAuthConfigText(
  fromUserData: string | null,
  fromBundle: string | null,
): string | null {
  if (fromUserData !== null && checkOAuthConfigFile(fromUserData).ok) return fromUserData;
  if (fromBundle !== null && checkOAuthConfigFile(fromBundle).ok) return fromBundle;
  return null;
}
