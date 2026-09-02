// Pushes the unread total to the OS badge. On Windows app.setBadgeCount's own 0-clear
// does not stick if the window was hidden to the tray as unread dropped, leaving a
// stale taskbar number — hence the separate clearOverlay callback for that case.

import { totalUnread } from './badge-math';


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * Pushes the unread total to the OS badge
 *
 * @param counts unread per accountKey
 * @param setBadge receives the total
 * @param excluded accounts the user left out of the badge
 * @param clearOverlay called at zero, for the Windows case setBadgeCount misses
 * @returns the total that was pushed
 */
export function applyBadge(
  counts: Record<string, number>,
  setBadge: (n: number) => void,
  excluded: Set<string> = new Set(),
  clearOverlay?: () => void,
): number {
  const total = totalUnread(counts, excluded);
  setBadge(total);
  if (total === 0) clearOverlay?.();
  return total;
}
