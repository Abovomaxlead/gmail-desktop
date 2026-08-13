// What a drop's result leaves the modal to do: offer labels, or say why there is nothing to
// copy. A drag that saved nothing would otherwise open a picker that cannot be submitted —
// tick a label, and the Kopieer button stays dead. A mail dragged out of a delegated mailbox
// is exactly that case: it comes back as an HTTP 403 and saves nothing.
//
// A partial drag is not a failure here. Three of five saved means two reasons and three mails
// to file, and the picker is how they get filed.
//
// The reasons are deduplicated because a label drag reports per conversation, and forty rows
// that all failed on the same refusal are one fact, not forty.


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

// The answer when every conversation saved nothing and none of them said why. Something has
// to be shown, and an empty error box reads as if the modal itself broke.
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
