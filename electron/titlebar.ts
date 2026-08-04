// Sizes and colours for the native window-button overlay Electron draws over our
// topbar, plus the window's own background for the moment before the renderer paints.
// Both read the same two pairs (Tailwind neutral-100/neutral-950, matching the bar in
// the renderer) so there is no seam and a light theme never opens black; the theme
// itself is applied in the renderer, so main computes it here. supportsOverlay and
// supportsOverlayUpdate differ on purpose: the constructor option works on Windows and
// macOS, but setTitleBarOverlay does not exist on macOS, so overlay height there stays
// at its startup value — visible in Rene mode, and accepted over a macOS-only path.
import { TOPBAR_HEIGHT } from './layout';

export interface OverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}

const LIGHT = { color: '#f5f5f5', symbolColor: '#404040' };
const DARK = { color: '#0a0a0a', symbolColor: '#d4d4d4' };

export function isDarkTheme(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
): boolean {
  return choice === 'dark' || (choice === 'system' && systemDark);
}

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
  return { ...colors, height: reneMode ? TOPBAR_HEIGHT * 2 : TOPBAR_HEIGHT };
}

export function supportsOverlay(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

export function supportsOverlayUpdate(platform: string): boolean {
  return platform === 'win32';
}
