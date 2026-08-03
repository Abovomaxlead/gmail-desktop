// De hoogte van de topbar, op één plek voor beide processen. Drie dingen lezen
// deze waarde: contentBounds in electron/layout.ts (die de Gmail-view eronder
// inzet), de hoogte van titleBarOverlay (zodat de echte vensterknoppen precies
// in onze balk vallen) en de CSS van de balk zelf. Lopen die uiteen, dan
// overlapt de view de balk of blijft er een streep over.
//
// Het staat onder renderer/ omdat Next.js niets buiten zijn eigen root kan
// compileren, terwijl esbuild (de main-bundle) en vitest overal vandaan mogen
// importeren — dezelfde reden als bij surfaces.ts. Houd deze module pure data:
// geen Electron- of DOM-imports.
export const TOPBAR_HEIGHT = 40;
