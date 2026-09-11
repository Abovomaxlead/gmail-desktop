// What a dead mail view shows. It replaces a page the user was reading, it names the mailbox
// that broke, and it is built by string concatenation from an address the app did not author --
// so the escaping is the part that has to hold.

import { describe, expect, it } from 'vitest';
import { viewCrashText, viewCrashUrl } from '../electron/windows/view-crash-page';

/** The document inside the data URL, as the view will parse it */
const documentOf = (url: string): string =>
  decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));

describe('viewCrashText', () => {
  it('speaks the language the app is in', () => {
    expect(viewCrashText('nl', false).title).toBe('Dit postvak reageert niet meer');
    expect(viewCrashText('en', false).title).toBe('This mailbox stopped responding');
  });

  it('lets Rene mode win over the locale, the way every other label set does', () => {
    expect(viewCrashText('en', true)).toBe(viewCrashText('nl', true));
  });

  it('says the mail itself is fine, which is the first thing anybody wonders', () => {
    expect(viewCrashText('nl', false).body).toContain('mail is niets gebeurd');
  });

  it('says what to do about it, in the place it went wrong', () => {
    expect(viewCrashText('nl', false).hint).toContain('Ctrl+R');
  });
});

describe('viewCrashUrl', () => {
  const text = viewCrashText('nl', false);

  it('is a document a view can load', () => {
    expect(viewCrashUrl(text, 'a@x.nl', false).startsWith('data:text/html;charset=utf-8,')).toBe(
      true,
    );
    expect(documentOf(viewCrashUrl(text, 'a@x.nl', false))).toContain('<!doctype html>');
  });

  it('names the mailbox that broke, since a window holds several', () => {
    expect(documentOf(viewCrashUrl(text, 'support@abovomaxlead.nl', false))).toContain(
      'support@abovomaxlead.nl',
    );
  });

  it('leaves the address out rather than showing an empty line', () => {
    expect(documentOf(viewCrashUrl(text, '', false))).not.toContain('class="mailbox"');
  });

  it('carries no script and nothing to fetch, so it cannot fail like the page it replaces', () => {
    const html = documentOf(viewCrashUrl(text, 'a@x.nl', false));
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\bsrc=|\bhref=/);
    expect(html).toContain("default-src 'none'");
  });

  it('cannot have markup pushed into it through the address', () => {
    const html = documentOf(viewCrashUrl(text, '"><script>alert(1)</script>', false));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('follows the theme, since it replaces a page that did', () => {
    expect(documentOf(viewCrashUrl(text, 'a@x.nl', true))).toContain('#202124');
    expect(documentOf(viewCrashUrl(text, 'a@x.nl', false))).toContain('#ffffff');
  });
});
