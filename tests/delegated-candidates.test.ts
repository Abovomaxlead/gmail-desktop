// Which mailboxes the add-button offers.
//
// Discovery and adding used to be one act, so pressing the button pulled in every mailbox the
// domain had ever delegated. Now the relay's answer becomes a list to choose from, and the
// only things it may never contain are a mailbox that is already in the bar and one of the
// user's own accounts -- either would draw the same mailbox twice.

import { describe, it, expect } from 'vitest';
import { pickableMailboxes } from '../electron/delegation/delegated-candidates';
import type { RequesterAnswer } from '../electron/delegation/delegated-reconcile';

const ok = (email: string, ...mailboxes: string[]): RequesterAnswer => ({
  ok: true,
  email,
  mailboxes,
});
const failed = (email: string, error = 'HTTP 503'): RequesterAnswer => ({ ok: false, email, error });

describe('pickableMailboxes', () => {
  it('offers what the relay names and the store does not hold', () => {
    expect(
      pickableMailboxes({
        answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl', 'bart@abovomaxlead.nl')],
        stored: ['support@abovomaxlead.nl'],
        own: ['luca@abovomaxlead.nl'],
      }),
    ).toEqual(['bart@abovomaxlead.nl']);
  });

  // Detection owns the user's own accounts. A relay that happens to name one must not turn it
  // into a delegated row beside the real one.
  it('never offers one of the own accounts', () => {
    expect(
      pickableMailboxes({
        answers: [ok('luca@abovomaxlead.nl', 'luca@abovomaxlead.nl')],
        stored: [],
        own: ['Luca@Abovomaxlead.nl'],
      }),
    ).toEqual([]);
  });

  // Unlike removal, offering does not argue from absence: one requester naming a mailbox is
  // enough, whatever the others failed to say.
  it('offers what a single answering requester named', () => {
    expect(
      pickableMailboxes({
        answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl'), failed('tweede@abovomaxlead.nl')],
        stored: [],
        own: [],
      }),
    ).toEqual(['support@abovomaxlead.nl']);
  });

  it('names a mailbox once when two requesters both reach it', () => {
    expect(
      pickableMailboxes({
        answers: [
          ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl'),
          ok('tweede@abovomaxlead.nl', 'Support@Abovomaxlead.nl'),
        ],
        stored: [],
        own: [],
      }),
    ).toEqual(['support@abovomaxlead.nl']);
  });

  // The store and the relay spell addresses differently, and a mailbox offered again because
  // of a capital letter is one the user adds twice.
  it('matches the store without caring about case', () => {
    expect(
      pickableMailboxes({
        answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl')],
        stored: ['Support@Abovomaxlead.nl'],
        own: [],
      }),
    ).toEqual([]);
  });

  // Two asks in a row must not reshuffle the list under the pointer.
  it('keeps one order whatever order the answers came in', () => {
    const answers = [ok('luca@abovomaxlead.nl', 'zus@abovomaxlead.nl', 'aap@abovomaxlead.nl')];
    expect(pickableMailboxes({ answers, stored: [], own: [] })).toEqual([
      'aap@abovomaxlead.nl',
      'zus@abovomaxlead.nl',
    ]);
  });

  it('offers nothing when no answer arrived', () => {
    expect(
      pickableMailboxes({ answers: [failed('luca@abovomaxlead.nl')], stored: [], own: [] }),
    ).toEqual([]);
  });
});
