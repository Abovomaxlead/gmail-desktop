// The three sets of context-menu labels, which live in main rather than in the
// renderer's string sets and so need their own key check.

import { describe, it, expect } from 'vitest';
import { LABELS_NORMAL, LABELS_RENE, LABELS_NL } from '../electron/menus/context-menu';

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

// Four labels read the same in both registers - "Knippen", "Kopiëren", "Plakken" and
// "Plakken zonder opmaak" are simply the right Dutch either way. The other eight are
// where Rene's register shows, so those are the ones that must not drift back into it.
const SHARED_WITH_RENE = new Set(['cut', 'copy', 'paste', 'pasteMatchStyle']);

describe('LABELS_NL register', () => {
  it('does not fall back to Rene wording where the two registers differ', () => {
    const collapsed: string[] = [];
    for (const key of Object.keys(LABELS_NORMAL) as (keyof typeof LABELS_NORMAL)[]) {
      if (SHARED_WITH_RENE.has(key)) continue;
      if (LABELS_NL[key] === LABELS_RENE[key]) collapsed.push(key);
    }
    expect(collapsed, `Rene wording leaked into LABELS_NL: ${collapsed.join(', ')}`).toEqual([]);
  });

  it('keeps the two clearest register markers', () => {
    expect(LABELS_NL.undo).toBe('Ongedaan maken');
    expect(LABELS_NL.redo).toBe('Opnieuw');
  });
});
