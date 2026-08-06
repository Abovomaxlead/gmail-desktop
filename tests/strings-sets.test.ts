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
