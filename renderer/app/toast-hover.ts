// Which card of the toast stack the pointer is over.
//
// Split out of the page for the half that can be proved: what the answer is, given whatever
// element sits under the pointer. The other half -- when to ask -- needs a real browser, and
// the page keeps it.


//===========================
// Types
//===========================

/** The part of an Element this needs, so a test can stand one in without a DOM */
export interface HoverNode {
  getAttribute(name: string): string | null;
  closest(selector: string): HoverNode | null;
}

/** Where the pointer is, as far as the stack is concerned */
export interface Hover {
  /** The card under the pointer, null when it is not on one */
  id: string | null;
  /** Whether the pointer is on the stack at all, which is what decides whether the window
   * takes clicks or passes them through */
  overStack: boolean;
}


//===========================
// Constants
//===========================

export const CARD_SELECTOR = '[data-toast-card]';

export const NOTHING_HOVERED: Hover = { id: null, overStack: false };


//===========================
// Exported functions
//===========================

/**
 * The card the pointer is over, and whether it is on the stack at all
 *
 * Two questions rather than one, because they genuinely differ: `Alles sluiten` is part of the
 * stack -- the window has to take its click -- but it is not a card and carries no cross of
 * its own, so it answers "on the stack, no card".
 *
 * @param el the topmost element under the pointer, or null when there is none
 * @returns the hover
 */
export function hoverAt(el: HoverNode | null): Hover {
  const card = el?.closest(CARD_SELECTOR) ?? null;
  if (!card) return NOTHING_HOVERED;
  return { id: card.getAttribute('data-toast-id'), overStack: true };
}
