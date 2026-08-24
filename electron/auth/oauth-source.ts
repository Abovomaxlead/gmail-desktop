// Which of the possible OAuth configs the app should use: the hand-placed one in userData
// wins, the copy a write left beside it comes next, and the copy shipped inside the app is
// the floor under both.
//
// An unusable userData config falls through rather than killing linking, since that file is
// hand-edited and a stray comma used to cost the app all of its linking.

import { checkOAuthConfigFile } from './oauth-config-file';

/**
 * Picks the OAuth config the app should run on
 *
 * @param candidates raw texts in order of precedence, each one possibly null
 * @returns the first usable text, or null when none of them is
 */
export function chooseOAuthConfigText(...candidates: (string | null)[]): string | null {
  for (const text of candidates) {
    if (text !== null && checkOAuthConfigFile(text).ok) return text;
  }
  return null;
}
