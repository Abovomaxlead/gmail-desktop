// What goes in the bar's "+" menu. Pure, so it can be tested without drawing the bar
// and without Electron; main turns the plan into a real OS menu. The ids are exported
// constants so the plan and its handling cannot drift apart, and a discovered mailbox
// carries its address in its id. The three states (scanning, suggestions, nothing
// found) are only seen on reopening, since an OS menu closes on click - the dot on
// the "+" says there is something to see.

import type { NativeMenuItem } from '../lib/native-menu';

export const PLUS_ADD_ACCOUNT = 'add-account';
export const PLUS_ADD_DELEGATED = 'add-delegated';

const SUGGESTION_PREFIX = 'suggestion:';
export const suggestionId = (email: string): string => `${SUGGESTION_PREFIX}${email}`;
export function suggestionEmail(id: string): string | null {
  return id.startsWith(SUGGESTION_PREFIX) ? id.slice(SUGGESTION_PREFIX.length) : null;
}

export interface PlusMenuStrings {
  addAccountLabel: string;
  addDelegatedLabel: string;
  delegatedScanning: string;
  delegatedSuggestionsHeading: string;
  delegatedNoneFound: string;
}

export function planPlusMenu(input: {
  strings: PlusMenuStrings;
  suggestions: readonly { email: string }[];
  scanning: boolean;
  scanDone: boolean;
}): NativeMenuItem[] {
  const { strings: S, suggestions, scanning, scanDone } = input;
  const items: NativeMenuItem[] = [
    { kind: 'item', id: PLUS_ADD_ACCOUNT, label: S.addAccountLabel },
    { kind: 'item', id: PLUS_ADD_DELEGATED, label: S.addDelegatedLabel },
  ];
  if (scanning) {
    items.push({ kind: 'text', label: S.delegatedScanning });
  } else if (suggestions.length > 0) {
    items.push({ kind: 'separator' }, { kind: 'text', label: S.delegatedSuggestionsHeading });
    for (const s of suggestions) {
      items.push({ kind: 'item', id: suggestionId(s.email), label: s.email });
    }
  } else if (scanDone) {
    items.push({ kind: 'text', label: S.delegatedNoneFound });
  }
  return items;
}
