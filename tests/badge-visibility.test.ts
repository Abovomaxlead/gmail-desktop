import { describe, it, expect } from 'vitest';
import { accountCountVisible } from '../renderer/lib/badge-visibility';

describe('accountCountVisible', () => {
  // The toggle is opt-out: an account that never touched Settings has no
  // `badgeCount` key at all, and must still show a count everywhere. Getting
  // this backwards would silently blank every count for every existing user
  // the day this ships.
  it('shows the count when the preference is absent', () => {
    expect(accountCountVisible(undefined)).toBe(true);
  });

  it('shows the count when the preference is explicitly true', () => {
    expect(accountCountVisible(true)).toBe(true);
  });

  it('hides the count only when the preference is explicitly false', () => {
    expect(accountCountVisible(false)).toBe(false);
  });
});
