// Drops a stored window position that no longer overlaps any display by at least
// MIN_VISIBLE pixels on both axes, so a window last closed on a monitor that is now
// disconnected reopens on screen at its remembered size.
export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { bounds: Rect }
export interface StoredBounds { width: number; height: number; x?: number; y?: number }

const MIN_VISIBLE = 100;

function overlaps(win: Required<StoredBounds>, d: Rect): boolean {
  const xOverlap = Math.min(win.x + win.width, d.x + d.width) - Math.max(win.x, d.x);
  const yOverlap = Math.min(win.y + win.height, d.y + d.height) - Math.max(win.y, d.y);
  return xOverlap >= MIN_VISIBLE && yOverlap >= MIN_VISIBLE;
}

export function clampBoundsToDisplays(win: StoredBounds, displays: Display[]): StoredBounds {
  if (win.x === undefined || win.y === undefined) return win;
  const full = win as Required<StoredBounds>;
  if (displays.some((d) => overlaps(full, d.bounds))) return win;
  return { width: win.width, height: win.height };
}
