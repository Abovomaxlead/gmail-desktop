// Narrowing the label picker to what you type. A mailbox has hundreds of labels and the
// picker shows them all at once, so the search is what makes the list usable.
//
// Every word has to match, in any order, so "week offertes" finds "Offertes/Week 31"
// without knowing how the label is nested. A label that is already ticked stays in the
// list whatever you type: your own choice disappearing while you search for the next one
// reads as if it was undone.


//===========================
// Types
//===========================

export interface SearchableLabel {
  id: string;
  name: string;
}


//===========================
// Exported functions
//===========================

/**
 * The labels a search leaves standing
 *
 * @param labels
 * @param query what was typed; blank shows everything
 * @param pickedIds the labels already ticked, which stay in sight either way
 * @returns the matches plus the ticked ones, in the order they came in
 */
export function filterLabels<T extends SearchableLabel>(
  labels: T[],
  query: string,
  pickedIds: string[],
): T[] {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return labels;
  return labels.filter((label) => {
    if (pickedIds.includes(label.id)) return true;
    const name = (label.name ?? '').toLowerCase();
    return words.every((word) => name.includes(word));
  });
}
