// What one window is told about the tab strip it should draw, once a mailbox can be dragged
// out into a window of its own.
//
// Two lists rather than one, because the two kinds of window ask opposite questions. A
// torn-off window draws exactly the mailboxes it was given. The main window draws everything
// else -- including the rows no window can claim, such as an account remembered from the
// cache whose address detection has not recovered yet -- so it is told what to leave out
// instead of what to show.

export interface WindowTabs {
  /** True for a window made by dragging a tab out of another one. */
  detached: boolean;
  /** The accounts this window hosts. Read by a detached window only. */
  own: string[];
  /** The accounts another window hosts, which this window leaves out of its strip. */
  foreign: string[];
}

/** What a window draws before main has said anything: everything, as it always did. */
export const ALL_TABS: WindowTabs = { detached: false, own: [], foreign: [] };

/**
 * The rows one window draws
 *
 * @param rows every account the app knows, in bar order
 * @param tabs what this window was told
 * @returns the rows for this window's strip, in the order they arrived
 */
export function tabsForWindow<T extends { key: string }>(
  rows: readonly T[],
  tabs: WindowTabs,
): T[] {
  if (tabs.detached) return rows.filter((row) => tabs.own.includes(row.key));
  return rows.filter((row) => !tabs.foreign.includes(row.key));
}
