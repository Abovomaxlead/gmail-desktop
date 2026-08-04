// Pushes the unread total to the OS badge. On Windows app.setBadgeCount's own 0-clear
// does not stick if the window was hidden to the tray as unread dropped, leaving a
// stale taskbar number — hence the separate clearOverlay callback for that case.

import { totalUnread } from './badge-math';

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
