// tests/prerelease.test.ts
// Which releases the updater is allowed to offer: the rule for a user who has never touched
// the setting, and the relay's word over both of them. The relay is the only thing that can
// decide who is a tester -- a list in the app would be a release per tester and a file the
// person it gates may edit -- so a refusal has to beat the switch, while a relay that was
// never reached may not quietly change the channel an install was already on.

import { describe, it, expect } from 'vitest';
import { prereleaseAllowed } from '../renderer/lib/prerelease';
import { hasPrereleaseTag } from '../renderer/lib/version';

describe('hasPrereleaseTag', () => {
  it('sees the tag on a prerelease version', () => {
    expect(hasPrereleaseTag('0.3.1-beta.13')).toBe(true);
    expect(hasPrereleaseTag('1.0.0-alpha')).toBe(true);
    expect(hasPrereleaseTag('0.3.0-rc.1')).toBe(true);
  });

  it('sees no tag on a stable version', () => {
    expect(hasPrereleaseTag('0.3.1')).toBe(false);
    expect(hasPrereleaseTag('1.0.0')).toBe(false);
  });

  // Build metadata is not a prerelease component; semver orders 0.3.1+build as plain 0.3.1.
  it('does not mistake build metadata for a prerelease', () => {
    expect(hasPrereleaseTag('0.3.1+20260824')).toBe(false);
    expect(hasPrereleaseTag('0.3.1-beta.1+20260824')).toBe(true);
  });

  it('treats a trailing dash with nothing after it as stable', () => {
    expect(hasPrereleaseTag('0.3.1-')).toBe(false);
  });

  it('tolerates surrounding whitespace and an empty string', () => {
    expect(hasPrereleaseTag('  0.3.1-beta.1  ')).toBe(true);
    expect(hasPrereleaseTag('')).toBe(false);
  });
});

describe('prereleaseAllowed', () => {
  // The setting, once touched, is the whole answer -- the running version stops mattering.
  it('honours an explicit yes whatever version is running', () => {
    expect(prereleaseAllowed(true, '0.3.0', true)).toBe(true);
    expect(prereleaseAllowed(true, '0.3.1-beta.13', true)).toBe(true);
  });

  it('honours an explicit no whatever version is running', () => {
    expect(prereleaseAllowed(false, '0.3.0', true)).toBe(false);
    expect(prereleaseAllowed(false, '0.3.1-beta.13', true)).toBe(false);
  });

  // Nobody has chosen yet, so the app must behave exactly as it did before the setting
  // existed: electron-updater derived this from the running version and nothing else.
  it('falls back to the running version when nothing has been chosen', () => {
    expect(prereleaseAllowed(undefined, '0.3.1-beta.13', true)).toBe(true);
    expect(prereleaseAllowed(undefined, '0.3.0', true)).toBe(false);
  });

  // The point of the whole thing: somebody who is not in the tester group cannot switch
  // themselves into the beta channel, and a build that is itself a beta does not keep the
  // channel open once the group says no.
  it('refuses prereleases when the relay says this is not a tester', () => {
    expect(prereleaseAllowed(true, '0.3.0', false)).toBe(false);
    expect(prereleaseAllowed(true, '0.3.1-beta.13', false)).toBe(false);
    expect(prereleaseAllowed(undefined, '0.3.1-beta.13', false)).toBe(false);
  });

  // Doubt is not a refusal. No answer means the relay was unreachable, not deployed, or
  // there was no account to ask as -- none of which is the group saying no, so the install
  // keeps the channel it had.
  it('leaves the old rule alone while the relay has not answered', () => {
    expect(prereleaseAllowed(true, '0.3.0', undefined)).toBe(true);
    expect(prereleaseAllowed(undefined, '0.3.1-beta.13', undefined)).toBe(true);
    expect(prereleaseAllowed(undefined, '0.3.0', undefined)).toBe(false);
  });
});
