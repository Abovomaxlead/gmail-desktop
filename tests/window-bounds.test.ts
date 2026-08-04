// Clamping remembered window bounds to the displays that actually exist, and pulling a
// window that is already too small back up to the minimum.

import { describe, it, expect } from 'vitest';
import { clampBoundsToDisplays, grownToMinimum } from '../electron/window-bounds';

const primary = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

describe('clampBoundsToDisplays', () => {
  it('keeps bounds that sit on a display', () => {
    const win = { width: 1200, height: 820, x: 100, y: 100 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('drops x/y when the window is fully off-screen', () => {
    const win = { width: 1200, height: 820, x: 5000, y: 5000 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual({ width: 1200, height: 820 });
  });

  it('passes through when no x/y is stored', () => {
    const win = { width: 1200, height: 820 };
    expect(clampBoundsToDisplays(win, [primary])).toEqual(win);
  });

  it('keeps bounds visible on a secondary display', () => {
    const secondary = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
    const win = { width: 800, height: 600, x: 2000, y: 50 };
    expect(clampBoundsToDisplays(win, [primary, secondary])).toEqual(win);
  });
});

describe('grownToMinimum', () => {
  const min = { width: 800, height: 600 };

  it('leaves a window that already clears the minimum alone', () => {
    expect(grownToMinimum({ width: 1200, height: 820 }, min)).toEqual({
      width: 1200,
      height: 820,
    });
  });

  it('grows only the axis that is under the minimum', () => {
    expect(grownToMinimum({ width: 1200, height: 120 }, min)).toEqual({
      width: 1200,
      height: 600,
    });
    expect(grownToMinimum({ width: 300, height: 820 }, min)).toEqual({
      width: 800,
      height: 820,
    });
  });

  it('grows both axes when the window is squashed on both', () => {
    expect(grownToMinimum({ width: 200, height: 60 }, min)).toEqual(min);
  });

  it('treats a window exactly at the minimum as big enough', () => {
    expect(grownToMinimum(min, min)).toEqual(min);
  });
});
