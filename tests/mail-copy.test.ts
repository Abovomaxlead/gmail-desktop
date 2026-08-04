// Copying dragged mail into labels: targets, totals and duplicate detection.

import { describe, it, expect } from 'vitest';
import {
  normalizeTargets,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  newMessageCount,
} from '../electron/mail-copy';

describe('normalizeTargets', () => {
  it('keeps what was picked', () => {
    expect(normalizeTargets([{ email: 'a@x.nl', labelIds: ['L1', 'L2'] }])).toEqual([
      { email: 'a@x.nl', labelIds: ['L1', 'L2'] },
    ]);
  });

  it('merges the same account into one insert', () => {
    expect(
      normalizeTargets([
        { email: 'a@x.nl', labelIds: ['L1'] },
        { email: 'a@x.nl', labelIds: ['L2'] },
      ]),
    ).toEqual([{ email: 'a@x.nl', labelIds: ['L1', 'L2'] }]);
  });

  it('drops a duplicate label so the mail lands once', () => {
    expect(normalizeTargets([{ email: 'a@x.nl', labelIds: ['L1', 'L1'] }])[0].labelIds).toEqual([
      'L1',
    ]);
  });

  it('skips an account without labels', () => {
    expect(
      normalizeTargets([
        { email: 'a@x.nl', labelIds: [] },
        { email: 'b@x.nl', labelIds: ['L1'] },
      ]),
    ).toEqual([{ email: 'b@x.nl', labelIds: ['L1'] }]);
  });

  it('skips junk instead of building a request out of it', () => {
    expect(normalizeTargets([{ email: '  ', labelIds: ['L1'] }])).toEqual([]);
    expect(normalizeTargets([{ email: 'a@x.nl', labelIds: ['', 'L1'] }])[0].labelIds).toEqual([
      'L1',
    ]);
  });
});

describe('copyTotal', () => {
  it('counts one insert per message per account', () => {
    expect(
      copyTotal(
        [
          { email: 'a@x.nl', labelIds: ['L1', 'L2'] },
          { email: 'b@x.nl', labelIds: ['L1'] },
        ],
        7,
      ),
    ).toBe(14);
  });
});

describe('groupDuplicates', () => {
  const hit = (email: string, labelId: string, subject: string) => ({
    email,
    labelId,
    subject,
    messageId: `<${subject}@x>`,
  });

  it('groups per account and label', () => {
    const out = groupDuplicates([
      hit('a@x.nl', 'L1', 'Offerte'),
      hit('a@x.nl', 'L1', 'Factuur'),
      hit('a@x.nl', 'L2', 'Offerte'),
    ]);
    expect(out).toEqual([
      { email: 'a@x.nl', labelId: 'L1', count: 2, subjects: ['Offerte', 'Factuur'] },
      { email: 'a@x.nl', labelId: 'L2', count: 1, subjects: ['Offerte'] },
    ]);
  });

  it('keeps the same label in two accounts apart', () => {
    const out = groupDuplicates([hit('a@x.nl', 'L1', 'Offerte'), hit('b@x.nl', 'L1', 'Offerte')]);
    expect(out.map((d) => d.email)).toEqual(['a@x.nl', 'b@x.nl']);
  });

  it('counts everything but only samples a few subjects', () => {
    const many = Array.from({ length: 40 }, (_, i) => hit('a@x.nl', 'L1', `Mail ${i}`));
    const [group] = groupDuplicates(many, 3);
    expect(group.count).toBe(40);
    expect(group.subjects).toEqual(['Mail 0', 'Mail 1', 'Mail 2']);
  });

  it('reports nothing when nothing was found', () => {
    expect(groupDuplicates([])).toEqual([]);
  });
});

describe('labelsStillNeeded', () => {
  const dup = (email: string, labelId: string, messageId: string) => ({
    email,
    labelId,
    messageId,
    subject: 'x',
  });

  it('keeps a label the message is not in yet', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    expect(labelsStillNeeded(index, 'a@x.nl', ['L1', 'L2'], 'm1')).toEqual(['L2']);
  });

  it('returns nothing when it is already in every chosen label', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1'), dup('a@x.nl', 'L2', 'm1')]);
    expect(labelsStillNeeded(index, 'a@x.nl', ['L1', 'L2'], 'm1')).toEqual([]);
  });

  it('does not let one account speak for another', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    expect(labelsStillNeeded(index, 'b@x.nl', ['L1'], 'm1')).toEqual(['L1']);
  });

  it('does not let one message speak for another', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    expect(labelsStillNeeded(index, 'a@x.nl', ['L1'], 'm2')).toEqual(['L1']);
  });

  it('keeps everything when nothing was found', () => {
    expect(labelsStillNeeded(duplicateIndex([]), 'a@x.nl', ['L1', 'L2'], 'm1')).toEqual([
      'L1',
      'L2',
    ]);
  });
});

describe('newMessageCount', () => {
  const dup = (email: string, labelId: string, messageId: string) => ({
    email,
    labelId,
    messageId,
    subject: 'x',
  });
  const targets = [{ email: 'a@x.nl', labelIds: ['L1'] }];

  it('counts only the mail that is genuinely new', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1'), dup('a@x.nl', 'L1', 'm2')]);
    expect(newMessageCount(index, targets, ['m1', 'm2', 'm3'])).toBe(1);
  });

  it('still counts a message that is missing from one of two labels', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    expect(newMessageCount(index, [{ email: 'a@x.nl', labelIds: ['L1', 'L2'] }], ['m1'])).toBe(1);
  });

  it('counts per account', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    const two = [
      { email: 'a@x.nl', labelIds: ['L1'] },
      { email: 'b@x.nl', labelIds: ['L1'] },
    ];
    expect(newMessageCount(index, two, ['m1'])).toBe(1);
  });

  it('is zero when everything already exists', () => {
    const index = duplicateIndex([dup('a@x.nl', 'L1', 'm1')]);
    expect(newMessageCount(index, targets, ['m1'])).toBe(0);
  });
});
