// Drops a stored window position that no longer overlaps any display by at least
// MIN_VISIBLE pixels on both axes, so a window last closed on a monitor that is now
// disconnected reopens on screen at its remembered size.


//===========================
// Types
//===========================

export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { bounds: Rect }
export interface StoredBounds { width: number; height: number; x?: number; y?: number }

export interface Size {
  width: number;
  height: number;
}


//===========================
// Constants
//===========================

const MIN_VISIBLE = 100;


//===========================
// Exported functions
//===========================

/**
 * Drops a stored position that no longer lands on any display
 *
 * @param win
 * @param displays the displays currently attached
 * @returns the bounds unchanged, or size only when the position is unreachable
 */
export function clampBoundsToDisplays(win: StoredBounds, displays: Display[]): StoredBounds {
  if (win.x === undefined || win.y === undefined) return win;
  const full = win as Required<StoredBounds>;
  if (displays.some((d) => overlaps(full, d.bounds))) return win;
  return { width: win.width, height: win.height };
}

// Setting a minimum size does not resize a window that is already smaller than it, so
// switching "do not make it too small" back on has to pull the window up itself.

/**
 * Grows a window to a minimum size on both axes
 *
 * @param win
 * @param min
 * @returns the larger of the two per axis
 */
export function grownToMinimum(win: Size, min: Size): Size {
  return {
    width: Math.max(win.width, min.width),
    height: Math.max(win.height, min.height),
  };
}


//===========================
// Helper functions
//===========================

/**
 * Tells whether a window overlaps a display enough to be reachable
 *
 * @param win
 * @param d the display's bounds
 * @returns true when both axes overlap by at least MIN_VISIBLE
 * @private
 */
function overlaps(win: Required<StoredBounds>, d: Rect): boolean {
  const xOverlap = Math.min(win.x + win.width, d.x + d.width) - Math.max(win.x, d.x);
  const yOverlap = Math.min(win.y + win.height, d.y + d.height) - Math.max(win.y, d.y);
  return xOverlap >= MIN_VISIBLE && yOverlap >= MIN_VISIBLE;
}
