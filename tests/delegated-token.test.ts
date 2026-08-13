// Tokens for mailboxes nobody signed into. A shared mailbox has no OAuth token of its own
// and never will, so the copy path used to ask the local store for something that could not
// be there and report "Verbinding verlopen" — an expiry message for a mailbox with nothing
// to expire. The token comes from the relay, which checks Google's delegation record first.

import { describe, expect, it } from 'vitest';
import {
  EXPIRY_MARGIN_MS,
  cacheEntry,
  isUsable,
  requestDelegatedToken,
  shouldTryAnotherRequester,
} from '../electron/delegation/delegated-token';

describe('the cache', () => {
  it('offers a fresh token', () => {
    expect(isUsable(cacheEntry('t', 3600, 1_000_000), 1_000_000)).toBe(true);
  });

  // The margin is the point: a token that dies between the check and the last message of a
  // long copy would fail halfway through, and nothing should have to reason about that.
  it('stops offering one within the margin of its expiry', () => {
    const now = 1_000_000;
    const entry = cacheEntry('t', 3600, now);
    expect(isUsable(entry, now + 3600_000 - EXPIRY_MARGIN_MS - 1)).toBe(true);
    expect(isUsable(entry, now + 3600_000 - EXPIRY_MARGIN_MS + 1)).toBe(false);
  });

  it('never offers a token whose lifetime was shorter than the margin', () => {
    const now = 5_000;
    expect(isUsable(cacheEntry('t', 30, now), now)).toBe(false);
  });

  it('never offers a nonsensical lifetime rather than caching it forever', () => {
    const now = 5_000;
    expect(isUsable(cacheEntry('t', Number.NaN, now), now)).toBe(false);
    expect(isUsable(cacheEntry('t', -1, now), now)).toBe(false);
  });

  it('treats an absent entry as unusable', () => {
    expect(isUsable(undefined, 0)).toBe(false);
  });
});

describe('when to ask with another of the user\'s accounts', () => {
  // 403 means this person is not a delegate of that mailbox, which says nothing about the
  // next person. Everything else says something about the request or the relay, and trying
  // again would multiply one failure by the number of accounts and report the last.
  it('retries only a delegation refusal', () => {
    expect(shouldTryAnotherRequester(403)).toBe(true);
    expect(shouldTryAnotherRequester(401)).toBe(false);
    expect(shouldTryAnotherRequester(400)).toBe(false);
    expect(shouldTryAnotherRequester(502)).toBe(false);
    expect(shouldTryAnotherRequester(500)).toBe(false);
    expect(shouldTryAnotherRequester(0)).toBe(false);
  });
});

const ok = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
const bad = (status: number, body: unknown) =>
  (async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;

const deps = (f: typeof globalThis.fetch) => ({
  url: 'http://127.0.0.1:8099/delegated/token',
  requesterToken: 'caller',
  target: 'support@example.nl',
  fetch: f,
});

describe('requestDelegatedToken', () => {
  it('returns the token and its lifetime', async () => {
    const r = await requestDelegatedToken(deps(ok({ accessToken: 'ya29.x', expiresIn: 3599 })));
    expect(r).toEqual({ ok: true, accessToken: 'ya29.x', expiresIn: 3599 });
  });

  it('defaults the lifetime when the relay omits it', async () => {
    const r = await requestDelegatedToken(deps(ok({ accessToken: 'ya29.x' })));
    expect(r.ok && r.expiresIn).toBe(3600);
  });

  // The relay's refusals are already sentences; passing them through means the person sees
  // "requester is not an accepted delegate of target" rather than "HTTP 403".
  it('passes the relay\'s own reason through with its status', async () => {
    const r = await requestDelegatedToken(
      deps(bad(403, { error: 'requester is not an accepted delegate of target' })),
    );
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: 'requester is not an accepted delegate of target',
    });
  });

  it('falls back to the status when the relay says nothing useful', async () => {
    const r = await requestDelegatedToken(deps(bad(502, {})));
    expect(r).toMatchObject({ ok: false, status: 502, error: 'HTTP 502' });
  });

  // A 200 with no token would otherwise be cached as an empty string and fail every copy
  // afterwards with an authentication error nobody could trace back to here.
  it('refuses a success that carries no token', async () => {
    const r = await requestDelegatedToken(deps(ok({ expiresIn: 3599 })));
    expect(r.ok).toBe(false);
  });

  it('reports an unreachable relay as such, not as a refusal', async () => {
    const throwing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await requestDelegatedToken(deps(throwing));
    expect(r.ok).toBe(false);
    // status 0, so it is not mistaken for a delegation refusal and retried per account.
    expect(!r.ok && r.status).toBe(0);
    expect(!r.ok && shouldTryAnotherRequester(r.status)).toBe(false);
  });

  it('sends the target and the requester token the way the relay expects', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ accessToken: 't', expiresIn: 1 }) };
    }) as unknown as typeof fetch;
    await requestDelegatedToken(deps(spy));
    expect(seen.url).toBe('http://127.0.0.1:8099/delegated/token');
    expect((seen.init?.headers as Record<string, string>).authorization).toBe('Bearer caller');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ target: 'support@example.nl' });
  });
});
