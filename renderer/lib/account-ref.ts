// Stable, self-describing account identity used across the view layer and IPC.
// Pure data - no Electron or DOM imports.

export type AccountRef =
  | { kind: 'authuser'; index: number }
  | { kind: 'delegated'; email: string; mailUrl: string | null; calendarUrl: string | null };

/**
 * The string an account is filed under
 *
 * @param ref
 * @returns "u<index>" for an owned account, "d:<email>" for a delegated mailbox — note
 *   the colon, which is why a view key is split on the last one
 */
export function accountKey(ref: AccountRef): string {
  return ref.kind === 'authuser' ? `u${ref.index}` : `d:${ref.email}`;
}

/**
 * Reads an account key back
 *
 * @param key
 * @returns what the key says; the delegated URLs are not part of it and have to be
 *   looked up
 */
export function parseAccountKey(
  key: string,
): { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string } {
  if (key.startsWith('d:')) return { kind: 'delegated', email: key.slice(2) };
  return { kind: 'authuser', index: Number(key.slice(1)) };
}
