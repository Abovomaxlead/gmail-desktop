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
  it('offers prereleases only when the user asked for them', () => {
    expect(prereleaseAllowed(true)).toBe(true);
    expect(prereleaseAllowed(false)).toBe(false);
  });

  // The point of the change: a build that is itself a beta no longer keeps the beta channel
  // open by itself. Until there is a tester gate, only the switch opens it.
  it('keeps prereleases off for a setting nobody has touched', () => {
    expect(prereleaseAllowed(undefined)).toBe(false);
  });
});
