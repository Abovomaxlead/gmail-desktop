// Folding the relay's membership answers onto the stored mailboxes, in both directions.
//
// The store only ever grew, so a delegation revoked on Google's side stayed in the sidebar
// with a url that no longer opens anything. Removing is the dangerous half: the relay answers
// per requester and one requester's set is not the whole truth, so absence only means
// something when every own account has answered.

import { describe, it, expect } from 'vitest';
import {
  reconcileDelegations,
  type RequesterAnswer,
} from '../electron/delegation/delegated-reconcile';

const ok = (email: string, ...mailboxes: string[]): RequesterAnswer => ({
  ok: true,
  email,
  mailboxes,
});
const failed = (email: string, error = 'HTTP 503'): RequesterAnswer => ({ ok: false, email, error });

describe('reconcileDelegations', () => {
  it('adds what the relay names and the store does not hold', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl', 'bart@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at.add).toEqual(['bart@abovomaxlead.nl']);
    expect(at.remove).toEqual([]);
    expect(at.why).toBe('reconciled');
  });

  // The half that was missing: a delegation revoked on Google's side has to leave the store,
  // or the app goes on showing a view for a mailbox that cannot be opened.
  it('removes what the relay no longer names, once every requester has said so', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'bart@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at.remove).toEqual(['support@abovomaxlead.nl']);
    expect(at.add).toEqual([]);
    expect(at.complete).toBe(true);
  });

  // An empty answer is the one that would wipe the sidebar. A relay that answers 200 with
  // nothing in it -- a deploy mid-rollout, a scope lost, an account outside the domain -- is
  // not a person having every delegation revoked in the same second.
  it('never reads an empty answer as every delegation revoked', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at.remove).toEqual([]);
    expect(at.why).toBe('empty');
  });

  // requestersInOrder() walks every own account and the relay answers for the requester it
  // was asked as, so a mailbox delegated to the second account is absent from the first
  // account's set for a reason that has nothing to do with revocation.
  it('keeps a mailbox only one requester can see', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl'],
      answers: [
        ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl'),
        ok('tweede@abovomaxlead.nl', 'bart@abovomaxlead.nl'),
      ],
      requesters: 2,
    });
    expect(at.remove).toEqual([]);
    expect(at.add).toEqual([]);
    expect(at.why).toBe('reconciled');
  });

  it('still removes a mailbox no requester can see', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl', 'weg@abovomaxlead.nl'],
      answers: [
        ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl'),
        ok('tweede@abovomaxlead.nl', 'bart@abovomaxlead.nl'),
      ],
      requesters: 2,
    });
    expect(at.remove).toEqual(['weg@abovomaxlead.nl']);
  });

  // One requester failing is the case that must not cost a mailbox: the account whose answer
  // never arrived is exactly the one that might have named it.
  it('removes nothing when a requester could not be asked', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'bart@abovomaxlead.nl'), failed('tweede@abovomaxlead.nl')],
      requesters: 2,
    });
    expect(at.remove).toEqual([]);
    expect(at.complete).toBe(false);
    expect(at.why).toBe('incomplete');
  });

  // Fewer answers than own accounts is the same doubt as a failure: an account with no usable
  // token is never asked at all, so it leaves no answer behind to fail.
  it('removes nothing when an account was never asked', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl', 'bart@abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'bart@abovomaxlead.nl')],
      requesters: 2,
    });
    expect(at.remove).toEqual([]);
    expect(at.why).toBe('incomplete');
  });

  // Adding, on the other hand, is always safe: one requester naming a mailbox is proof that
  // mailbox exists, whatever the others did.
  it('still adds from the one requester that answered', () => {
    const at = reconcileDelegations({
      stored: [],
      answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl'), failed('tweede@abovomaxlead.nl')],
      requesters: 2,
    });
    expect(at.add).toEqual(['support@abovomaxlead.nl']);
    expect(at.remove).toEqual([]);
  });

  it('does nothing at all when no answer arrived', () => {
    const at = reconcileDelegations({
      stored: ['support@abovomaxlead.nl'],
      answers: [failed('luca@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at).toEqual({ add: [], remove: [], complete: false, why: 'no-answer' });
  });

  it('does nothing when there is no own account to ask as', () => {
    expect(
      reconcileDelegations({ stored: ['support@abovomaxlead.nl'], answers: [], requesters: 0 }),
    ).toEqual({ add: [], remove: [], complete: false, why: 'no-answer' });
  });

  // Addresses arrive from two places that spell them differently, so both sides are compared
  // lowercased -- otherwise a mailbox stored as Support@ is added a second time and removed
  // in the same breath.
  it('matches addresses without caring about case', () => {
    const at = reconcileDelegations({
      stored: ['Support@Abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'support@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at.add).toEqual([]);
    expect(at.remove).toEqual([]);
  });

  it('keeps the stored spelling of what it names for removal', () => {
    const at = reconcileDelegations({
      stored: ['Weg@Abovomaxlead.nl'],
      answers: [ok('luca@abovomaxlead.nl', 'bart@abovomaxlead.nl')],
      requesters: 1,
    });
    expect(at.remove).toEqual(['Weg@Abovomaxlead.nl']);
    expect(at.add).toEqual(['bart@abovomaxlead.nl']);
  });
});
