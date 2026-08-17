// Access tokens for mailboxes nobody signed into, which therefore have no OAuth token of
// their own.
//
// The relay mints them: it holds the domain-wide service account key the app must never
// contain, and checks Google's delegation record before handing anything over. So the app
// does not decide who may reach what — it asks, and is told. Tokens live an hour and are
// cached per mailbox, or every drag would cost a fresh mint and a delegates-list read.



//===========================
// Constants
//===========================

// Stop offering a token this long before it actually dies. A token that expires between the
// check and the last message of a long copy would fail halfway, and the point of the margin
// is that nothing has to reason about that.
export const EXPIRY_MARGIN_MS = 60_000;

// How long the relay may take to answer before the ask is given up on. It mints a token
// against Google, so it is allowed to be slow; it is not allowed to be silent.
export const RELAY_TIMEOUT_MS = 20_000;


//===========================
// Types
//===========================

export interface CachedToken {
  accessToken: string;
  usableUntil: number;
}

/** Discriminated on `ok` rather than on the token being present: a union told apart by a
 * string field cannot be narrowed, because an empty string is falsy and the compiler has to
 * keep both possibilities alive. */
export type DelegatedTokenOutcome =
  | { ok: true; token: string }
  /** `error` is already a sentence, usually the relay's own words. */
  | { ok: false; error: string };


//===========================
// Exported functions
//===========================

/**
 * Whether a cached token may still be handed out
 *
 * @param entry
 * @param now epoch ms
 * @returns true while the entry is inside its usable window
 */
export function isUsable(entry: CachedToken | undefined, now: number): boolean {
  return entry !== undefined && entry.usableUntil > now;
}

/**
 * Builds the cache entry for a token the relay just granted
 *
 * @param accessToken
 * @param expiresInSeconds as the relay reported it
 * @param now epoch ms
 * @returns the entry, its window shortened by EXPIRY_MARGIN_MS
 */
export function cacheEntry(accessToken: string, expiresInSeconds: number, now: number): CachedToken {
  const lifetime = Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 0;
  return {
    accessToken,
    usableUntil: now + Math.max(0, lifetime - EXPIRY_MARGIN_MS),
  };
}

/**
 * Whether the relay's refusal is worth retrying as a different account
 *
 * @param status the relay's HTTP status
 * @returns true for 403 only
 */
export function shouldTryAnotherRequester(status: number): boolean {
  return status === 403;
}

export interface DelegatedTokenDeps {
  url: string;
  requesterToken: string;
  target: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Asks the relay for an access token for a delegated mailbox
 *
 * @param deps no caching happens here; the caller owns the cache and the clock
 * @returns the token and its lifetime, or why the relay refused
 */
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
      signal: AbortSignal.timeout(deps.timeoutMs ?? RELAY_TIMEOUT_MS),
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
