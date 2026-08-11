// What goes in the bar's "+" menu. Pure, so it can be tested without drawing the bar
// and without Electron; main turns the plan into a real OS menu. The ids are exported
// constants so the plan and its handling cannot drift apart.
//
// This used to carry a list of discovered mailboxes to pick from, plus three states around
// it (scanning, suggestions, nothing found), because the only way to find a delegated
// mailbox was to read Gmail's own account menu and work out which entries were new.
//
// Discovery now asks the relay, which reads Google's delegation administration. That removes
// all four things at once: there is nothing to propose, because a delegation Google has
// recorded is a fact rather than a guess; nothing to confirm, so the mailbox simply appears
// in the sidebar; and no "nothing found" to report, because an empty answer means you have no
// delegations rather than that a page had not rendered yet. The scanning line went with them
// — it was ended by the suggestion message arriving, and there is no such message any more,
// so keeping it would have meant a spinner that never stops.

import type { NativeMenuItem } from '../lib/native-menu';

export const PLUS_ADD_ACCOUNT = 'add-account';
export const PLUS_ADD_DELEGATED = 'add-delegated';

export interface PlusMenuStrings {
  addAccountLabel: string;
  addDelegatedLabel: string;
}

export function planPlusMenu(input: { strings: PlusMenuStrings }): NativeMenuItem[] {
  return [
    { kind: 'item', id: PLUS_ADD_ACCOUNT, label: input.strings.addAccountLabel },
    { kind: 'item', id: PLUS_ADD_DELEGATED, label: input.strings.addDelegatedLabel },
  ];
}
