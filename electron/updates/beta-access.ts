// Whether this person may be offered prereleases, asked of the relay rather than decided here.
//
// The list of testers cannot live in the app. A constant beside ALLOWED_EMAIL_DOMAINS would
// mean a release per tester added, which is the opposite of what a beta is for, and a list
// under userData is a text file the person it gates may edit. The relay already knows who is
// asking -- every call to it carries a live Google access token, and userinfo.email is in the
// scope set for exactly that reason (auth/google-oauth.ts:8) -- so it is the only place where
// the answer is both current and not the user's to write. It reads membership of a Google
// group with the domain-wide credentials it already holds, so adding a tester is a click in
// Groups and no deploy at all.
//
// What this is not: a lock. The releases are public (electron-builder.yml:11), so a beta
// installer whose URL somebody has stays installable, and a build already on a beta stays on
// it -- allowDowngrade is false. This decides what the app offers and fetches by itself.
//
// Doubt is not a refusal. A relay that cannot be reached, an account with no usable token, a
// 404 because the endpoint is not deployed yet: none of those are the relay saying no, and
// they leave the channel exactly as it was before this module existed.


//===========================
// Types
//===========================

export interface BetaAccessDeps {
  url: string;
  requesterToken: string;
  fetch?: typeof fetch;
}

/** `ok: false` covers every way an answer did not arrive. Only a 200 with a boolean in it is
 * the relay speaking about this person. */
export type BetaAccessOutcome =
  | { ok: true; beta: boolean }
  | { ok: false; status: number; error: string };


//===========================
// Exported functions
//===========================

/**
 * Asks the relay whether the requester is a beta tester
 *
 * @param deps the endpoint and the requester's own access token; the relay derives the
 *   address from the token, so nothing about who is asking travels in the request
 * @returns the verdict for this one account, or why there is none
 */
export async function requestBetaAccess(deps: BetaAccessDeps): Promise<BetaAccessOutcome> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(deps.url, {
      headers: { authorization: `Bearer ${deps.requesterToken}` },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Relay niet bereikbaar: ${(e as Error).message}` };
  }

  const json = (await res.json().catch(() => ({}))) as { beta?: unknown; error?: unknown };
  if (!res.ok) {
    const error =
      typeof json.error === 'string' && json.error !== '' ? json.error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error };
  }
  // A 200 whose body says nothing is the relay failing to answer, not a refusal: reading a
  // missing field as "no" would turn a broken deploy into every tester losing their channel.
  if (typeof json.beta !== 'boolean') {
    return { ok: false, status: res.status, error: 'Relay gaf geen antwoord over betatoegang' };
  }
  return { ok: true, beta: json.beta };
}

/**
 * Folds one answer per own account into the one thing the updater needs
 *
 * Asked as every own account because the group holds addresses and this app holds several;
 * one membership is the whole answer, the same way one delegation grant ends the token walk.
 *
 * @param answers one per account that could be asked, in the order they were asked
 * @returns true when an account is a tester, false when every account that answered is not,
 *   and undefined when nothing answered -- doubt, which leaves the channel alone
 */
export function betaVerdict(answers: readonly BetaAccessOutcome[]): boolean | undefined {
  if (answers.some((a) => a.ok && a.beta)) return true;
  if (answers.some((a) => a.ok)) return false;
  return undefined;
}
