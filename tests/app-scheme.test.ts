// The notification sounds were silent in every packaged build and audible in every
// development run, because the pages come from the Next dev server over http there and
// from app:// here — and app:// was registered without `stream`, which is the privilege
// Chromium's media loader checks before it will serve <audio> from a custom scheme.
// Without it the element fails with MEDIA_ELEMENT_ERROR code 4, which blames the mp3.
//
// A test cannot register a scheme without Electron, so what is asserted is the one thing
// that was wrong and would be silently correct-looking again if someone rewrote this
// object from the Electron docs' default example.

import { describe, expect, it } from 'vitest';
import { APP_SCHEME, APP_SCHEME_PRIVILEGES } from '../electron/app-scheme';

describe('app scheme privileges', () => {
  it('declares stream support, without which no sound can play in a packaged build', () => {
    expect(APP_SCHEME_PRIVILEGES.stream).toBe(true);
  });

  it('keeps the privileges the rest of the app already depends on', () => {
    expect(APP_SCHEME_PRIVILEGES.standard).toBe(true);
    expect(APP_SCHEME_PRIVILEGES.secure).toBe(true);
    expect(APP_SCHEME_PRIVILEGES.supportFetchAPI).toBe(true);
  });

  it('is the scheme the pages are actually loaded from', () => {
    expect(APP_SCHEME).toBe('app');
  });
});
