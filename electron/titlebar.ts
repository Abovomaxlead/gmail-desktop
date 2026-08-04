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

// De kleur die het venster zelf heeft zolang de renderer nog niets heeft
// getekend. Dat moment is er altijd -- bij het opstarten, en in ontwikkelmodus
// seconden lang omdat de devserver eerst compileert -- en wat je dan ziet is
// deze kleur over de volle hoogte, dus ook waar de balk komt.
//
// Hij loopt om dezelfde reden met het thema mee als de overlay hierboven: stond
// hij vast op de donkere waarde, dan opende een licht thema met een zwarte balk
// die daarna omklapt. Zelfde bron als de overlay, zodat de twee niet uiteen
// kunnen lopen.
export function windowBackground(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
): string {
  return (isDarkTheme(choice, systemDark) ? DARK : LIGHT).color;
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

// Mag het venster frameloos, met titleBarStyle: 'hidden' en de titleBarOverlay-
// optie? Op Windows tekent Electron dan de knoppen in onze balk, op macOS zet
// het de stoplichten op de juiste plek. Op Linux houden we het native frame: het
// is geen doelplatform, maar er wordt wel onder WSL ontwikkeld en de app mag
// daar niet omvallen.
export function supportsOverlay(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

// Mag de overlay ná het aanmaken nog bijgewerkt worden? Dat is een ander
// antwoord dan hierboven, en dat is verrassend genoeg een zin waard: de
// constructor-optie en de setter hebben niet dezelfde platformdekking.
// win.setTitleBarOverlay staat in Electron als win32,linux — op macOS bestaat de
// methode niet en zou elke aanroep een TypeError geven. Linux valt hier af omdat
// we daar de overlay helemaal niet aanzetten (zie supportsOverlay), dus Windows
// is de enige plek waar we hem zowel zetten als kunnen bijwerken.
//
// Gevolg op macOS is tweeledig, want deze setter draagt beide waarden.
//
// De kleuren van de overlay lopen na het opstarten niet mee met een themawissel.
// Dat is daar het minste probleem: macOS kleurt zijn stoplichten toch zelf
// (symbolColor is er niet eens ondersteund).
//
// De hóogte loopt evenmin mee, en dat is het zwaarste van de twee: in Rene-modus
// zoomt de renderer naar 200%, dus de balk tekent 80px, terwijl de overlay op de
// 40px van het opstarten blijft staan. De stoplichten hangen dan in de bovenste
// helft van een dubbelhoge balk. macOS is een buildtarget, dus dit is een echt
// gebrek daar en geen theorie — het blijft bewust staan omdat niet throwen meer
// waard is dan meelopen, en een macOS-eigen pad de prijs niet waard is zolang
// Rene-modus daar geen gebruiker heeft.
export function supportsOverlayUpdate(platform: string): boolean {
  return platform === 'win32';
}
