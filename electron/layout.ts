// De hoogte van de topbar, op één plek. Drie dingen lezen deze waarde: de
// bounds-berekening hieronder, de hoogte van titleBarOverlay (zodat de echte
// vensterknoppen precies in onze balk vallen) en de CSS van de balk zelf. Lopen
// die uiteen, dan hangen de knoppen half buiten de balk.
export const TOPBAR_HEIGHT = 40;

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
