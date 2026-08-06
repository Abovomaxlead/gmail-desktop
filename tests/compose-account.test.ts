// Covers the pure keyboard-shortcut mapping the compose-account picker depends on: the
// digit each row shows, and the row a keypress resolves to.

import { describe, it, expect } from 'vitest';
import { shortcutFor, rowForKey } from '../renderer/lib/compose-account';

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
