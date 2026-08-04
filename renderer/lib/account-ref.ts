// Stable, self-describing account identity used across the view layer and IPC.
// Pure data - no Electron or DOM imports.

export type AccountRef =
  | { kind: 'authuser'; index: number }
  | { kind: 'delegated'; email: string; mailUrl: string; calendarUrl: string | null };

export function accountKey(ref: AccountRef): string {
  return ref.kind === 'authuser' ? `u${ref.index}` : `d:${ref.email}`;
}

export function parseAccountKey(
  key: string,
): { kind: 'authuser'; index: number } | { kind: 'delegated'; email: string } {
  if (key.startsWith('d:')) return { kind: 'delegated', email: key.slice(2) };
  return { kind: 'authuser', index: Number(key.slice(1)) };
}
