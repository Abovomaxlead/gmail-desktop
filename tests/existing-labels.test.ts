// The warning the picker shows the moment it opens: which mailboxes already hold the mail
// that was just dragged, named in the labels that mailbox actually offers.

import { describe, it, expect } from 'vitest';
import { existingNotices, existingCount, newerExisting } from '../renderer/app/existing-labels';

const account = (email: string, labels: Array<[string, string]>) => ({
  email,
  labels: labels.map(([id, name]) => ({ id, name })),
});

describe('existingNotices', () => {
  it('names the labels the mail already sits under', () => {
    expect(
      existingNotices(
        [{ email: 'a@x.nl', labels: [{ labelId: 'INBOX', count: 1 }, { labelId: 'L1', count: 1 }] }],
        [account('a@x.nl', [['INBOX', 'Postvak IN'], ['L1', 'Klanten']])],
      ),
    ).toEqual([{ email: 'a@x.nl', labels: ['Postvak IN', 'Klanten'] }]);
  });

  it('keeps one mailbox from speaking for another', () => {
    expect(
      existingNotices(
        [{ email: 'b@x.nl', labels: [{ labelId: 'L1', count: 1 }] }],
        [account('a@x.nl', [['L1', 'Klanten']]), account('b@x.nl', [['L1', 'Offertes']])],
      ),
    ).toEqual([{ email: 'b@x.nl', labels: ['Offertes'] }]);
  });

  // The mail is in that mailbox whatever the label list did, so the warning stays; only the
  // names it could not resolve fall away.
  it('still warns when the label list never arrived', () => {
    expect(
      existingNotices([{ email: 'a@x.nl', labels: [{ labelId: 'L1', count: 1 }] }], []),
    ).toEqual([{ email: 'a@x.nl', labels: [] }]);
  });

  it('passes on a mailbox that could not be checked', () => {
    expect(
      existingNotices(
        [{ email: 'a@x.nl', labels: [], error: 'Kon niet controleren' }],
        [account('a@x.nl', [['L1', 'Klanten']])],
      ),
    ).toEqual([{ email: 'a@x.nl', labels: [], error: 'Kon niet controleren' }]);
  });

  it('says nothing when nothing was found', () => {
    expect(existingNotices([], [account('a@x.nl', [['L1', 'Klanten']])])).toEqual([]);
  });
});

describe('existingCount', () => {
  const existing = [{ email: 'a@x.nl', labels: [{ labelId: 'L1', count: 2 }] }];

  it('counts what that one label of that one mailbox already holds', () => {
    expect(existingCount(existing, 'a@x.nl', 'L1')).toBe(2);
  });

  it('is zero for a label that holds none of it', () => {
    expect(existingCount(existing, 'a@x.nl', 'L2')).toBe(0);
    expect(existingCount(existing, 'b@x.nl', 'L1')).toBe(0);
    expect(existingCount([], 'a@x.nl', 'L1')).toBe(0);
  });
});


describe('newerExisting', () => {
  const answer = (serial: number, emails: string[] = []) => ({
    accounts: emails.map((email) => ({ email, labels: [] })),
    scanned: emails.length,
    serial,
    answered: emails.length,
  });

  it('takes the first answer over the empty state it started in', () => {
    expect(newerExisting(answer(0), answer(4, ['a@x.nl']))).toEqual(answer(4, ['a@x.nl']));
  });

  // The scan reports per mailbox, so every push carries more than the one before it
  it('lets a later answer for the same drag replace the one before it', () => {
    const grown = answer(4, ['a@x.nl', 'b@x.nl']);
    expect(newerExisting(answer(4, ['a@x.nl']), grown)).toEqual(grown);
  });

  // A scan that was still running when the next drop came in must not paint over it
  it('ignores an answer belonging to a drag that has been replaced', () => {
    const current = answer(5, ['b@x.nl']);
    expect(newerExisting(current, answer(4, ['a@x.nl']))).toEqual(current);
  });
});

describe('newerExisting, two answers for one drag', () => {
  const answer = (serial: number, answered: number, emails: string[] = []) => ({
    accounts: emails.map((email) => ({ email, labels: [] })),
    scanned: 4,
    serial,
    answered,
  });

  // The reply to the picker's own question and the pushes that follow travel separately, so
  // the emptier of the two can arrive last; the count of mailboxes that answered says which
  // one knows more.
  it('keeps the fuller answer when an older one arrives after it', () => {
    const full = answer(4, 3, ['a@x.nl', 'b@x.nl']);
    expect(newerExisting(full, answer(4, 1, ['a@x.nl']))).toEqual(full);
  });

  it('takes the next answer of the same drag once it knows more', () => {
    const grown = answer(4, 2, ['a@x.nl', 'b@x.nl']);
    expect(newerExisting(answer(4, 1, ['a@x.nl']), grown)).toEqual(grown);
  });

  // A new drop starts over, so the count starting again must not look like going backwards
  it('takes a newer drag even when fewer mailboxes have answered', () => {
    const fresh = answer(5, 0);
    expect(newerExisting(answer(4, 3, ['a@x.nl']), fresh)).toEqual(fresh);
  });
});
