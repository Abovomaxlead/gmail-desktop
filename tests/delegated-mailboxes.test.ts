// tests/delegated-mailboxes.test.ts
// Which mailboxes this person may reach, answered by the relay. The Gmail API has no
// reverse lookup, so the app cannot work this out for itself; what it can do is refuse to
// send a live access token somewhere unencrypted, and refuse to believe an answer shaped
// wrong.

import { describe, expect, it } from 'vitest';
import { parseMailboxesUrl, requestDelegatedMailboxes } from '../electron/delegated-mailboxes';

const ok = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
const bad = (status: number, body: unknown) =>
  (async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;

const deps = (f: typeof globalThis.fetch) => ({
  url: 'https://relay.example.nl/delegated/mailboxes',
  requesterToken: 'caller',
  fetch: f,
});

describe('the configured url', () => {
  it('accepts https', () => {
    expect(parseMailboxesUrl('https://relay.example.nl/delegated/mailboxes')).toBe(
      'https://relay.example.nl/delegated/mailboxes',
    );
  });

  // The request carries a live Google access token, which is the same reason push refuses
  // plain ws:// off-machine.
  it('refuses plain http off-machine', () => {
    expect(parseMailboxesUrl('http://relay.example.nl/delegated/mailboxes')).toBeNull();
  });

  it('allows plain http on loopback, so a local relay can be tested', () => {
    expect(parseMailboxesUrl('http://127.0.0.1:8099/delegated/mailboxes')).toBe(
      'http://127.0.0.1:8099/delegated/mailboxes',
    );
    expect(parseMailboxesUrl('http://localhost:8099/delegated/mailboxes')).toBe(
      'http://localhost:8099/delegated/mailboxes',
    );
  });

  it('treats absent, blank and unparseable alike', () => {
    expect(parseMailboxesUrl(undefined)).toBeNull();
    expect(parseMailboxesUrl('  ')).toBeNull();
    expect(parseMailboxesUrl('not a url')).toBeNull();
    expect(parseMailboxesUrl(42)).toBeNull();
  });
});

describe('what the relay answers', () => {
  it('returns the mailboxes, lowercased', async () => {
    const res = await requestDelegatedMailboxes(
      deps(ok({ mailboxes: ['Support@Example.nl', 'bart@example.nl'], refreshedAt: 1754 })),
    );
    expect(res).toEqual({
      ok: true,
      mailboxes: ['support@example.nl', 'bart@example.nl'],
      refreshedAt: 1754,
    });
  });

  // A relay that answers 200 with something else is a bug on that side, and treating its
  // shape as trustworthy would put junk in the sidebar under the name of a mailbox.
  it('rejects entries that are not addresses', async () => {
    const res = await requestDelegatedMailboxes(
      deps(ok({ mailboxes: ['support@example.nl', '', 'nonsense', 42, null] })),
    );
    expect(res).toEqual({ ok: true, mailboxes: ['support@example.nl'], refreshedAt: 0 });
  });

  it('reports the relay\'s own words on a refusal', async () => {
    const res = await requestDelegatedMailboxes(deps(bad(403, { error: 'Niet toegestaan' })));
    expect(res).toEqual({ ok: false, status: 403, error: 'Niet toegestaan' });
  });

  it('falls back to the status when there is no message', async () => {
    const res = await requestDelegatedMailboxes(deps(bad(502, {})));
    expect(res).toEqual({ ok: false, status: 502, error: 'HTTP 502' });
  });

  it('survives a relay that is not there', async () => {
    const f = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await requestDelegatedMailboxes(deps(f));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(0);
  });
});
