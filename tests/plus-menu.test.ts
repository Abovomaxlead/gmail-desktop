// The "+" menu's contents. Pure, so this needs no bar and no Electron.
//
// The menu used to list delegated mailboxes to pick from, with three states around it
// (scanning, suggestions, nothing found). All of it is gone, because discovery no longer
// reads Gmail's account menu: it asks the relay, which reads Google's delegation
// administration. A mailbox found that way is a fact, so there is nothing to propose and
// nothing to confirm — it appears in the sidebar by itself.
//
// What this test now holds down is that the menu stays two plain actions. If a future change
// wants to report progress here, the thing to be careful about is what ends it: the old
// scanning line was cleared by the suggestion message arriving, and a state with nothing left
// to clear it is a spinner that never stops.

import { describe, expect, it } from 'vitest';
import { planPlusMenu, PLUS_ADD_ACCOUNT, PLUS_ADD_DELEGATED } from '../renderer/app/plus-menu';

const S = {
  addAccountLabel: 'Account toevoegen',
  addDelegatedLabel: 'Gemachtigde postvakken zoeken',
};

describe('planPlusMenu', () => {
  it('offers both actions, in that order, and nothing else', () => {
    expect(planPlusMenu({ strings: S })).toEqual([
      { kind: 'item', id: PLUS_ADD_ACCOUNT, label: S.addAccountLabel },
      { kind: 'item', id: PLUS_ADD_DELEGATED, label: S.addDelegatedLabel },
    ]);
  });
});
