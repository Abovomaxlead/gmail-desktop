// De hoogte woont in renderer/lib omdat de balk-CSS hem óók nodig heeft en
// Next.js niets buiten zijn root compileert. Hier weer geëxporteerd, zodat
// bestaande importeurs (titlebar.ts, de tests) niets hoeven te weten van die
// omweg.
import { TOPBAR_HEIGHT } from '../renderer/lib/topbar';

export { TOPBAR_HEIGHT };

// No margin around the active Gmail/Calendar view: the webview sits flush
// against the topbar so there is no dark frame from the renderer background.
export const CONTENT_MARGIN = 0;

// `scale` is de zoomfactor van de renderer (2 in Rene-modus): de vaste 40px
// balk tekent dan scale× hoger, dus de content-view moet daaronder beginnen.
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
