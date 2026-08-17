// What goes in the bar's "+" menu. Pure, so it can be tested without drawing the bar; main
// turns the plan into a real OS menu. The ids are exported constants so the plan and its
// handling cannot drift apart.
//
// No suggestion list and no scanning state: discovery asks the relay, and a delegation
// Google has recorded is a fact rather than something to propose and confirm.

import type { NativeMenuItem } from '../lib/native-menu';

export const PLUS_ADD_ACCOUNT = 'add-account';
export const PLUS_ADD_DELEGATED = 'add-delegated';

export interface PlusMenuStrings {
  addAccountLabel: string;
  addDelegatedLabel: string;
}

/**
 * What goes in the bar's "+" menu
 *
 * @param input
 * @returns {NativeMenuItem[]}
 */
export function planPlusMenu(input: { strings: PlusMenuStrings }): NativeMenuItem[] {
  return [
    { kind: 'item', id: PLUS_ADD_ACCOUNT, label: input.strings.addAccountLabel },
    { kind: 'item', id: PLUS_ADD_DELEGATED, label: input.strings.addDelegatedLabel },
  ];
}
