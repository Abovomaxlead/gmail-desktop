// tests/beta-access.test.ts
// Asking the relay whether this person may have betas, and folding one answer per own account
// into one. The shape of the answer is not trusted: it decides which releases the app installs
// by itself, and every way of failing to get an answer has to read as doubt rather than as a
// refusal -- a broken deploy that read as "no" would take the channel away from every tester
// at once.

import { describe, expect, it } from 'vitest';
import { betaVerdict, requestBetaAccess } from '../electron/updates/beta-access';

const URL = 'https://relay.example.nl/beta-access';

function answering(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('requestBetaAccess', () => {
  it('carries the requester token, because the relay derives the address from it', async () => {
    let seen: HeadersInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen = init.headers;
      return new Response(JSON.stringify({ beta: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await requestBetaAccess({ url: URL, requesterToken: 'ya29.token', fetch: fetchImpl });

    expect(res).toEqual({ ok: true, beta: true });
    expect(seen).toEqual({ authorization: 'Bearer ya29.token' });
  });

  it('reads a refusal as an answer, not as a failure', async () => {
    const res = await requestBetaAccess({
      url: URL,
      requesterToken: 't',
      fetch: answering({ beta: false }),
    });
    expect(res).toEqual({ ok: true, beta: false });
  });

  it('reports the relay refusing to answer', async () => {
    const res = await requestBetaAccess({
      url: URL,
      requesterToken: 't',
      fetch: answering({ error: 'not in this domain' }, 403),
    });
    expect(res).toEqual({ ok: false, status: 403, error: 'not in this domain' });
  });

  it('names the status when the refusal carries no words', async () => {
    const res = await requestBetaAccess({
      url: URL,
      requesterToken: 't',
      fetch: answering({}, 404),
    });
    expect(res).toEqual({ ok: false, status: 404, error: 'HTTP 404' });
  });

  // A 200 with nothing usable in it is a relay that failed to decide. Reading a missing field
  // as false is what would turn one bad deploy into everybody losing their channel.
  it('treats a 200 without a boolean as no answer at all', async () => {
    const res = await requestBetaAccess({
      url: URL,
      requesterToken: 't',
      fetch: answering({ beta: 'yes' }),
    });
    expect(res.ok).toBe(false);
  });

  it('treats an unreachable relay as no answer', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;

    const res = await requestBetaAccess({ url: URL, requesterToken: 't', fetch: fetchImpl });

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ status: 0 });
  });
});

describe('betaVerdict', () => {
  // One membership is the whole answer: the group holds addresses and this app holds several.
  it('grants access when any account is a tester', () => {
    expect(
      betaVerdict([
        { ok: true, beta: false },
        { ok: true, beta: true },
      ]),
    ).toBe(true);
  });

  it('refuses when every account that answered is not a tester', () => {
    expect(betaVerdict([{ ok: true, beta: false }])).toBe(false);
  });

  // An account that could not be asked leaves no entry; a relay that refused leaves a failure.
  // Neither is the group saying no, so the verdict stays open and the channel is left alone.
  it('stays undecided when nothing answered', () => {
    expect(betaVerdict([])).toBeUndefined();
    expect(betaVerdict([{ ok: false, status: 0, error: 'Relay niet bereikbaar' }])).toBeUndefined();
  });

  // One live answer is enough to decide, even beside accounts that could not be reached.
  it('decides on the answers it has, ignoring the failures beside them', () => {
    expect(
      betaVerdict([
        { ok: false, status: 500, error: 'boom' },
        { ok: true, beta: true },
      ]),
    ).toBe(true);
  });
});
