// The three string sets must stay interchangeable. UiStrings makes the compiler check
// STRINGS_NL, but CATEGORY_* is a plain Record and only a test can catch a gap there.

import { describe, it, expect } from 'vitest';
import {
  STRINGS_NORMAL,
  STRINGS_RENE,
  STRINGS_NL,
  getStrings,
  CATEGORY_NORMAL,
  CATEGORY_RENE,
  CATEGORY_NL,
  COLOR_NORMAL,
  COLOR_NL,
} from '../renderer/app/strings';

describe('getStrings', () => {
  it('gives English for the English locale', () => {
    expect(getStrings('en', false)).toBe(STRINGS_NORMAL);
  });

  it('gives Dutch for the Dutch locale', () => {
    expect(getStrings('nl', false)).toBe(STRINGS_NL);
  });

  it('lets Rene mode win over either locale', () => {
    expect(getStrings('en', true)).toBe(STRINGS_RENE);
    expect(getStrings('nl', true)).toBe(STRINGS_RENE);
  });
});

describe('the three sets', () => {
  it('carry exactly the same keys', () => {
    const en = Object.keys(STRINGS_NORMAL).sort();
    expect(Object.keys(STRINGS_RENE).sort()).toEqual(en);
    expect(Object.keys(STRINGS_NL).sort()).toEqual(en);
  });

  it('leave no value empty', () => {
    for (const [set, name] of [
      [STRINGS_NORMAL, 'en'],
      [STRINGS_RENE, 'rene'],
      [STRINGS_NL, 'nl'],
    ] as const) {
      for (const [key, value] of Object.entries(set)) {
        const text = render(value);
        if (text === null) continue;
        expect(text.trim(), `${name}.${key} is empty`).not.toBe('');
      }
    }
  });
});

// Every parameter gets a 1, which reads as "1" inside a template and as a number where
// one is expected - enough to compare two templates against each other. The two members
// backed by a map (changelogCategory, colorName) do string work on their argument and
// throw on a number; they return null here and are covered by the map key tests instead.
function render(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'function') return null;
  const fn = value as (...a: unknown[]) => unknown;
  try {
    return String(fn(...Array.from({ length: fn.length }, () => 1)));
  } catch {
    return null;
  }
}

// A value identical to the English one is almost always a forgotten translation. The
// exceptions are words Dutch borrowed unchanged, product names, and terms where the
// standard Dutch UI word happens to be the English one, listed here so that adding one is
// a deliberate act rather than a silent pass. Reaching for this list to dodge a hard
// translation is the failure mode; picking a second-choice Dutch word to stay off it is
// the other, so an entry here beats a worse string.
const SAME_IN_BOTH = new Set([
  'languageEnglish',
  'languageDutch',
  'escKey',
  'calendarToggle',
  'navAccounts',
  'navDownloads',
  'navUpdates',
  'updates',
  'dhBytes',
  'soundPing',
  'soundArpeggio',
  'volumeLabel',
  'mailToggle',
  'perAccountNotifications',
]);

function nlOf(key: string): string | null {
  return render((STRINGS_NL as unknown as Record<string, unknown>)[key]);
}

function enOf(key: string): string | null {
  return render((STRINGS_NORMAL as unknown as Record<string, unknown>)[key]);
}

describe('STRINGS_NL', () => {
  it('translates every value that is not deliberately shared with English', () => {
    const leftovers: string[] = [];
    for (const key of Object.keys(STRINGS_NORMAL)) {
      if (SAME_IN_BOTH.has(key)) continue;
      const nl = nlOf(key);
      const en = enOf(key);
      if (nl !== null && en !== null && nl === en) leftovers.push(key);
    }
    expect(leftovers, `still English: ${leftovers.join(', ')}`).toEqual([]);
  });

  // Without this an allowlist entry outlives its reason: rename the key or translate the
  // value and the entry quietly starts excusing a key that no longer needs excusing.
  it('keeps no allowlist entry that has stopped being shared with English', () => {
    const stale: string[] = [];
    for (const key of SAME_IN_BOTH) {
      if (!(key in STRINGS_NORMAL)) {
        stale.push(`${key} (no such key)`);
        continue;
      }
      const nl = nlOf(key);
      const en = enOf(key);
      if (nl !== null && en !== null && nl !== en) stale.push(`${key} (now differs)`);
    }
    expect(stale, `stale allowlist entries: ${stale.join(', ')}`).toEqual([]);
  });
});

// The two map-backed members are the one place a Dutch UI can silently fall back to
// English: they are functions, so the leftover-English test cannot render them, and the
// map tests above compare the maps rather than which map these two read. Call them.
describe('STRINGS_NL map-backed members', () => {
  it('reads the Dutch category names, not the English ones', () => {
    expect(STRINGS_NL.changelogCategory('Added')).toBe('Toegevoegd');
    expect(STRINGS_NL.changelogCategory('Fixed')).toBe('Opgelost');
  });

  it('reads the Dutch colour names, not the English ones', () => {
    expect(STRINGS_NL.colorName('#4285f4')).toBe('Blauw');
    expect(STRINGS_NL.colorName('#ea4335')).toBe('Rood');
  });
});

describe('the category and colour maps', () => {
  it('carry the same keys in all three sets', () => {
    expect(Object.keys(CATEGORY_NL).sort()).toEqual(Object.keys(CATEGORY_NORMAL).sort());
    expect(Object.keys(CATEGORY_RENE).sort()).toEqual(Object.keys(CATEGORY_NORMAL).sort());
    expect(Object.keys(COLOR_NL).sort()).toEqual(Object.keys(COLOR_NORMAL).sort());
  });

  it('translate every category', () => {
    for (const key of Object.keys(CATEGORY_NORMAL)) {
      expect(CATEGORY_NL[key], `category ${key}`).not.toBe(CATEGORY_NORMAL[key]);
    }
  });
});
