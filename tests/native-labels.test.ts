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
        const filled = typeof value === 'function' ? value('x') : value;
        expect(filled.trim(), `${locale}/${rene} ${key} is empty`).not.toBe('');
      }
    }
  });
});

describe('nativeLabels — the other dialogs', () => {
  it('translates the update notification', () => {
    expect(nativeLabels('en', false).updateAvailableTitle).toBe('Update available');
    expect(nativeLabels('nl', false).updateAvailableTitle).toBe('Update beschikbaar');
  });

  it('keeps the version in the update body in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      expect(nativeLabels(locale, rene).updateAvailableBody('1.2.3')).toContain('1.2.3');
    }
  });

  it('keeps the host and the url in the link box in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      expect(l.linkMessage('example.com')).toContain('example.com');
      expect(l.linkAlwaysAllow('example.com')).toContain('example.com');
      expect(l.linkDetail('https://example.com/x')).toContain('https://example.com/x');
    }
  });
});
