// Rene mode: everything renders at 170%. Chromium zoom levels relate to the visual
// factor as factor = 1.2 ** level, so factor 1.7 needs level ~3.16 — deliberately
// outside the plus/minus 3 range the manual zoom shortcuts use.
export const RENE_ZOOM_FACTOR = 1.7;
export const RENE_ZOOM_LEVEL = Math.log(RENE_ZOOM_FACTOR) / Math.log(1.2);
