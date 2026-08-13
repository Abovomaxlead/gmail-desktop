// The text on the native dialogs main puts up itself, which cannot reach the renderer's
// string sets.

import { describe, it, expect } from 'vitest';
import { nativeLabels, type NativeLabels } from '../electron/menus/native-labels';

// Calls a field, rendering function members with as many 'x' arguments as the function
// declares (fn.length) rather than a fixed count — a member given too few arguments
// renders the literal text "undefined" inside its template, which would still pass a
// plain non-empty check.
function render(value: NativeLabels[keyof NativeLabels]): string {
  if (typeof value !== 'function') return value;
  const fn = value as unknown as (...args: string[]) => string;
  return fn(...Array(fn.length).fill('x'));
}

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
        const filled = render(value as NativeLabels[keyof NativeLabels]);
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

describe('nativeLabels — the update popup and notifications', () => {
  it('keeps the version optional in the update messages', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const l = nativeLabels(locale, rene);
      expect(l.updateAvailableMessage('1.2.3')).toContain('1.2.3');
      expect(l.updateAvailableMessage()).not.toContain('undefined');
      expect(l.updateLatestMessage()).not.toContain('undefined');
    }
  });

  it('keeps the address and the error in the account notice', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      const body = nativeLabels(locale, rene).accountNotAddedBody('a@b.com', 'boom');
      expect(body).toContain('a@b.com');
      expect(body).toContain('boom');
    }
  });

  it('keeps the version in the "already installed" detail in every variant', () => {
    for (const [locale, rene] of [['en', false], ['nl', false], ['en', true]] as const) {
      expect(nativeLabels(locale, rene).updateInstalledDetail('1.2.3')).toContain('1.2.3');
    }
  });

  it('translates the "already installed" detail', () => {
    expect(nativeLabels('en', false).updateInstalledDetail('1.2.3')).toBe('You have v1.2.3 installed.');
    expect(nativeLabels('nl', false).updateInstalledDetail('1.2.3')).toBe('Je hebt v1.2.3 geïnstalleerd.');
  });
});

// Rene mode exists to say things differently, so its wording must not equal the normal
// Dutch. cancel is the only field where both registers could reasonably land on the same
// word, and they do not today, so every field is checked.
describe('the Rene variant', () => {
  it('says everything differently from normal Dutch', () => {
    const nl = nativeLabels('nl', false);
    const rene = nativeLabels('nl', true);
    const same: string[] = [];
    for (const key of Object.keys(nl) as (keyof NativeLabels)[]) {
      if (render(nl[key]) === render(rene[key])) same.push(key);
    }
    expect(same, `Rene wording equals normal Dutch: ${same.join(', ')}`).toEqual([]);
  });
});
