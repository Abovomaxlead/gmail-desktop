// The warning the picker shows the moment it opens: which mailboxes already hold the mail
// that was just dragged, named in the labels that mailbox actually offers.

import { describe, it, expect } from 'vitest';
import { existingNotices, existingCount } from '../renderer/app/existing-labels';

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
