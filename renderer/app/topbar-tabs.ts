// How the tab strip behaves once a window holds more accounts than fit in it.
//
// Three accounts and twenty accounts are different problems. Up to a handful the bar should
// look exactly as it always has -- full names, nothing extra on screen. Past that the names
// give way before the tabs do, and past the point where even a name-less tab does not fit the
// strip scrolls and says so, because a row that silently runs off the edge reads as a row that
// is complete.
//
// Kept pure and apart from the bar: how wide a name may be and what the overflow menu says are
// the two decisions worth proving, and neither needs a DOM.

import type { NativeMenuItem } from '../lib/native-menu';


//===========================
// Types
//===========================

/** One account as the overflow menu names it */
export interface OverflowTab {
  key: string;
  label: string;
  /** What its badge shows, or 0 for none; the menu repeats it because the tab is off screen */
  unread: number;
}


//===========================
// Constants
//===========================

/** How wide a tab's name may be, by how many tabs there are. The last step is no name at all:
 * the tab shrinks to its avatar, which is still the account -- its picture, its colour, its
 * first letter -- and the address stays in the tooltip. */
const LABEL_STEPS: Array<{ upTo: number; width: number }> = [
  { upTo: 4, width: 160 },
  { upTo: 7, width: 120 },
  { upTo: 10, width: 88 },
];

/** Past the last step the name comes off entirely */
export const TAB_AVATAR_ONLY = 0;


//===========================
// Exported functions
//===========================

/**
 * How wide the name in one tab may be
 *
 * Driven by the count rather than by measuring, so every tab is the same width and the strip
 * cannot jitter while a name loads: with twelve mailboxes the twelfth must not be the odd one
 * out because its address happens to be short.
 *
 * @param count how many tabs the bar holds
 * @returns the maximum width in pixels, or TAB_AVATAR_ONLY for a tab that shows no name
 */
export function tabLabelWidth(count: number): number {
  for (const step of LABEL_STEPS) if (count <= step.upTo) return step.width;
  return TAB_AVATAR_ONLY;
}

/**
 * The menu behind the overflow button
 *
 * Every account that is not fully in view, in the bar's own order, each carrying the badge its
 * tab would have shown -- the whole point of the menu is that those tabs cannot be seen.
 *
 * @param hidden the tabs scrolled out of sight
 * @returns a menu whose ids are account keys, empty when nothing is hidden
 */
export function planOverflowMenu(hidden: readonly OverflowTab[]): NativeMenuItem[] {
  return hidden.map((tab) => ({
    kind: 'item',
    id: tab.key,
    label: tab.unread > 0 ? `${tab.label} (${tab.unread})` : tab.label,
  }));
}

/**
 * The fade over a strip whose tabs run past one or both of its edges
 *
 * A tab cut down the middle reads as a drawing error; a tab fading out reads as a row that
 * goes on. Both edges get it, because the strip scrolls in both directions.
 *
 * @param cutLeft whether the strip has been scrolled away from its start
 * @param cutRight whether tabs continue past the right edge
 * @returns a CSS mask-image, or null when the strip has no cut edge and needs no mask
 */
export function stripMaskImage(cutLeft: boolean, cutRight: boolean): string | null {
  if (!cutLeft && !cutRight) return null;
  const from = cutLeft ? 'transparent, #000 16px' : '#000';
  const to = cutRight ? '#000 calc(100% - 16px), transparent' : '#000';
  return `linear-gradient(to right, ${from}, ${to})`;
}

/**
 * Which side of a tab the line goes that says where the dragged one lands
 *
 * The bar reorders by dropping one tab on another, and where it ends up is decided by the two
 * positions, not by which half of the target the pointer is over: dragging left of a tab puts
 * the dragged one before it, dragging right puts it after. The line has to say the same thing
 * the drop will do, or it lies about the result.
 *
 * @param fromIndex where the dragged tab is now
 * @param toIndex the tab under the pointer
 * @returns the side to draw the line on, or null when the drop would change nothing
 */
export function dropIndicatorSide(fromIndex: number, toIndex: number): 'before' | 'after' | null {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  return fromIndex < toIndex ? 'after' : 'before';
}
