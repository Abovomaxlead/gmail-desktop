// Sizes and colours for the native window-button overlay Electron draws over our
// topbar, plus the window's own background for the moment before the renderer paints.
// Both read the same two pairs (Tailwind neutral-100/neutral-950, matching the bar in
// the renderer) so there is no seam and a light theme never opens black; the theme
// itself is applied in the renderer, so main computes it here. supportsOverlay and
// supportsOverlayUpdate differ on purpose: the constructor option works on Windows and
// macOS, but setTitleBarOverlay does not exist on macOS, so overlay height there stays
// at its startup value — visible in Rene mode, and accepted over a macOS-only path.
import { TOPBAR_HEIGHT } from './layout';



//===========================
// Types
//===========================

export interface OverlayOptions {
  color: string;
  symbolColor: string;
  height: number;
}


//===========================
// Constants
//===========================

const LIGHT = { color: '#f5f5f5', symbolColor: '#404040' };
const DARK = { color: '#0a0a0a', symbolColor: '#d4d4d4' };


//===========================
// Exported functions
//===========================

/**
 * Resolves the theme choice against what the OS reports
 *
 * @param choice
 * @param systemDark
 * @returns true when the window should draw dark
 */
export function isDarkTheme(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
): boolean {
  return choice === 'dark' || (choice === 'system' && systemDark);
}

/**
 * The colour the window paints before the renderer has drawn anything
 *
 * @param choice
 * @param systemDark
 * @returns a hex colour matching the topbar
 */
export function windowBackground(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
): string {
  return (isDarkTheme(choice, systemDark) ? DARK : LIGHT).color;
}

/**
 * Colours and height for the native window-button overlay
 *
 * @param choice
 * @param systemDark
 * @param reneMode doubles the overlay height, matching the doubled topbar
 * @returns options for titleBarOverlay
 */
export function overlayOptions(
  choice: 'system' | 'light' | 'dark',
  systemDark: boolean,
  reneMode: boolean,
): OverlayOptions {
  const colors = isDarkTheme(choice, systemDark) ? DARK : LIGHT;
  return { ...colors, height: reneMode ? TOPBAR_HEIGHT * 2 : TOPBAR_HEIGHT };
}

/**
 * Whether the platform can draw the overlay at all
 *
 * @param platform
 * @returns true on Windows and macOS
 */
export function supportsOverlay(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Whether the platform can change the overlay after the window exists
 *
 * @param platform
 * @returns true on Windows only; macOS has no setTitleBarOverlay
 */
export function supportsOverlayUpdate(platform: string): boolean {
  return platform === 'win32';
}
