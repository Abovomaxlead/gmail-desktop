// Access tokens for mailboxes nobody signed into.
//
// A shared mailbox like support@ has no OAuth token of its own and never will: nobody logs
// in as it, you reach it because its owner delegated it to you. So the copy path used to
// ask the local token store for a token that could not exist there, get null, and skip the
// account with "Verbinding verlopen" — a message about an expiry, for a mailbox that had
// nothing to expire.
//
// The token comes from the relay instead, which holds the domain-wide service account key
// the app must never contain, and which checks Google's own delegation record before
// handing anything over. The app therefore does not decide who may reach what; it asks, and
// is told.
//
// Which of your accounts does the asking is settled the same way. The app tries them —
// active one first — and takes the first token the relay grants. That cannot widen anyone's
// access, because every attempt is checked against the delegation record on the other side:
// trying is how the app discovers the access you already have, not how it gains any. It
// also means a copy does not fail merely because the wrong tab happened to be in front.
//
// Tokens live an hour, so they are cached per mailbox. Not caching them would mean a fresh
// consent-free mint and a delegates-list read for every mailbox on every drag, which is
// slow and pointlessly chatty against Google.

/** Refresh this many ms before the token actually dies. A token that expires between the
 * check and the last message of a long copy would fail halfway, and the whole point of the
 * margin is that nothing has to reason about that. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface CachedToken {
  accessToken: string;
  /** Epoch ms at which this stops being offered. */
  usableUntil: number;
}

/** Discriminated on `ok` rather than on the token being present: a union told apart by a
 * string field cannot be narrowed, because an empty string is falsy and the compiler has to
 * keep both possibilities alive. */
export type DelegatedTokenOutcome =
  | { ok: true; token: string }
  /** `error` is already a sentence, usually the relay's own words. */
  | { ok: false; error: string };

/** When a cached token may still be handed out. Separate and pure so the margin is testable
 * without a clock or a network. */
export function isUsable(entry: CachedToken | undefined, now: number): boolean {
  return entry !== undefined && entry.usableUntil > now;
}

export function cacheEntry(accessToken: string, expiresInSeconds: number, now: number): CachedToken {
  // A relay that reports a nonsensical lifetime should not produce a token cached forever,
  // nor one already expired: clamp to something a copy can actually use.
  const lifetime = Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 0;
  return {
    accessToken,
    usableUntil: now + Math.max(0, lifetime - EXPIRY_MARGIN_MS),
  };
}

/** How the relay's answer maps onto "try one of my other accounts".
 *
 * 403 is the only status worth retrying with a different requester: it means this person is
 * not a delegate of that mailbox, which says nothing about the next person. A 401 is about
 * the token we sent, a 400 is about the request itself, and anything 5xx is the relay or
 * Google — retrying those with another account would multiply one failure by the number of
 * accounts and report the last one, which is the least informative of them. */
export function shouldTryAnotherRequester(status: number): boolean {
  return status === 403;
}

export interface DelegatedTokenDeps {
  url: string;
  /** An access token for the account doing the asking. */
  requesterToken: string;
  target: string;
  fetch?: typeof fetch;
}

/** Asks the relay for a token for `target`. No caching here — the caller owns the cache,
 * because it also owns the clock. */
export async function requestDelegatedToken(
  deps: DelegatedTokenDeps,
): Promise<{ ok: true; accessToken: string; expiresIn: number } | { ok: false; status: number; error: string }> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(deps.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.requesterToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: deps.target }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Relay niet bereikbaar: ${(e as Error).message}` };
  }

  const json = (await res.json().catch(() => ({}))) as { accessToken?: unknown; expiresIn?: unknown; error?: unknown };
  if (!res.ok) {
    const error = typeof json.error === 'string' && json.error !== '' ? json.error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error };
  }
  if (typeof json.accessToken !== 'string' || json.accessToken === '') {
    return { ok: false, status: res.status, error: 'Relay gaf geen token terug' };
  }
  const expiresIn = typeof json.expiresIn === 'number' ? json.expiresIn : 3600;
  return { ok: true, accessToken: json.accessToken, expiresIn };
}
