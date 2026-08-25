// Which releases the updater is allowed to offer, and the rule that decides it for a user
// who has never touched the setting.

import { describe, it, expect } from 'vitest';
import { prereleaseAllowed } from '../electron/updates/update-channel';
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
    expect(prereleaseAllowed(true, '0.3.0')).toBe(true);
    expect(prereleaseAllowed(true, '0.3.1-beta.13')).toBe(true);
  });

  it('honours an explicit no whatever version is running', () => {
    expect(prereleaseAllowed(false, '0.3.0')).toBe(false);
    expect(prereleaseAllowed(false, '0.3.1-beta.13')).toBe(false);
  });

  // Nobody has chosen yet, so the app must behave exactly as it did before the setting
  // existed: electron-updater derived this from the running version and nothing else.
  it('falls back to the running version when nothing has been chosen', () => {
    expect(prereleaseAllowed(undefined, '0.3.1-beta.13')).toBe(true);
    expect(prereleaseAllowed(undefined, '0.3.0')).toBe(false);
  });
});
