// How the picker's first row reads when a dragged structure is placed: joining the labels the
// mailbox already has, or making them.

import { describe, it, expect } from 'vitest';
import { treeTopPlace } from '../renderer/app/tree-place';
import { STRINGS_NORMAL } from '../renderer/app/strings';

describe('treeTopPlace', () => {
  const S = STRINGS_NORMAL;

  it('offers to merge when the mailbox already has the dragged label', () => {
    const place = treeTopPlace('Klanten', [{ name: 'Klanten' }, { name: 'Archief' }], S);
    expect(place.name).toBe(S.mdTreeMergeInto('Klanten'));
    expect(place.hint).toBe(S.mdTreeMergeHint);
  });

  it('names the top of the dragged path, not the sublabel that was dragged', () => {
    const place = treeTopPlace('Klanten/Acme', [{ name: 'Klanten' }], S);
    expect(place.name).toBe(S.mdTreeMergeInto('Klanten'));
  });

  it('offers to create when the mailbox does not have it', () => {
    const place = treeTopPlace('Klanten', [{ name: 'Klantenservice' }, { name: 'Archief' }], S);
    expect(place.name).toBe(S.mdTreeNewTop('Klanten'));
    expect(place.hint).toBe(S.mdTreeNewTopHint);
  });

  it('merges with a label that differs only in capitalisation, the way Gmail does', () => {
    expect(treeTopPlace('Klanten', [{ name: 'klanten' }], S).name).toBe(
      S.mdTreeMergeInto('Klanten'),
    );
  });

  it('does not merge with a label nested under something else', () => {
    expect(treeTopPlace('Klanten', [{ name: 'Archief/Klanten' }], S).name).toBe(
      S.mdTreeNewTop('Klanten'),
    );
  });
});
