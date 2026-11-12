// Gmail's "select all N in this view": the banner's second step, after the toolbar box has ticked
// every row on the page. From then on Gmail acts on every mail of the list, while the page only
// ever ticks the rows it drew -- fifty, or a hundred with a larger page size. A drag that read
// the ticked rows carried those and left the rest behind without a word: measured on a label of
// 153 at 100 per page, the drag held 100 rows.
//
// So the page says which list was selected, and main asks the API for every mail of that list.
// What the list is comes from the URL hash, the one place Gmail names it language-independently.
//
// The banner itself is known by Gmail's logging id on its "clear selection" link, which exists
// only while the whole list is selected. Not by its text, which is translated, nor by its
// class, which is obfuscated: that id is the only mark it carries that is neither.

import { labelFromHref } from './label-drop';
import type { DragRow } from './dropzone';


//===========================
// Types
//===========================

/** A list of Gmail's, in the terms the API lists it in. A user label travels by name, because
 * only main can resolve a name to the label's id. */
export type ListView =
  | { kind: 'label'; name: string }
  | { kind: 'query'; labelIds: string[]; q: string; includeSpamTrash: boolean };

/** What a drag carries when Gmail has the whole list selected. */
export interface WholeView {
  /** The list, or null when the page showed one the API cannot be asked for -- a drag main has to
   * refuse, since saving only the rows on screen is the bug this exists to prevent. */
  view: ListView | null;
  /** How many Gmail's banner said were selected, for the log; null when it could not be read. */
  count: number | null;
  /** 'message' with conversation view off, where every row is one mail; 'thread' with it on. */
  unit: 'message' | 'thread';
}


//===========================
// Constants
//===========================

/** Gmail's logging id for the "clear selection" link the banner shows once the whole list is
 * selected. The "select all N" link before it carries 125945. */
export const WHOLE_SELECTION_MARK = '125946';

/** The views that are one system label, or none for All Mail. Spam and trash are left out of
 * every listing unless asked for, so those two ask. */
const SYSTEM_VIEWS: Record<string, { labelIds: string[]; includeSpamTrash: boolean }> = {
  starred: { labelIds: ['STARRED'], includeSpamTrash: false },
  sent: { labelIds: ['SENT'], includeSpamTrash: false },
  drafts: { labelIds: ['DRAFT'], includeSpamTrash: false },
  imp: { labelIds: ['IMPORTANT'], includeSpamTrash: false },
  all: { labelIds: [], includeSpamTrash: false },
  spam: { labelIds: ['SPAM'], includeSpamTrash: true },
  trash: { labelIds: ['TRASH'], includeSpamTrash: true },
};

const CATEGORY_VIEWS: Record<string, string> = {
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};


//===========================
// Exported functions
//===========================

/**
 * Whether an element's jslog marks the banner of a whole-list selection
 *
 * @param jslog the attribute as Gmail writes it: the id first, then `;`-separated data
 * @returns true for exactly that id, never for one that only starts with it
 */
export function isWholeSelectionMark(jslog: string | null): boolean {
  return (jslog ?? '').split(';')[0].trim() === WHOLE_SELECTION_MARK;
}

/**
 * Reads a count out of the banner's bold number
 *
 * @param text "153", or "1.234" / "1,234" as the locale groups it
 * @returns the number, or null when there are no digits in it
 */
export function bannerCount(text: string | null | undefined): number | null {
  const digits = (text ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/**
 * The list a Gmail URL hash shows
 *
 * The inbox is two lists depending on the account: with category tabs it shows Primary only,
 * and the other tabs have hashes of their own.
 *
 * @param hash location.hash, with or without the '#'; a page suffix (/p3) is ignored, since
 *   selecting the whole list selects every page of it
 * @param tabbedInbox whether the inbox is split into category tabs
 * @returns the list, or null for a view the API cannot list the same way
 */
export function listViewFromHash(hash: string, tabbedInbox: boolean): ListView | null {
  const m = /^#?([^/?]+)(?:\/([^?]*))?/.exec(hash ?? '');
  if (!m) return null;
  const [, kind, rawRest = ''] = m;
  const rest = rawRest.replace(/\/p\d+$/, '');
  const query = (labelIds: string[], q = '', includeSpamTrash = false): ListView => ({
    kind: 'query',
    labelIds,
    q,
    includeSpamTrash,
  });

  if (kind === 'label') {
    const name = labelFromHref(`#label/${rest}`);
    return name ? { kind: 'label', name } : null;
  }
  if (kind === 'search') {
    let q: string;
    try {
      q = decodeURIComponent(rest.replace(/\+/g, ' ')).trim();
    } catch {
      return null;
    }
    return q ? query([], q) : null;
  }
  if (rest) {
    if (kind !== 'category') return null;
    const id = CATEGORY_VIEWS[rest];
    return id ? query([id]) : null;
  }
  if (kind === 'inbox') return query(['INBOX'], tabbedInbox ? 'category:primary' : '');
  const system = SYSTEM_VIEWS[kind];
  return system ? query(system.labelIds, '', system.includeSpamTrash) : null;
}

/**
 * What a drag carries for a whole-list selection
 *
 * @param hash location.hash of the page the drag started on
 * @param tabbedInbox whether the inbox is split into category tabs
 * @param count what the banner counted
 * @param rows the ticked rows on screen, which tell a message list from a conversation list
 * @returns the selection to hand to main
 */
export function wholeViewOf(
  hash: string,
  tabbedInbox: boolean,
  count: number | null,
  rows: DragRow[],
): WholeView {
  return {
    view: listViewFromHash(hash, tabbedInbox),
    count,
    unit: rows.some((row) => row.message) ? 'message' : 'thread',
  };
}
