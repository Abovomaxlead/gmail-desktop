// Whether an account's unread count may be shown. The toggle is opt-out: an account
// that never touched Settings has no `badgeCount` key and must still show a count.

import { describe, it, expect } from 'vitest';
import { accountCountVisible } from '../renderer/lib/badge-visibility';

describe('accountCountVisible', () => {
  it('shows the count when the preference is absent', () => {
    expect(accountCountVisible(undefined)).toBe(true);
  });

  it('shows the count when the preference is explicitly true', () => {
    expect(accountCountVisible(true)).toBe(true);
  });

  it('hides the count only when the preference is explicitly false', () => {
    expect(accountCountVisible(false)).toBe(false);
  });

  describe('with the global master', () => {
    it('behaves as before when the master is absent or on', () => {
      expect(accountCountVisible(undefined, undefined)).toBe(true);
      expect(accountCountVisible(true, true)).toBe(true);
      expect(accountCountVisible(false, true)).toBe(false);
    });

    it('hides every count when the master is off, whatever the account says', () => {
      expect(accountCountVisible(undefined, false)).toBe(false);
      expect(accountCountVisible(true, false)).toBe(false);
      expect(accountCountVisible(false, false)).toBe(false);
    });
  });
});
