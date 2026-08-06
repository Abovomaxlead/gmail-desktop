// Types and pure helpers shared between main, the compose-account overlay page, and its
// preload bridge. The payload carries everything the page needs to render without an
// extra round trip: the recipient and subject parseMailto already extracted, plus one
// choice per signed-in account with its own colour and avatar, and the locale to render
// in — resolved by main rather than by the page, since a short-lived dialog that asked
// prefs for its own language would risk one frame in the wrong one. shortcutFor and
// rowForKey are the two ends of the same mapping — the digit a row shows, and the row a
// keypress picks — kept as separate functions because a row past the ninth is still
// pickable by click even though it has no digit left to show.

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

/** The digit that picks a row, or null past the ninth. Rows beyond nine are pickable by click only. */
export function shortcutFor(row: number): string | null {
  return row >= 0 && row < 9 ? String(row + 1) : null;
}

/** Maps a keypress to a row index, or null when the key is not a shortcut for this list. */
export function rowForKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const row = Number(key) - 1;
  return row < count ? row : null;
}
