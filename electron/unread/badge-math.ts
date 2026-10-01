// Sums the per-account unread counts for the taskbar badge, skipping accounts the
// user excluded and any non-finite value.


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * Sums the unread counts that belong in the badge
 *
 * @param counts unread per accountKey
 * @param excluded accounts the user left out of the badge
 * @returns the total
 */
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
