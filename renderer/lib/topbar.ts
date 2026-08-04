// The topbar height, in one place for both processes: contentBounds in
// electron/layout.ts, the titleBarOverlay height (so the real window buttons land
// inside our bar) and the bar's own CSS all read it. If they drift, the view
// overlaps the bar or leaves a strip behind. Keep this module pure data - no
// Electron or DOM imports.
export const TOPBAR_HEIGHT = 40;
