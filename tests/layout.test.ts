// contentBounds: where the Gmail view sits below the topbar.

import { describe, it, expect } from 'vitest';
import { contentBounds, TOPBAR_HEIGHT } from '../electron/windows/layout';

describe('contentBounds', () => {
  it('puts the content under the topbar, across the full width', () => {
    expect(contentBounds({ width: 1000, height: 800 })).toEqual({
      x: 0,
      y: TOPBAR_HEIGHT,
      width: 1000,
      height: 800 - TOPBAR_HEIGHT,
    });
  });

  it('never returns a negative height', () => {
    expect(contentBounds({ width: 800, height: 10 }).height).toBe(0);
  });

  it('offsets by the scaled topbar when the UI is zoomed (Rene mode)', () => {
    expect(contentBounds({ width: 1000, height: 800 }, 2)).toEqual({
      x: 0,
      y: TOPBAR_HEIGHT * 2,
      width: 1000,
      height: 800 - TOPBAR_HEIGHT * 2,
    });
  });

  it('is 40px tall — the bar, the overlay and the CSS all read this one value', () => {
    expect(TOPBAR_HEIGHT).toBe(40);
  });
});
