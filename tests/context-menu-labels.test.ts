// The three sets of context-menu labels, which live in main rather than in the
// renderer's string sets and so need their own key check.

import { describe, it, expect } from 'vitest';
import { LABELS_NORMAL, LABELS_RENE, LABELS_NL } from '../electron/context-menu';

describe('context menu labels', () => {
  it('carry the same keys in all three sets', () => {
    const en = Object.keys(LABELS_NORMAL).sort();
    expect(Object.keys(LABELS_RENE).sort()).toEqual(en);
    expect(Object.keys(LABELS_NL).sort()).toEqual(en);
  });

  it('keep the %s placeholder in the search label', () => {
    expect(LABELS_NL.searchGoogle).toContain('%s');
  });
});
