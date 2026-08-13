// Whether an external link needs confirming, and which hosts are trusted.

import { describe, it, expect } from 'vitest';
import {
  hostOf,
  isTrustedHost,
  isGoogleAppHost,
  needsLinkConfirm,
  unwrapRedirect,
} from '../electron/system/link-guard';

describe('hostOf', () => {
  it('lowercases the host', () => {
    expect(hostOf('https://Example.COM/path?q=1')).toBe('example.com');
  });
  it('is null for something that is not a URL', () => {
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf('')).toBeNull();
  });
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

describe('unwrapRedirect', () => {
  it('pulls the destination out of the wrapper Gmail puts around every link', () => {
    expect(
      unwrapRedirect('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa&source=gmail'),
    ).toBe('https://example.com/a');
  });

  it('reads the url parameter as well as q', () => {
    expect(unwrapRedirect('https://google.com/url?url=https%3A%2F%2Fexample.com%2Fb')).toBe(
      'https://example.com/b',
    );
  });

  it('leaves a link that is not wrapped alone', () => {
    expect(unwrapRedirect('https://example.com/a?q=https%3A%2F%2Fother.test')).toBe(
      'https://example.com/a?q=https%3A%2F%2Fother.test',
    );
  });

  it('does not unwrap another host that happens to have a /url path', () => {
    const url = 'https://phish.test/url?q=https%3A%2F%2Fexample.com';
    expect(unwrapRedirect(url)).toBe(url);
  });

  it('keeps the wrapper when it carries no usable destination', () => {
    const url = 'https://www.google.com/url?source=gmail';
    expect(unwrapRedirect(url)).toBe(url);
  });

  it('refuses a destination that is not http', () => {
    const url = 'https://www.google.com/url?q=javascript%3Aalert(1)';
    expect(unwrapRedirect(url)).toBe(url);
  });

  it('unwraps a wrapper hiding inside a wrapper', () => {
    const inner = encodeURIComponent('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fc');
    expect(unwrapRedirect(`https://www.google.com/url?q=${inner}`)).toBe('https://example.com/c');
  });

  it('hands back anything that is not a URL untouched', () => {
    expect(unwrapRedirect('rommel')).toBe('rommel');
  });
});

describe('needsLinkConfirm', () => {
  const on = { confirmExternalLinks: true, trustedHosts: [] as string[] };

  it('judges the destination behind the wrapper, not the wrapper itself', () => {
    expect(needsLinkConfirm('https://www.google.com/url?q=https%3A%2F%2Fphish.test%2Fa', on)).toBe(
      true,
    );
  });

  it('does not let a trusted google.com wave through every wrapped link', () => {
    const state = { confirmExternalLinks: true, trustedHosts: ['google.com'] };
    expect(
      needsLinkConfirm('https://www.google.com/url?q=https%3A%2F%2Fphish.test%2Fa', state),
    ).toBe(true);
  });

  it('stays quiet when the host behind the wrapper is trusted', () => {
    const state = { confirmExternalLinks: true, trustedHosts: ['example.com'] };
    expect(
      needsLinkConfirm('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa', state),
    ).toBe(false);
  });

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

  it('stays quiet when there is no host to show', () => {
    expect(needsLinkConfirm('mailto:iemand@example.com', on)).toBe(false);
    expect(needsLinkConfirm('rommel', on)).toBe(false);
  });

  it('never asks about the Google apps the app hosts itself', () => {
    expect(needsLinkConfirm('https://drive.google.com/drive/u/0/my-drive', on)).toBe(false);
    expect(needsLinkConfirm('https://docs.google.com/document/u/0/', on)).toBe(false);
    expect(needsLinkConfirm('https://calendar.google.com/calendar/u/0/r', on)).toBe(false);
    expect(needsLinkConfirm('https://keep.google.com/u/0/', on)).toBe(false);
    expect(needsLinkConfirm('https://mail.google.com/mail/u/0/', on)).toBe(false);
    expect(needsLinkConfirm('https://accounts.google.com/AddSession', on)).toBe(false);
  });

  it('still asks about other hosts under google.com', () => {
    expect(needsLinkConfirm('https://sites.google.com/view/iets', on)).toBe(true);
    expect(needsLinkConfirm('https://www.google.com/search?q=x', on)).toBe(true);
    expect(needsLinkConfirm('https://myaccount.google.com/', on)).toBe(true);
  });

  it('does not fall for a host that only looks like a Google app', () => {
    expect(needsLinkConfirm('https://drive.google.com.phish.test/', on)).toBe(true);
    expect(needsLinkConfirm('https://notdrive.google.com/', on)).toBe(true);
  });

  it('judges the destination behind the wrapper, even towards a Google app', () => {
    expect(
      needsLinkConfirm('https://www.google.com/url?q=https%3A%2F%2Fdrive.google.com%2Fx', on),
    ).toBe(false);
    expect(
      needsLinkConfirm('https://www.google.com/url?q=https%3A%2F%2Fphish.test%2Fx', on),
    ).toBe(true);
  });
});

describe('isGoogleAppHost', () => {
  it('knows the hosts the app hosts as a surface', () => {
    expect(isGoogleAppHost('drive.google.com')).toBe(true);
    expect(isGoogleAppHost('docs.google.com')).toBe(true);
    expect(isGoogleAppHost('accounts.google.com')).toBe(true);
  });

  it('matches on the whole host, never a suffix', () => {
    expect(isGoogleAppHost('drive.google.com.phish.test')).toBe(false);
    expect(isGoogleAppHost('a.drive.google.com')).toBe(false);
  });

  it('says no to the rest of google.com', () => {
    expect(isGoogleAppHost('sites.google.com')).toBe(false);
    expect(isGoogleAppHost('www.google.com')).toBe(false);
    expect(isGoogleAppHost('google.com')).toBe(false);
  });

  it('ignores case', () => {
    expect(isGoogleAppHost('Drive.Google.COM')).toBe(true);
  });
});
