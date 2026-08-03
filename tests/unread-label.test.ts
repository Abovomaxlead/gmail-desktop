import { describe, it, expect } from 'vitest';
import { unreadLabel, UNREAD_CAP } from '../renderer/app/unread-label';
import { STRINGS_NORMAL, STRINGS_RENE } from '../renderer/app/strings';

describe('unreadLabel', () => {
  it('leaves small counts alone', () => {
    expect(unreadLabel(1, 'en-US')).toBe('1');
    expect(unreadLabel(99, 'en-US')).toBe('99');
  });

  // De zijbalk kapte af op 99+; het ontwerp van de balk laat een teller als
  // 1.324 zien, dus vier cijfers moeten er gewoon staan.
  it('shows thousands instead of truncating at 99', () => {
    expect(unreadLabel(1324, 'nl-NL')).toBe('1.324');
    expect(unreadLabel(1324, 'en-US')).toBe('1,324');
  });

  it('groups thousands in the language of the string set', () => {
    expect(unreadLabel(1324, STRINGS_NORMAL.numberLocale)).toBe('1,324');
    expect(unreadLabel(1324, STRINGS_RENE.numberLocale)).toBe('1.324');
  });

  // Zonder bovengrens duwt een teller van vijf cijfers het tabblad breder dan de
  // naam zelf mag worden: de badge kapt niet af.
  it('caps at the cap and marks it with a plus', () => {
    expect(unreadLabel(UNREAD_CAP, 'en-US')).toBe('9,999');
    expect(unreadLabel(UNREAD_CAP + 1, 'en-US')).toBe('9,999+');
    expect(unreadLabel(87654, 'nl-NL')).toBe('9.999+');
  });

  it('never adds a plus at exactly the cap', () => {
    expect(unreadLabel(UNREAD_CAP, 'nl-NL').endsWith('+')).toBe(false);
  });
});
