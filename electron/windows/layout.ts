// Where the active Gmail/Calendar view sits under the topbar. TOPBAR_HEIGHT lives in
// renderer/lib because the bar's CSS needs it too, and is re-exported here so callers need
// to know nothing of that detour.
//
// No margin, so no dark renderer background shows through. `scale` is the renderer's zoom
// factor: the fixed 40px bar draws that much taller, so the view starts lower.

import { TOPBAR_HEIGHT } from '../../renderer/lib/topbar';

export { TOPBAR_HEIGHT };

/**
 * Returns where the content view sits inside the window
 *
 * @param win the window's content size
 * @param scale the renderer's zoom factor, which grows the fixed-height topbar
 * @returns bounds for the WebContentsView
 */
export function contentBounds(
  win: { width: number; height: number },
  scale = 1,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const topbar = Math.round(TOPBAR_HEIGHT * scale);
  return {
    x: 0,
    y: topbar,
    width: win.width,
    height: Math.max(0, win.height - topbar),
  };
}
