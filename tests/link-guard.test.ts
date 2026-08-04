import { describe, it, expect } from 'vitest';
import { hostOf, isTrustedHost, needsLinkConfirm } from '../electron/link-guard';

describe('hostOf', () => {
  it('lowercases the host', () => {
    expect(hostOf('https://Example.COM/path?q=1')).toBe('example.com');
  });
  it('is null for something that is not a URL', () => {
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf('')).toBeNull();
  });
  // Een mailto: heeft geen host om te laten zien, dus er valt niets te vragen.
  it('is null for a scheme without a host', () => {
    expect(hostOf('mailto:iemand@example.com')).toBeNull();
  });
});

describe('isTrustedHost', () => {
  it('matches exactly', () => {
    expect(isTrustedHost('example.com', ['example.com'])).toBe(true);
    expect(isTrustedHost('example.com', ['other.com'])).toBe(false);
  });

  it('covers subdomains of a trusted host', () => {
    expect(isTrustedHost('mail.example.com', ['example.com'])).toBe(true);
    expect(isTrustedHost('a.b.example.com', ['example.com'])).toBe(true);
  });

  // Dit is waarom de vergelijking op ".host" eindigt en geen `includes` is: een
  // aanvaller registreert example.com.phish.test juist omdat het er goed uitziet.
  it('does not trust a host that merely contains a trusted one', () => {
    expect(isTrustedHost('example.com.phish.test', ['example.com'])).toBe(false);
    expect(isTrustedHost('notexample.com', ['example.com'])).toBe(false);
  });

  it('ignores case, surrounding spaces and a leading dot in the list', () => {
    expect(isTrustedHost('MAIL.Example.com', ['  .Example.COM '])).toBe(true);
  });

  it('ignores empty entries instead of trusting everything', () => {
    expect(isTrustedHost('example.com', ['', '   '])).toBe(false);
  });
});

describe('needsLinkConfirm', () => {
  const on = { confirmExternalLinks: true, trustedHosts: [] as string[] };

  // De standaard: de bescherming staat uit, en dan verandert er niets aan de weg
  // die een link vandaag al aflegt.
  it('asks nothing while the setting is off', () => {
    expect(needsLinkConfirm('https://example.com', { ...on, confirmExternalLinks: false })).toBe(false);
  });

  it('asks for an untrusted host', () => {
    expect(needsLinkConfirm('https://example.com/a', on)).toBe(true);
  });

  it('stays quiet for a trusted host and its subdomains', () => {
    const state = { confirmExternalLinks: true, trustedHosts: ['example.com'] };
    expect(needsLinkConfirm('https://example.com/a', state)).toBe(false);
    expect(needsLinkConfirm('https://mail.example.com/a', state)).toBe(false);
  });

  // Zonder host is er niets om te laten zien, en een vraag zonder antwoord erin
  // staat alleen maar in de weg.
  it('stays quiet when there is no host to show', () => {
    expect(needsLinkConfirm('mailto:iemand@example.com', on)).toBe(false);
    expect(needsLinkConfirm('rommel', on)).toBe(false);
  });
});
