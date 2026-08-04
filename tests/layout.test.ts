// contentBounds: where the Gmail view sits below the topbar.

import { describe, it, expect } from 'vitest';
import { contentBounds, TOPBAR_HEIGHT, CONTENT_MARGIN } from '../electron/layout';

describe('contentBounds', () => {
  it('puts the content under the topbar, across the full width', () => {
    expect(contentBounds({ width: 1000, height: 800 })).toEqual({
      x: CONTENT_MARGIN,
      y: TOPBAR_HEIGHT + CONTENT_MARGIN,
      width: 1000 - CONTENT_MARGIN * 2,
      height: 800 - TOPBAR_HEIGHT - CONTENT_MARGIN * 2,
    });
  });

  it('never returns a negative height', () => {
    expect(contentBounds({ width: 800, height: 10 }).height).toBe(0);
  });

  it('never returns a negative width', () => {
    expect(contentBounds({ width: 0, height: 800 }).width).toBe(0);
  });

  it('offsets by the scaled topbar when the UI is zoomed (Rene mode)', () => {
    expect(contentBounds({ width: 1000, height: 800 }, 2)).toEqual({
      x: CONTENT_MARGIN,
      y: TOPBAR_HEIGHT * 2 + CONTENT_MARGIN,
      width: 1000 - CONTENT_MARGIN * 2,
      height: 800 - TOPBAR_HEIGHT * 2 - CONTENT_MARGIN * 2,
    });
  });

  it('is 40px tall — the bar, the overlay and the CSS all read this one value', () => {
    expect(TOPBAR_HEIGHT).toBe(40);
  });
});
