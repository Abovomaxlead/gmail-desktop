// The tray menu's text: Rene wins over the locale, and neither Rene nor Dutch may be a
// copy of another variant.

import { describe, it, expect } from 'vitest';
import { trayLabels, type TrayLabels } from '../electron/menus/tray-labels';

// Calls a field, rendering function members with as many 'x' arguments as the function
// declares (fn.length) rather than a fixed count — a member given too few arguments
// renders the literal text "undefined" inside its template, which would still pass a
// plain non-empty check.
function render(value: TrayLabels[keyof TrayLabels]): string {
  if (typeof value !== 'function') return value;
  const fn = value as unknown as (...args: string[]) => string;
  return fn(...Array(fn.length).fill('x'));
}

describe('trayLabels', () => {
  it('lets Rene mode win over either locale', () => {
    expect(trayLabels('en', true)).toBe(trayLabels('nl', true));
  });
});

// Rene mode exists to say things differently, so its wording must not equal the normal
// Dutch. Every field is checked, none allowlisted.
describe('the Rene variant', () => {
  it('says everything differently from normal Dutch', () => {
    const nl = trayLabels('nl', false);
    const rene = trayLabels('nl', true);
    const same: string[] = [];
    for (const key of Object.keys(nl) as (keyof TrayLabels)[]) {
      if (render(nl[key]) === render(rene[key])) same.push(key);
    }
    expect(same, `Rene wording equals normal Dutch: ${same.join(', ')}`).toEqual([]);
  });
});

// Words that are genuinely identical in Dutch and English would go here, each with its
// own justification. None of the eighteen tray strings land on the same word in both
// languages, so the allowlist stays empty rather than decorative.
const NL_EN_ALLOWLIST: (keyof TrayLabels)[] = [];

describe('the Dutch variant', () => {
  it('reads differently from English, apart from the allowlisted words', () => {
    const en = trayLabels('en', false);
    const nl = trayLabels('nl', false);
    const same: string[] = [];
    for (const key of Object.keys(en) as (keyof TrayLabels)[]) {
      if (NL_EN_ALLOWLIST.includes(key)) continue;
      if (render(en[key]) === render(nl[key])) same.push(key);
    }
    expect(same, `Dutch equals English: ${same.join(', ')}`).toEqual([]);
  });
});
