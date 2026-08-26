// Which card of the toast stack the pointer is over, and whether it is on the stack at all.

import { describe, it, expect } from 'vitest';
import { hoverAt, NOTHING_HOVERED, type HoverNode } from '../renderer/app/toast-hover';

/** A stand-in for the element under the pointer. `card` is what closest() finds, which is the
 * element itself when it is the card. */
const node = (attrs: Record<string, string>, card?: HoverNode | null): HoverNode => {
  const self: HoverNode = {
    getAttribute: (n) => attrs[n] ?? null,
    closest: () => (card === undefined ? self : card),
  };
  return self;
};

describe('hoverAt', () => {
  it('names the card under the pointer', () => {
    expect(hoverAt(node({ 'data-toast-card': '', 'data-toast-id': 't1' }))).toEqual({
      id: 't1',
      overStack: true,
    });
  });

  it('finds the card from something inside it', () => {
    const card = node({ 'data-toast-card': '', 'data-toast-id': 't1' });
    expect(hoverAt(node({}, card)).id).toBe('t1');
  });

  // The pointer is on the stack -- the window must keep taking clicks or the button cannot be
  // pressed -- but this is not a card and has no cross of its own.
  it('is on the stack without a card over Alles sluiten', () => {
    const button = node({ 'data-toast-card': '' });
    expect(hoverAt(button)).toEqual({ id: null, overStack: true });
  });

  it('is nowhere in the gap between two cards', () => {
    expect(hoverAt(node({}, null))).toEqual(NOTHING_HOVERED);
  });

  it('is nowhere when there is no element under the pointer at all', () => {
    expect(hoverAt(null)).toEqual(NOTHING_HOVERED);
  });
});
