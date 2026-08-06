// Covers the pure keyboard mapping the compose-account picker depends on: the digit each
// row shows, the row a keypress resolves to, and the wrap-around the arrow keys walk —
// which is also what the visible focus ring is drawn from, since :focus-visible does not
// match the programmatic focus the picker starts with.

import { describe, it, expect } from 'vitest';
import { shortcutFor, rowForKey, nextFocusIndex } from '../renderer/lib/compose-account';

describe('shortcutFor', () => {
  it('gives the digit for the first row', () => {
    expect(shortcutFor(0)).toBe('1');
  });

  it('gives null past the ninth row', () => {
    expect(shortcutFor(9)).toBeNull();
  });
});

describe('rowForKey', () => {
  it('maps a digit key to its row', () => {
    expect(rowForKey('2', 3)).toBe(1);
  });

  it('gives null when the digit is past the end of a shorter list', () => {
    expect(rowForKey('4', 3)).toBeNull();
  });

  it('gives null for a non-digit key', () => {
    expect(rowForKey('a', 3)).toBeNull();
  });

  it('gives null for the zero key', () => {
    expect(rowForKey('0', 3)).toBeNull();
  });
});

describe('nextFocusIndex', () => {
  it('steps down one row', () => {
    expect(nextFocusIndex(0, 3, 1)).toBe(1);
  });

  it('steps up one row', () => {
    expect(nextFocusIndex(2, 3, -1)).toBe(1);
  });

  it('wraps from the last row to the first going down', () => {
    expect(nextFocusIndex(2, 3, 1)).toBe(0);
  });

  it('wraps from the first row to the last going up', () => {
    expect(nextFocusIndex(0, 3, -1)).toBe(2);
  });

  it('stays put with a single row', () => {
    expect(nextFocusIndex(0, 1, 1)).toBe(0);
    expect(nextFocusIndex(0, 1, -1)).toBe(0);
  });

  it('gives the first row for an empty list rather than a negative index', () => {
    expect(nextFocusIndex(0, 0, -1)).toBe(0);
  });
});
