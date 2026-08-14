// Getting an access token for a mailbox, whichever kind it is: one of the user's own
// accounts, or a mailbox they are a delegate of.
//
// One entry point for both, because treating them as one question is what shut the API route
// to a shared mailbox for so long. No OAuth token can exist for a mailbox nobody signs into,
// so anything that only knew about own accounts fell back to scraping Gmail's page — and that
// page cannot be reached without the /d/<token>/ part of the URL a drag does not carry. It
// came back as HTTP 403, or, when Gmail felt like phrasing it differently, as a page saying
// the message could not be found.
//
// Recovering from a refusal differs per kind and using the wrong one is silent: a delegated
// mailbox has no refresh token to force, and an own account has no relay entry to forget.

import {
  cacheEntry,
  isUsable,
  requestDelegatedToken,
  shouldTryAnotherRequester,
  type CachedToken,
  type DelegatedTokenOutcome,
} from '../delegation/delegated-token';
import { keyOf, manager, oauthTokens, profiles } from '../core/runtime';
import { GmailHttpError } from '../gmail/gmail-api';
import { accessTokenFor, forceRefresh } from './oauth-flow';
import { delegatedTokenUrl, oauthConfig } from './oauth-config';
import { clearRefreshFailure, markRefreshFailed } from './oauth-health-check';
import type { Profile } from '../windows/profile-view-manager';


//===========================
// Module state
//===========================

/** Tokens the relay handed out, per mailbox. They live an hour; without this every drag
 * would cost a fresh mint and a delegates-list read per mailbox. */
const delegatedTokens = new Map<string, CachedToken>();


//===========================
// Exported functions
//===========================

/** Whether this address is a mailbox reached by delegation rather than one of the user's own
 * accounts. Read from the profiles rather than guessed from the address, so a mailbox the
 * app does not know about is not quietly treated as delegated. */
export function isDelegatedMailbox(email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return profiles.some((p) => p.kind === 'delegated' && p.email.toLowerCase() === wanted);
}

/** The user's own accounts, active one first: it is the one the person was looking at, and
 * usually the one whose delegation (or discoverable mailbox list) they are thinking of.
 * Shared by every caller that asks the relay something on the user's behalf, so trying the
 * same account in the same order is not reimplemented per caller. */
export function requestersInOrder(): Profile[] {
  const active = manager?.activeKey();
  const own = profiles.filter((p) => p.kind === 'authuser');
  return [...own.filter((p) => keyOf(p) === active), ...own.filter((p) => keyOf(p) !== active)];
}

/**
 * A token for a mailbox that has none of its own, via the relay.
 *
 * The user's own accounts are tried, active one first, and the first token the relay grants
 * is used. That cannot widen anyone's access: the relay checks Google's delegation record on
 * every attempt, so trying is how the app finds the access you already have rather than how
 * it gets any. It also means a copy does not fail merely because the wrong tab was in front.
 *
 * Returns null with a reason, so the caller can report something truer than "Verbinding
 * verlopen" — which is what a delegated mailbox used to get, for an expiry it never had.
 */
export async function delegatedTokenFor(email: string): Promise<DelegatedTokenOutcome> {
  const url = delegatedTokenUrl();
  if (!url) return { ok: false, error: 'Relay voor gedelegeerde postvakken niet ingesteld' };

  const cached = delegatedTokens.get(email.toLowerCase());
  if (isUsable(cached, Date.now())) return { ok: true, token: cached!.accessToken };

  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return { ok: false, error: 'Koppeling niet ingesteld' };

  let lastError = 'Geen van je accounts heeft toegang tot dit postvak';
  for (const requester of requestersInOrder()) {
    const requesterToken = await accessTokenFor(cfg, oauthTokens, requester.email);
    if (!requesterToken) continue;
    const result = await requestDelegatedToken({ url, requesterToken, target: email });
    if (result.ok) {
      delegatedTokens.set(
        email.toLowerCase(),
        cacheEntry(result.accessToken, result.expiresIn, Date.now()),
      );
      console.log(`[delegated] ${requester.email} -> ${email}: granted`);
      return { ok: true, token: result.accessToken };
    }
    lastError = result.error;
    // Only a delegation refusal says nothing about the next account; everything else is
    // about the request or the relay, and asking again would just repeat it.
    if (!shouldTryAnotherRequester(result.status)) break;
  }
  return { ok: false, error: lastError };
}

