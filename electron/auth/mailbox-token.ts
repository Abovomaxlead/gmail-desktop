// Getting an access token for a mailbox, whichever kind it is: one of the user's own
// accounts, or a mailbox they are a delegate of.

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

const delegatedTokens = new Map<string, CachedToken>();


//===========================
// Exported functions
//===========================

export function isDelegatedMailbox(email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return profiles.some((p) => p.kind === 'delegated' && p.email.toLowerCase() === wanted);
}

export function requestersInOrder(): Profile[] {
  const active = manager?.activeKey();
  const own = profiles.filter((p) => p.kind === 'authuser');
  return [...own.filter((p) => keyOf(p) === active), ...own.filter((p) => keyOf(p) !== active)];
}

/**
 * A token for a mailbox that has none of its own, via the relay
 *
 * Every own account is tried in turn; the relay re-checks Google's delegation record each
 * time, so trying widens nobody's access.
 *
 * @param email the mailbox to get a token for
 * @returns the token, or a reason the caller can report as itself
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
    if (!shouldTryAnotherRequester(result.status)) break;
  }
  return { ok: false, error: lastError };
}

export function forgetDelegatedToken(email: string): void {
  delegatedTokens.delete(email.toLowerCase());
}

export function mailboxRefusedText(email: string): string {
  return isDelegatedMailbox(email) ? 'Geen toegang tot dit postvak' : 'Verbinding verlopen';
}

export async function mailboxToken(email: string): Promise<DelegatedTokenOutcome> {
  if (isDelegatedMailbox(email)) return delegatedTokenFor(email);
  const cfg = oauthConfig();
  if (!cfg || !oauthTokens) return { ok: false, error: 'Niet gekoppeld' };
  const token = await accessTokenFor(cfg, oauthTokens, email);
  return token ? { ok: true, token } : { ok: false, error: 'Verbinding verlopen' };
}

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
    markRefreshFailed(email);
    return null;
  }
  clearRefreshFailure(email);
  return fresh;
}

/**
 * Runs calls against a mailbox, recovering once from a 401 the way that mailbox can
 *
 * @param email the mailbox to run against
 * @returns a runner, or null when no token can be had at all — meaning no API route exists
 *   for this mailbox, not that the API failed
 */
export async function withMailboxToken(
  email: string,
): Promise<(<T>(fn: (token: string) => Promise<T>) => Promise<T>) | null> {
  const first = await mailboxToken(email);
  if (!first.ok) return null;
  let token = first.token;
  // once per runner, not per call: a label drag is hundreds of calls
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
 * Runs calls against one of the user's own accounts, forcing a refresh once on a 401
 *
 * Mints per call rather than holding a token, because the sync runners and toast actions
 * reuse the returned function long after the token they started with expired.
 *
 * @param email the account to run against
 * @returns a runner, or null when the app is not linked at all
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
