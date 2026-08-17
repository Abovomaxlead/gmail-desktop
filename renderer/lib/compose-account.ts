// Types and pure helpers shared between main, the compose-account overlay page, and its
// preload bridge.
//
// The payload carries everything the page needs without an extra round trip, the locale
// included — a short-lived dialog that asked prefs for its own language would risk one
// frame in the wrong one.


//===========================
// Types
//===========================

export interface ComposeAccountChoice {
  index: number;
  email: string;
  label: string;
  color: string;
  avatarUrl: string;
}

export interface ComposeAccountAsk {
  to: string;
  subject: string;
  accounts: ComposeAccountChoice[];
  locale: 'en' | 'nl';
  reneMode: boolean;
}


//===========================
// Exported functions
//===========================

/**
 * The digit a row shows
 *
 * @param row
 * @returns null past the ninth, where rows are pickable by click only
 */
export function shortcutFor(row: number): string | null {
  return row >= 0 && row < 9 ? String(row + 1) : null;
}

/**
 * The row a keypress picks
 *
 * The other end of the same mapping as shortcutFor, kept separate because a row past the
 * ninth is still pickable by click even though it has no digit left to show.
 *
 * @param key
 * @param count
 * @returns the row, or null when the key is not a shortcut for this list
 */
export function rowForKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const row = Number(key) - 1;
  return row < count ? row : null;
}

/**
 * The row an arrow key moves to, wrapping at both ends
 *
 * Pulled out of the component so the wrap is assertable: the page draws its focus ring from
 * the index it tracks rather than from :focus-visible, which Chromium will not match for a
 * programmatic .focus().
 *
 * @param current
 * @param count
 * @param dir 1 for down, -1 for up
 * @returns the row to focus
 */
export function nextFocusIndex(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return (((current + dir) % count) + count) % count;
}