/** Drops a cached relay token, for when Gmail rejects it. A delegation can be revoked while
 * a token from it is still inside its hour, and the cache would otherwise keep handing out
 * the dead one until it expired on the clock. */
export function forgetDelegatedToken(email: string): void {
  delegatedTokens.delete(email.toLowerCase());
}

/** What to tell someone whose mailbox Gmail would not let a token into.
 *
 * The two kinds fail for reasons that need different actions: an own account has a link that
 * can be renewed by reconnecting, a delegated mailbox has no link of its own and its access
 * is someone else's to grant. Whatever Google's own wording was, it is not this — it names an
 * OAuth credential and links to the developer console, which is a sentence for whoever built
 * the app and not for whoever is trying to file an e-mail. */
export function mailboxRefusedText(email: string): string {
  return isDelegatedMailbox(email) ? 'Geen toegang tot dit postvak' : 'Verbinding verlopen';
}

/** A token for a mailbox, whichever kind it is. */
export async function mailboxToken(email: string): Promise<DelegatedTokenOutcome> {
  if (isDelegatedMailbox(email)) return delegatedTokenFor(email);
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return { ok: false, error: 'Niet gekoppeld' };
  const token = await accessTokenFor(cfg, oauthTokens, email);
  return token ? { ok: true, token } : { ok: false, error: 'Verbinding verlopen' };
}

/** A token for a mailbox after Gmail refused the one it had, whichever kind it is. */
export async function freshTokenAfter401(email: string): Promise<string | null> {
  if (isDelegatedMailbox(email)) {
    forgetDelegatedToken(email);
    const again = await delegatedTokenFor(email);
    return again.ok ? again.token : null;
  }
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  const fresh = await forceRefresh(cfg, oauthTokens, email);
  if (!fresh) {
    // Only an own account can have a link that expired, so only it may be flagged for one.
    markRefreshFailed(email);
    return null;
  }
  clearRefreshFailure(email);
  return fresh;
}

/**
 * The access-token dance for any mailbox: use the token it has, and on a 401 recover the way
 * that mailbox can and try once more.
 *
 * Null means no token can be had at all, which tells the caller this mailbox has no API route
 * rather than that the API failed.
 */
export async function withMailboxToken(
  email: string,
): Promise<(<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null> {
  const first = await mailboxToken(email);
  if (!first.ok) return null;
  let token = first.token;
  // Once per runner, not per call: a token that is still refused after a fresh mint is refused
  // for a reason no amount of reminting changes, and a label drag is hundreds of calls.
  let mayRecover = true;
  return async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(token);
    } catch (e) {
      if (!mayRecover || !(e instanceof GmailHttpError) || e.status !== 401) throw e;
      mayRecover = false;
      const fresh = await freshTokenAfter401(email);
      if (!fresh) throw e;
      token = fresh;
      return await fn(fresh);
    }
  };
}

/**
 * The access-token dance for one of the user's own accounts: use what we have, and on a 401
 * force a refresh and try once more.
 *
 * Kept apart from withMailboxToken because this one mints a token per call rather than
 * holding one — the sync runners and the toast actions reuse the returned function long after
 * the token they started with expired.
 */
export function withTokenFor(
  email: string,
): (<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null {
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return null;
  return async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await accessTokenFor(cfg, oauthTokens!, email);
    if (!token) throw new Error('no token');
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof GmailHttpError) || e.status !== 401) throw e;
      const fresh = await forceRefresh(cfg, oauthTokens!, email);
      if (!fresh) {
        markRefreshFailed(email);
        throw e;
      }
      clearRefreshFailure(email);
      return await fn(fresh);
    }
  };
}
