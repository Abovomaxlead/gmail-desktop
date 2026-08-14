// tests/relay-url.test.ts
// Which relay URL the app may call. Every call to the relay carries a live Google access
// token in a header, and the token the relay hands back reaches mail — so the rule is about
// the credential, and it has to hold for both endpoints. It did not: the mailboxes endpoint
// refused plain http off loopback and the token endpoint, whose answer carries gmail.modify,
// validated nothing at all.

import { describe, expect, it } from 'vitest';
import { chooseRelayUrl, parseRelayUrl } from '../electron/delegation/relay-url';

describe('the configured url', () => {
  it('accepts https', () => {
    expect(parseRelayUrl('https://relay.example.nl/delegated/token')).toBe(
      'https://relay.example.nl/delegated/token',
    );
  });

  // The request carries a live Google access token, which is the same reason push refuses
  // plain ws:// off-machine.
  it('refuses plain http off-machine', () => {
    expect(parseRelayUrl('http://relay.example.nl/delegated/token')).toBeNull();
  });

  it('allows plain http on loopback, so a local relay can be tested', () => {
    expect(parseRelayUrl('http://127.0.0.1:8098/delegated/token')).toBe(
      'http://127.0.0.1:8098/delegated/token',
    );
    expect(parseRelayUrl('http://localhost:8098/delegated/token')).toBe(
      'http://localhost:8098/delegated/token',
    );
    expect(parseRelayUrl('http://[::1]:8098/delegated/token')).toBe('http://[::1]:8098/delegated/token');
  });

  it('treats absent, blank and unparseable alike', () => {
    expect(parseRelayUrl(undefined)).toBeNull();
    expect(parseRelayUrl('  ')).toBeNull();
    expect(parseRelayUrl('not a url')).toBeNull();
    expect(parseRelayUrl(42)).toBeNull();
  });

  // A host that merely ends in a loopback name is not loopback, and neither is a scheme we
  // have no opinion about.
  it('does not mistake a lookalike host or another scheme for loopback', () => {
    expect(parseRelayUrl('http://localhost.evil.example/delegated/token')).toBeNull();
    expect(parseRelayUrl('http://127.0.0.1.evil.example/delegated/token')).toBeNull();
    expect(parseRelayUrl('ftp://127.0.0.1/delegated/token')).toBeNull();
    expect(parseRelayUrl('file:///delegated/token')).toBeNull();
  });
});

describe('which source wins', () => {
  it('takes the environment over the file', () => {
    expect(
      chooseRelayUrl('http://127.0.0.1:8098/delegated/token', 'https://relay.example.nl/delegated/token'),
    ).toBe('http://127.0.0.1:8098/delegated/token');
  });

  it('falls back to the file when the environment is unset or blank', () => {
    expect(chooseRelayUrl(undefined, 'https://relay.example.nl/delegated/token')).toBe(
      'https://relay.example.nl/delegated/token',
    );
    expect(chooseRelayUrl('   ', 'https://relay.example.nl/delegated/token')).toBe(
      'https://relay.example.nl/delegated/token',
    );
  });

  // The point of the order. An override that is set was set on purpose, so a mistake in it
  // has to surface as "no relay configured" rather than as a silent fall back to production —
  // which is the failure that looks like it worked.
  it('does not fall back to the file when the environment is set but unusable', () => {
    expect(chooseRelayUrl('http://relay.example.nl/delegated/token', 'https://relay.example.nl/x')).toBeNull();
    expect(chooseRelayUrl('not a url', 'https://relay.example.nl/x')).toBeNull();
  });

  it('is null when neither source has anything usable', () => {
    expect(chooseRelayUrl(undefined, undefined)).toBeNull();
    expect(chooseRelayUrl('', null)).toBeNull();
  });
});
