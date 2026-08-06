// The text on the native dialogs main puts up itself, which cannot reach the renderer's
// string sets.

import { describe, it, expect } from 'vitest';
import { nativeLabels } from '../electron/native-labels';

describe('nativeLabels', () => {
  it('speaks English for the English locale', () => {
    expect(nativeLabels('en', false).composeMessage).toBe('Send from which account?');
  });

  it('speaks Dutch for the Dutch locale', () => {
    expect(nativeLabels('nl', false).composeMessage).toBe('Vanaf welk account wil je versturen?');
  });

  it('lets Rene mode win over either locale', () => {
    expect(nativeLabels('en', true)).toBe(nativeLabels('nl', true));
  });

  it('fills every field in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      for (const [key, value] of Object.entries(l)) {
        expect(value.trim(), `${locale}/${rene} ${key} is empty`).not.toBe('');
      }
    }
  });
});
