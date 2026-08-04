// Sums the per-account unread counts for the taskbar badge, skipping accounts the
// user excluded and any non-finite value.

export function totalUnread(
  counts: Record<string, number>,
  excluded: Set<string> = new Set(),
): number {
  return Object.entries(counts).reduce(
    (sum, [key, n]) =>
      excluded.has(key) || !Number.isFinite(n) ? sum : sum + n,
    0,
  );
}
