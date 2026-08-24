// Copying dragged mail into labels: targets, totals and duplicate detection.

import { describe, it, expect } from 'vitest';
import {
  normalizeTargets,
  checkLogLine,
  copyLogLine,
  copyTotal,
  groupDuplicates,
  duplicateIndex,
  labelsStillNeeded,
  insertLabelIds,
  newMessageCount,
  copyableLabelIds,
  countExisting,
  duplicateChecks,
  scanAnswer,
  threadGroups,
  assembleCopy,
  perMailboxLimit,
  runThreadGroup,
  existingSoFar,
  tallyOutcomes,

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

describe('insertLabelIds', () => {
  // What makes this the whole fix: the marker rides inside the very array insertMessage is
  // given, never a follow-up call added after the fact.
  it('folds the marker into the same array the insert itself carries', () => {
    expect(insertLabelIds(['INBOX', 'L1'], 'MARKER_1')).toEqual(['INBOX', 'L1', 'MARKER_1']);
  });

  it('does not mutate the labels the journal will go on to record', () => {
    const labelIds = ['INBOX'];
    insertLabelIds(labelIds, 'MARKER_1');
    expect(labelIds).toEqual(['INBOX']);
  });

  it('still carries the marker when there are no real labels at all', () => {
    expect(insertLabelIds([], 'MARKER_1')).toEqual(['MARKER_1']);
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


describe('existingSoFar', () => {
  const found = (messageId: string, labelIds: string[]) => ({ messageId, labelIds });

  it('counts the labels a mailbox already holds the drag under', () => {
    const { result } = existingSoFar(
      [{ email: 'a@x.nl', found: [found('<1>', ['INBOX']), found('<2>', ['INBOX', 'L1'])] }],
      2,
    );
    expect(result.accounts).toEqual([
      { email: 'a@x.nl', labels: [{ labelId: 'INBOX', count: 2 }, { labelId: 'L1', count: 1 }] },
    ]);
    expect(result.scanned).toBe(2);
  });

  // The whole point of the progressive scan: a mailbox that has not answered yet is absent
  // from the result rather than reported as holding nothing
  it('reports only the mailboxes that have answered', () => {
    const { result } = existingSoFar([{ email: 'a@x.nl', found: [found('<1>', ['INBOX'])] }], 3);
    expect(result.accounts.map((a) => a.email)).toEqual(['a@x.nl']);
  });

  it('passes on a mailbox that refused, without labels', () => {
    const { result } = existingSoFar(
      [{ email: 'a@x.nl', found: null, error: 'Kon niet controleren' }],
      1,
    );
    expect(result.accounts).toEqual([
      { email: 'a@x.nl', labels: [], error: 'Kon niet controleren' },
    ]);
  });

  it('leaves a mailbox that holds nothing out of the warning', () => {
    const { result } = existingSoFar([{ email: 'a@x.nl', found: [found('<1>', [])] }], 1);
    expect(result.accounts).toEqual([]);
  });

  it('keeps the per-message labels the check at Kopieer reuses', () => {
    const { byEmail } = existingSoFar(
      [{ email: 'a@x.nl', found: [found('<1>', ['INBOX']), found('<2>', [])] }],
      2,
    );
    expect(byEmail.get('a@x.nl')?.get('<1>')).toEqual(['INBOX']);
    expect(byEmail.get('a@x.nl')?.get('<2>')).toEqual([]);
  });

  it('holds no scan for a mailbox that could not be asked', () => {
    const { byEmail } = existingSoFar([{ email: 'a@x.nl', found: null, error: 'weg' }], 1);
    expect(byEmail.has('a@x.nl')).toBe(false);
  });

  it('carries the drag it belongs to, so a late answer can be recognised', () => {
    const { result } = existingSoFar([], 0, 7);
    expect(result.serial).toBe(7);
  });
});

describe('existingSoFar, how far it has got', () => {
  it('counts a mailbox that answered, whether or not it held anything', () => {
    const { result } = existingSoFar(
      [
        { email: 'a@x.nl', found: [{ messageId: '<1>', labelIds: ['INBOX'] }] },
        { email: 'b@x.nl', found: [{ messageId: '<1>', labelIds: [] }] },
      ],
      1,
    );
    expect(result.answered).toBe(2);
  });

  it('counts a mailbox that refused, since it will not answer again', () => {
    const { result } = existingSoFar([{ email: 'a@x.nl', found: null, error: 'weg' }], 1);
    expect(result.answered).toBe(1);
  });
});

describe('existingSoFar, an answer that came from the index', () => {
  const found = (messageId: string, labelIds: string[]) => ({ messageId, labelIds });

  // What the app remembers is good enough to warn with, and not good enough to decide a copy
  // on: the check at Kopieer reads byEmail, so what came out of the index stays out of it
  it('warns from a remembered answer but keeps it out of what Kopieer reuses', () => {
    const { result, byEmail } = existingSoFar(
      [{ email: 'a@x.nl', found: [found('<1>', ['L1'])], provisional: true }],
      1,
    );
    expect(result.accounts).toEqual([{ email: 'a@x.nl', labels: [{ labelId: 'L1', count: 1 }] }]);
    expect(byEmail.has('a@x.nl')).toBe(false);
  });

  it('lets a real answer be reused as before', () => {
    const { byEmail } = existingSoFar([{ email: 'a@x.nl', found: [found('<1>', ['L1'])] }], 1);
    expect(byEmail.get('a@x.nl')?.get('<1>')).toEqual(['L1']);
  });
});

describe('assembleCopy', () => {
  const rec = (account: string, file: string) => ({ ts: 't', account, file });
  const one = (email: string, copied: number, skipped: number, files: string[], error?: string) => ({
    account: { email, copied, skipped, total: copied + skipped, error },
    records: files.map((f) => rec(email, f)),
  });

  // The mailboxes now upload alongside each other, so the order they finish in is not the order
  // they were picked in. This is what keeps log.jsonl reading the same as when they ran in a row.
  it('writes the log in the order the mailboxes were picked, not the order they finished', () => {
    const out = assembleCopy([
      one('a@x.nl', 2, 0, ['01.eml', '02.eml']),
      one('b@x.nl', 1, 0, ['01.eml']),
    ]);
    expect(out.records.map((r) => `${r.account}/${r.file}`)).toEqual([
      'a@x.nl/01.eml',
      'a@x.nl/02.eml',
      'b@x.nl/01.eml',
    ]);
  });

  it('reports the mailboxes in the order they were picked', () => {
    const out = assembleCopy([one('b@x.nl', 1, 0, ['01.eml']), one('a@x.nl', 1, 0, ['01.eml'])]);
    expect(out.accounts.map((a) => a.email)).toEqual(['b@x.nl', 'a@x.nl']);
  });

  it('adds up what was copied and what was skipped', () => {
    const out = assembleCopy([one('a@x.nl', 2, 1, ['01.eml']), one('b@x.nl', 3, 2, ['02.eml'])]);
    expect({ copied: out.copied, skipped: out.skipped }).toEqual({ copied: 5, skipped: 3 });
  });

  it('keeps a mailbox that could not be reached in the report, with its error', () => {
    const out = assembleCopy([one('a@x.nl', 0, 0, [], 'Verbinding verlopen')]);
    expect(out.accounts[0].error).toBe('Verbinding verlopen');
    expect(out.copied).toBe(0);
  });

  it('has nothing to assemble for nothing copied', () => {
    expect(assembleCopy([])).toEqual({ records: [], accounts: [], copied: 0, skipped: 0 });
  });
});

describe('runThreadGroup', () => {
  const recorder = (thread: string | null = 't-new') => {
    const calls: Array<{ item: string; landedIn?: string; at: number }> = [];
    let live = 0;
    let peak = 0;
    const insert = async (item: string, landedIn?: string) => {
      live += 1;
      peak = Math.max(peak, live);
      calls.push({ item, landedIn, at: calls.length });
      await Promise.resolve();
      live -= 1;
      return { threadId: thread ?? undefined };
    };
    return { calls, insert, peak: () => peak };
  };

  it('sends nothing for an empty group', async () => {
    const r = recorder();
    await runThreadGroup([], r.insert, 4);
    expect(r.calls).toEqual([]);
  });

  it('sends a single mail once, with no thread to attach it to', async () => {
    const r = recorder();
    await runThreadGroup(['a'], r.insert, 4);
    expect(r.calls).toEqual([{ item: 'a', landedIn: undefined, at: 0 }]);
  });

  // The first insert is what creates the thread the rest belong to, so it goes alone; the rest
  // all attach to the same thread and have no reason to wait for each other
  it('sends the first alone and then the rest alongside each other', async () => {
    const r = recorder('t-1');
    await runThreadGroup(['a', 'b', 'c'], r.insert, 4);
    expect(r.calls[0].item).toBe('a');
    expect(r.calls.slice(1).map((c) => c.landedIn)).toEqual(['t-1', 't-1']);
    expect(r.peak()).toBeGreaterThan(1);
  });

  it('never has more than the limit of the rest in flight', async () => {
    const r = recorder('t-1');
    await runThreadGroup(['a', 'b', 'c', 'd', 'e'], r.insert, 2);
    expect(r.peak()).toBeLessThanOrEqual(2);
  });

  // Without a thread from the first insert there is nothing to attach to, and firing the rest
  // off together would scatter one conversation over as many threads. Then it stays a row, and
  // whichever insert does come back with a thread carries the ones after it.
  it('keeps going in a row when the first mail landed nowhere', async () => {
    const calls: Array<{ item: string; landedIn?: string }> = [];
    let live = 0;
    let peak = 0;
    const insert = async (item: string, landedIn?: string) => {
      live += 1;
      peak = Math.max(peak, live);
      calls.push({ item, landedIn });
      await Promise.resolve();
      live -= 1;
      return { threadId: item === 'a' ? undefined : 't-2' };
    };
    await runThreadGroup(['a', 'b', 'c'], insert, 4);
    expect(peak).toBe(1);
    expect(calls.map((c) => c.landedIn)).toEqual([undefined, undefined, 't-2']);
  });

  it('gives every mail of the group to the inserter exactly once', async () => {
    const r = recorder('t-1');
    await runThreadGroup(['a', 'b', 'c', 'd'], r.insert, 3);
    expect(r.calls.map((c) => c.item).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('perMailboxLimit', () => {
  // The bug this fixes: bounding each half separately meant one mailbox got the same narrow
  // limit as one of three, leaving its own quota unused
  it('gives a single mailbox everything it can use', () => {
    expect(perMailboxLimit(1, 12, 8)).toBe(8);
  });

  it('divides the uploads in flight over the mailboxes being worked', () => {
    expect(perMailboxLimit(3, 12, 8)).toBe(4);
    expect(perMailboxLimit(2, 12, 8)).toBe(6);
  });

  // A mailbox's own ceiling is ten inserts a second whatever this says, so opening it wider
  // than that only costs memory
  it('never opens one mailbox wider than that mailbox can use', () => {
    expect(perMailboxLimit(1, 100, 8)).toBe(8);
  });

  it('keeps every mailbox at at least one upload', () => {
    expect(perMailboxLimit(20, 12, 8)).toBe(1);
  });

  it('treats no mailboxes as one, rather than dividing by nothing', () => {
    expect(perMailboxLimit(0, 12, 8)).toBe(8);
  });
});

describe('copyLogLine', () => {
  const base = {
    email: 'support@abovomaxlead.nl',
    delegated: true,
    tokenMs: 812,
    inserts: [400, 600, 1900],
    copied: 3,
    skipped: 0,
    failed: 0,
    stopped: 0,
  };

  // The whole question this logging exists for: is a delegated target slower than an own one,
  // and in which phase. So the kind and the token are on the line, not just the total.
  it('names the kind of mailbox and what its token cost', () => {
    const line = copyLogLine(base);
    expect(line).toContain('support@abovomaxlead.nl');
    expect(line).toContain('gedelegeerd');
    expect(line).toContain('token 812ms');
  });

  it('calls an own account what it is', () => {
    expect(copyLogLine({ ...base, delegated: false })).toContain('eigen');
  });

  // A mean would hide the one upload that took nine seconds, which is the thing worth seeing
  it('reports the middle and the worst insert, not an average', () => {
    const line = copyLogLine(base);
    expect(line).toContain('mediaan 600ms');
    expect(line).toContain('traagste 1.9s');
  });

  it('reports the total the inserts took', () => {
    expect(copyLogLine(base)).toContain('3 inserts in 2.9s');
  });

  it('reports what came of them', () => {
    const line = copyLogLine({ ...base, copied: 8, skipped: 2, failed: 1 });
    expect(line).toContain('8 gekopieerd');
    expect(line).toContain('2 overgeslagen');
    expect(line).toContain('1 mislukt');
  });

  it('says so plainly when nothing was inserted at all', () => {
    const line = copyLogLine({ ...base, inserts: [], copied: 0, skipped: 3 });
    expect(line).toContain('0 inserts');
    expect(line).not.toContain('mediaan');
  });

  // The defect this guards: a cancelled run must read as cancelled, not as Gmail having
  // refused dozens of uploads it was never even asked to make.
  it('reports a mailbox that was entirely cancelled as afgebroken, not mislukt', () => {
    const line = copyLogLine({ ...base, copied: 0, skipped: 0, failed: 0, stopped: 17 });
    expect(line).toContain('0 mislukt');
    expect(line).toContain('17 afgebroken');
  });

  it('keeps a real failure and a cancellation apart rather than merging them', () => {
    const line = copyLogLine({ ...base, copied: 5, skipped: 0, failed: 2, stopped: 10 });
    expect(line).toContain('5 gekopieerd');
    expect(line).toContain('2 mislukt');
    expect(line).toContain('10 afgebroken');
  });
});

describe('tallyOutcomes', () => {
  it('counts a plain copy, skip and failure under their own category', () => {
    expect(
      tallyOutcomes([{ copied: true }, { skipped: true }, { error: 'nope' }]),
    ).toEqual({ copied: 1, skipped: 1, failed: 1, stopped: 0, lastError: 'nope' });
  });

  // The exact defect: neither of these is a failure, whatever files.length - copied -
  // skipped would say.
  it('counts a gate-refused file and a severed upload as stopped, never as failed', () => {
    expect(
      tallyOutcomes([
        undefined, // the gate refused it before its thread group ever started
        {}, // severed mid-flight by a cancel -- copyOneFile's deliberate, no-error outcome
      ]),
    ).toEqual({ copied: 0, skipped: 0, failed: 0, stopped: 2, lastError: undefined });
  });

  it('does not let a cancellation elsewhere in the mailbox hide behind a real failure', () => {
    expect(
      tallyOutcomes([{ error: 'HTTP 500' }, {}, undefined, { copied: true }]),
    ).toEqual({ copied: 1, skipped: 0, failed: 1, stopped: 2, lastError: 'HTTP 500' });
  });

  it('keeps the last failure seen when more than one file failed', () => {
    expect(
      tallyOutcomes([{ error: 'eerste' }, { error: 'laatste' }]).lastError,
    ).toBe('laatste');
  });

  it('answers all zero for an empty mailbox', () => {
    expect(tallyOutcomes([])).toEqual({
      copied: 0,
      skipped: 0,
      failed: 0,
      stopped: 0,
      lastError: undefined,
    });
  });
});

describe('checkLogLine', () => {
  // The reused scan is the difference between nought requests and hundreds, so the line has to
  // say how much of the check was answered for free
  it('separates what was reused from what had to be asked again', () => {
    const line = checkLogLine({ checks: 30, reused: 28, asked: 2, ms: 1450 });
    expect(line).toContain('30 vragen');
    expect(line).toContain('28 uit de scan');
    expect(line).toContain('2 opnieuw gevraagd');
    expect(line).toContain('1.5s');
  });

  it('says when the whole check cost nothing', () => {
    expect(checkLogLine({ checks: 30, reused: 30, asked: 0, ms: 3 })).toContain('0 opnieuw gevraagd');
  });
});
