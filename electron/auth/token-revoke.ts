// Revokes a Gmail account's refresh token at Google when the account is unlinked, so a
// token file that leaked after unlinking no longer grants anything at Google's end. This
// is best-effort: unlinking itself is a local operation and must succeed without it.

import { postForm } from './oauth-flow';
import { REVOKE_ENDPOINT, revokeBody } from './google-oauth';


//===========================
// Types
//===========================

export type RevokeOutcome =
  | { ok: true }
  | { ok: false; alreadyGone: true } // Google says the token is unknown/expired
  | { ok: false; alreadyGone: false; error: string };


//===========================
// Exported functions
//===========================

/**
 * Asks Google to forget the grant
 *
 * @param refreshToken
 * @returns the outcome; never throws, so it never blocks unlinking
 */
export async function revokeRefreshToken(refreshToken: string): Promise<RevokeOutcome> {
  if (!refreshToken.trim()) return { ok: false, alreadyGone: true };

  try {
    await postForm(REVOKE_ENDPOINT, revokeBody(refreshToken));
    return { ok: true };
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('invalid_token')) return { ok: false, alreadyGone: true };
    return { ok: false, alreadyGone: false, error: message };
  }
}
