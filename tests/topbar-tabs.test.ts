// The tab strip once a window holds more mailboxes than fit: how wide a name may be, and what
// the overflow button's menu says about the tabs that are off the edge.

import { describe, it, expect } from 'vitest';
import {
  tabLabelWidth,
  planOverflowMenu,
  stripMaskImage,
  TAB_AVATAR_ONLY,
} from '../renderer/app/topbar-tabs';

describe('tabLabelWidth', () => {
  it('leaves a handful of accounts the width the bar always had', () => {
    expect(tabLabelWidth(1)).toBe(160);
    expect(tabLabelWidth(4)).toBe(160);
  });

  it('narrows the names as the tabs pile up, never widening again', () => {
    const widths = [1, 5, 8, 11].map(tabLabelWidth);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(new Set(widths).size).toBe(widths.length);
  });

  it('drops the name entirely past ten, leaving the avatar to stand for the account', () => {
    expect(tabLabelWidth(10)).toBeGreaterThan(TAB_AVATAR_ONLY);
    expect(tabLabelWidth(11)).toBe(TAB_AVATAR_ONLY);
    expect(tabLabelWidth(40)).toBe(TAB_AVATAR_ONLY);
  });
});

describe('planOverflowMenu', () => {
  it('names every hidden mailbox, in the order the bar has them', () => {
    expect(
      planOverflowMenu([
        { key: 'a', label: 'Info', unread: 0 },
        { key: 'b', label: 'Sales', unread: 0 },
      ]),
    ).toEqual([
      { kind: 'item', id: 'a', label: 'Info' },
      { kind: 'item', id: 'b', label: 'Sales' },
    ]);
  });

  it('repeats the badge, since the tab carrying it cannot be seen', () => {
    expect(planOverflowMenu([{ key: 'a', label: 'Info', unread: 12 }])[0]).toEqual({
      kind: 'item',
      id: 'a',
      label: 'Info (12)',
    });
  });

  it('is empty when nothing is hidden, which is what keeps the menu shut', () => {
    expect(planOverflowMenu([])).toEqual([]);
  });
});

describe('stripMaskImage', () => {
  it('leaves a strip that fits alone', () => {
    expect(stripMaskImage(false, false)).toBeNull();
  });

  it('fades only the edge the tabs run past', () => {
    expect(stripMaskImage(false, true)).toBe(
      'linear-gradient(to right, #000, #000 calc(100% - 16px), transparent)',
    );
    expect(stripMaskImage(true, false)).toBe(
      'linear-gradient(to right, transparent, #000 16px, #000)',
    );
  });

  it('fades both when the strip is scrolled into the middle of the row', () => {
    expect(stripMaskImage(true, true)).toBe(
      'linear-gradient(to right, transparent, #000 16px, #000 calc(100% - 16px), transparent)',
    );
  });
});
