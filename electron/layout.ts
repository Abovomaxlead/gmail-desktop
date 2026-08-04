// Where the active Gmail/Calendar view sits under the topbar. TOPBAR_HEIGHT lives in
// renderer/lib because the bar's CSS needs it too and Next.js compiles nothing
// outside its own root; it is re-exported here so titlebar.ts and the tests need know
// nothing of that detour. There is no margin, so the webview sits flush against the
// topbar and no dark renderer background shows through. `scale` is the renderer's
// zoom factor (2 in Rene mode): the fixed 40px bar then draws scale times taller, so
// the content view has to start lower.

import { TOPBAR_HEIGHT } from '../renderer/lib/topbar';

export { TOPBAR_HEIGHT };

export const CONTENT_MARGIN = 0;

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
