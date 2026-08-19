// Copying dragged mail into labels: targets, totals and duplicate detection.

import { describe, it, expect } from 'vitest';
import {
  normalizeTargets,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  newMessageCount,
  copyableLabelIds,
  countExisting,
  duplicateChecks,
  scanAnswer,
  threadGroups,
} from '../electron/mail/mail-copy';

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

describe('copyableLabelIds', () => {
  it('keeps the labels the picker offers', () => {
    expect(copyableLabelIds(['INBOX', 'STARRED', 'IMPORTANT', 'Label_7'])).toEqual([
      'INBOX',
      'STARRED',
      'IMPORTANT',
      'Label_7',
    ]);
  });

  it('drops the bookkeeping Gmail hangs on every message', () => {
    expect(
      copyableLabelIds(['UNREAD', 'CATEGORY_PERSONAL', 'SENT', 'DRAFT', 'CHAT', 'Label_7']),
    ).toEqual(['Label_7']);
  });

  it('drops spam and trash, which are not a copy standing in the way', () => {
    expect(copyableLabelIds(['SPAM', 'TRASH'])).toEqual([]);
  });
});

describe('countExisting', () => {
  it('counts how many of the dragged messages a label already holds', () => {
    expect(
      countExisting([
        { email: 'a@x.nl', labelId: 'L1' },
        { email: 'a@x.nl', labelId: 'L1' },
        { email: 'a@x.nl', labelId: 'L2' },
      ]),
    ).toEqual([{ email: 'a@x.nl', labels: [{ labelId: 'L1', count: 2 }, { labelId: 'L2', count: 1 }] }]);
  });

  it('keeps the same label in two mailboxes apart', () => {
    expect(
      countExisting([
        { email: 'a@x.nl', labelId: 'L1' },
        { email: 'b@x.nl', labelId: 'L1' },
      ]).map((a) => a.email),
    ).toEqual(['a@x.nl', 'b@x.nl']);
  });

  it('reports nothing when nothing was found', () => {
    expect(countExisting([])).toEqual([]);
  });
});

// The picker asks per mailbox which labels hold each dragged message; the check at Kopieer
// asks whether one label holds it. The first answer contains the second, and asking Gmail
// twice is what made pressing Kopieer wait on a scan that was already done.
describe('duplicateChecks', () => {
  const files = [
    { messageId: '<a@x>', subject: 'Offerte' },
    { messageId: '<b@x>', subject: 'Factuur' },
  ];

  it('asks per mailbox, per label, per message', () => {
    const checks = duplicateChecks(
      [{ email: 'a@x.nl', labelIds: ['L1', 'L2'] }],
      files,
    );
    expect(checks).toHaveLength(4);
    expect(checks.map((c) => `${c.labelId} ${c.messageId}`)).toEqual([
      'L1 <a@x>',
      'L1 <b@x>',
      'L2 <a@x>',
      'L2 <b@x>',
    ]);
  });

  it('carries the subject, which is what the warning shows', () => {
    expect(duplicateChecks([{ email: 'a@x.nl', labelIds: ['L1'] }], files)[0]).toEqual({
      email: 'a@x.nl',
      labelId: 'L1',
      messageId: '<a@x>',
      subject: 'Offerte',
    });
  });

  it('skips a message without a Message-ID, since nothing can be matched on it', () => {
    expect(
      duplicateChecks([{ email: 'a@x.nl', labelIds: ['L1'] }], [{ messageId: '  ', subject: 'X' }]),
    ).toEqual([]);
  });

  it('keeps the mailboxes in the order they were chosen', () => {
    const checks = duplicateChecks(
      [
        { email: 'b@x.nl', labelIds: ['L1'] },
        { email: 'a@x.nl', labelIds: ['L1'] },
      ],
      [files[0]],
    );
    expect(checks.map((c) => c.email)).toEqual(['b@x.nl', 'a@x.nl']);
  });
});

describe('scanAnswer', () => {
  const check = { email: 'a@x.nl', labelId: 'L1', messageId: '<a@x>', subject: 'Offerte' };
  const scan = new Map([['a@x.nl', new Map([['<a@x>', ['INBOX', 'L1']]])]]);

  it('says yes when the scan saw the message under that label', () => {
    expect(scanAnswer(scan, check)).toBe(true);
  });

  it('says no when the scan saw the message but not under that label', () => {
    expect(scanAnswer(scan, { ...check, labelId: 'L2' })).toBe(false);
  });

  // Nowhere in the mailbox is an answer; not looked up is not. Reading the second as the
  // first would copy a mail the scan never checked.
  it('says no for a message the scan found nowhere in that mailbox', () => {
    const empty = new Map([['a@x.nl', new Map([['<a@x>', [] as string[]]])]]);
    expect(scanAnswer(empty, check)).toBe(false);
  });

  it('knows nothing about a mailbox that was not scanned', () => {
    expect(scanAnswer(scan, { ...check, email: 'b@x.nl' })).toBeNull();
  });

  it('knows nothing about a message that was not scanned', () => {
    expect(scanAnswer(scan, { ...check, messageId: '<c@x>' })).toBeNull();
  });

  it('knows nothing without a scan at all', () => {
    expect(scanAnswer(null, check)).toBeNull();
    expect(scanAnswer(undefined, check)).toBeNull();
  });
});

// Two mails of one conversation cannot be inserted at the same moment: the first one's
// answer names the thread the second has to join, and without it the reader gets loose mails.
// Two different conversations have nothing to wait for.
describe('threadGroups', () => {
  const ref = (file: string, threadId: string) => ({ file, threadId });

  it('puts the messages of one conversation in one group, in the order of the drag', () => {
    const groups = threadGroups([ref('01.eml', 't1'), ref('02.eml', 't1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((g) => g.ref.file)).toEqual(['01.eml', '02.eml']);
  });

  it('gives every conversation its own group, so they can go up alongside each other', () => {
    const groups = threadGroups([ref('01.eml', 't1'), ref('02.eml', 't2'), ref('03.eml', 't3')]);
    expect(groups).toHaveLength(3);
  });

  it('keeps the file its place in the drag, which is the order the log is written in', () => {
    const groups = threadGroups([ref('01.eml', 't1'), ref('02.eml', 't2'), ref('03.eml', 't1')]);
    expect(groups[0].map((g) => g.index)).toEqual([0, 2]);
    expect(groups[1].map((g) => g.index)).toEqual([1]);
  });

  it('groups the conversations in the order they first appear', () => {
    const groups = threadGroups([ref('01.eml', 't2'), ref('02.eml', 't1')]);
    expect(groups.map((g) => g[0].ref.threadId)).toEqual(['t2', 't1']);
  });

  // A mail saved from the page route can arrive without a thread id, and grouping those
  // together would make them queue behind each other for no reason
  it('treats a file without a thread id as a conversation of its own', () => {
    const groups = threadGroups([ref('01.eml', ''), ref('02.eml', '')]);
    expect(groups).toHaveLength(2);
  });

  it('has no groups for nothing saved', () => {
    expect(threadGroups([])).toEqual([]);
  });
});
