// Where the active Gmail/Calendar view sits under the topbar. TOPBAR_HEIGHT lives in
// renderer/lib because the bar's CSS needs it too, and is re-exported here so callers need
// know nothing of that detour.
//
// No margin, so no dark renderer background shows through. `scale` is the renderer's zoom
// factor: the fixed 40px bar draws that much taller, so the view starts lower.

import { TOPBAR_HEIGHT } from '../../renderer/lib/topbar';

export { TOPBAR_HEIGHT };

export const CONTENT_MARGIN = 0;

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
    x: CONTENT_MARGIN,
    y: topbar + CONTENT_MARGIN,
    width: Math.max(0, win.width - CONTENT_MARGIN * 2),
    height: Math.max(0, win.height - topbar - CONTENT_MARGIN * 2),
  };
}
