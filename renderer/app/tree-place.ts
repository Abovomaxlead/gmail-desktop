// What the first row of the picker says when a dragged structure is being placed.
//
// With the structure switched on, the row that does the right thing almost every time is the
// top of the list: the copy then carries the source names unchanged, so a mailbox that already
// has `Klanten` gets its mail added to that `Klanten` instead of a second one beside it. Read
// as "Bovenin" that is the one row a user does not pick, because it sounds like dumping the
// mail loose at the root -- the opposite of what it does. So the row says what happens instead
// of where it sits, and the wording depends on whether the target already has the structure.
//
// Only the top row needs this: every other row is a label, and its own name already says where
// the mail goes.

import type { UiStrings } from './strings';

//===========================
// Types
//===========================

/** The first row's two lines: what it does, and what that means for the target's labels */
export interface TreePlace {
  name: string;
  hint: string;
}


//===========================
// Exported functions
//===========================

/**
 * How the top-of-the-list row reads for one mailbox
 *
 * The dragged label's first segment decides it, because that is the label the copy reuses or
 * creates first -- dragging `Klanten/Acme` into a mailbox that has `Klanten` joins that one.
 * Compared in lower case, the way Gmail compares label names itself.
 *
 * @param dragged the label the drag started on
 * @param labels the target mailbox's own labels
 * @param S the active string set
 * @returns the row's label and the line under it
 */
export function treeTopPlace(
  dragged: string,
  labels: readonly { name: string }[],
  S: UiStrings,
): TreePlace {
  const root = dragged.split('/')[0];
  const wanted = root.toLocaleLowerCase('nl');
  const merges = labels.some((l) => l.name.toLocaleLowerCase('nl') === wanted);
  return merges
    ? { name: S.mdTreeMergeInto(root), hint: S.mdTreeMergeHint }
    : { name: S.mdTreeNewTop(root), hint: S.mdTreeNewTopHint };
}
