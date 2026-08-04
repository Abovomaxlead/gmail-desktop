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

  // De hoofdschakelaar uit Weergave. Hij staat vóór de keuze per account, want dat
  // is wat "regardless of individual account settings" betekent — en de standaard is
  // `true`, zodat een aanroeper die hem niet meegeeft zich gedraagt als vóórdat de
  // schakelaar bestond.
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
