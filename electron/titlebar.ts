import { TOPBAR_HEIGHT } from './layout';

// Electron tekent de echte vensterknoppen als overlay bovenop onze topbar. Wij
// leveren alleen de maten en de kleuren aan. Die kleuren moeten meelopen met het
// thema, want anders staan de knoppen donker-op-donker zodra je omschakelt.
export interface OverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

// Dezelfde waarden als de achtergrond van de balk in de renderer: Tailwind's
// neutral-100 en neutral-950. Wijken ze af, dan zie je een naad tussen de balk
// en het gebied waar de knoppen staan.
const LIGHT = { color: '#f5f5f5', symbolColor: '#404040' };
const DARK = { color: '#0a0a0a', symbolColor: '#d4d4d4' };

// Het thema wordt in de renderer toegepast (een class op <html>), dus main kan
// het niet uit de DOM lezen en rekent het hier zelf uit.
export function isDarkTheme(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
): boolean {
  return choice === 'dark' || (choice === 'system' && systemDark);
}

export function overlayOptions(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
  reneMode: boolean,
): OverlayOptions {
  const colors = isDarkTheme(choice, systemDark) ? DARK : LIGHT;
  // Rene-modus zoomt de renderer naar 200%, dus de balk tekent twee keer zo
  // hoog. De overlay rekent in vensterpixels en zoomt niet mee.
  return { ...colors, height: reneMode ? TOPBAR_HEIGHT * 2 : TOPBAR_HEIGHT };
}

// titleBarStyle: 'hidden' en titleBarOverlay bestaan alleen op Windows en macOS.
// Op Linux houden we het native frame: het is geen doelplatform, maar er wordt
// wel onder WSL ontwikkeld en de app mag daar niet omvallen.
export function supportsOverlay(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}
