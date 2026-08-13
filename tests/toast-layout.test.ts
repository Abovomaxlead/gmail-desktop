// Where the stack window sits. Work areas do not start at the origin — a second monitor
// left of the primary one has a negative x — so every assertion here anchors to the work
// area it is given rather than to the screen size.

import { describe, expect, it } from 'vitest';
import { TOAST_MARGIN, containsPoint, exceedsWorkArea, toastWindowBounds } from '../electron/toast/toast-layout';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };

describe('toastWindowBounds', () => {
  it('anchors to the bottom-right corner with a margin on both edges', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 240 }, 1);
    expect(b).toEqual({ x: 1920 - 380 - TOAST_MARGIN, y: 1040 - 240 - TOAST_MARGIN, width: 380, height: 240 });
  });

  it('follows a work area that does not start at the origin', () => {
    const left = { x: -1920, y: -120, width: 1920, height: 1080 };
    const b = toastWindowBounds(left, { width: 380, height: 240 }, 1);
    expect(b.x).toBe(-1920 + 1920 - 380 - TOAST_MARGIN);
    expect(b.y).toBe(-120 + 1080 - 240 - TOAST_MARGIN);
  });

  it('multiplies the measured size by the zoom factor', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 240 }, 2);
    expect(b.width).toBe(760);
    expect(b.height).toBe(480);
    expect(b.x).toBe(1920 - 760 - TOAST_MARGIN);
  });

  it('rounds a fractional zoom rather than passing a float to setBounds', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 101 }, 1.25);
    expect(Number.isInteger(b.width)).toBe(true);
    expect(Number.isInteger(b.height)).toBe(true);
    expect(b.height).toBe(126);
  });

  it('clamps a stack taller than the work area allows', () => {
    const b = toastWindowBounds(PRIMARY, { width: 380, height: 4000 }, 1);
    expect(b.height).toBe(1040 - TOAST_MARGIN * 2);
    expect(b.y).toBe(TOAST_MARGIN);
  });

  it('never returns a zero or negative size', () => {
    const b = toastWindowBounds(PRIMARY, { width: 0, height: 0 }, 1);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});

// The stack window on a 1920x1040 work area, 380 wide and 240 tall, bottom-right.
const STACK = { x: 1524, y: 784, width: 380, height: 240 };

describe('containsPoint', () => {
  it('is true in the middle of the stack', () => {
    expect(containsPoint(STACK, { x: 1700, y: 900 })).toBe(true);
  });

  it('includes the top-left corner and excludes the far edges', () => {
    expect(containsPoint(STACK, { x: 1524, y: 784 })).toBe(true);
    expect(containsPoint(STACK, { x: 1524 + 380, y: 900 })).toBe(false);
    expect(containsPoint(STACK, { x: 1700, y: 784 + 240 })).toBe(false);
  });

  it('is false one pixel off each edge, which is the whole point of asking', () => {
    expect(containsPoint(STACK, { x: 1523, y: 900 })).toBe(false);
    expect(containsPoint(STACK, { x: 1700, y: 783 })).toBe(false);
  });

  it('works on a monitor left of the primary one, where the coordinates go negative', () => {
    const left = { x: -1920, y: -120, width: 380, height: 240 };
    expect(containsPoint(left, { x: -1800, y: 0 })).toBe(true);
    expect(containsPoint(left, { x: -1921, y: 0 })).toBe(false);
  });
});

describe('exceedsWorkArea', () => {
  it('is false for a stack that fits', () => {
    expect(exceedsWorkArea(PRIMARY, 300, 1)).toBe(false);
  });

  it('is false at exactly the fit', () => {
    expect(exceedsWorkArea(PRIMARY, 1040 - TOAST_MARGIN * 2, 1)).toBe(false);
  });

  it('is true one pixel past the fit', () => {
    expect(exceedsWorkArea(PRIMARY, 1040 - TOAST_MARGIN * 2 + 1, 1)).toBe(true);
  });

  it('counts the zoom factor, so Rene mode collapses sooner', () => {
    expect(exceedsWorkArea(PRIMARY, 600, 1)).toBe(false);
    expect(exceedsWorkArea(PRIMARY, 600, 2)).toBe(true);
  });
});
