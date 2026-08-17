// What a drop's result leaves the modal to do: offer labels, or say why there is nothing to
// copy. A drag that saved nothing would otherwise open a picker that cannot be submitted.
//
// A partial drag is not a failure here — three of five saved still leaves three to file.
// The reasons are deduplicated, since a label drag reports per conversation and forty rows
// failing on one refusal are one fact.


//===========================
// Types
//===========================

export interface DropOutcomeItem {
  saved: number;
  error?: string;
}


//===========================
// Constants
//===========================

export const NOTHING_SAVED = 'Niets opgeslagen';


//===========================
// Exported functions
//===========================

/**
 * The reasons a drop has nothing to copy
 *
 * @param items one per dragged conversation
 * @returns the distinct reasons, or nothing while at least one mail was saved
 */
export function dropFailures(items: DropOutcomeItem[]): string[] {
  if (items.length === 0) return [];
  if (items.some((i) => i.saved > 0)) return [];
  const reasons: string[] = [];
  for (const item of items) {
    const reason = (item.error ?? '').trim();
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons.length > 0 ? reasons : [NOTHING_SAVED];
}
