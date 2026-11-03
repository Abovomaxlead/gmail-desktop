// The retry of a dragged copy, driven through the real mail-drop controller against a fake
// Gmail. What every scenario here comes down to is one rule: per mailbox, per Message-ID, a
// mail that should land lands exactly once, under exactly the chosen labels, and nothing
// lands anywhere else -- a retry that sends a mail twice is the bug this feature can have.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MailDropCopyResult } from '../electron/core/ipc';
import { ALREADY_COPIED_TEXT } from '../electron/mail/copy/copy-failures';
import { SOURCE, TARGET_A, TARGET_B, startHarness, stopHarness, type Harness } from './support/controller-harness';


//===========================
// Setup
//===========================

let h: Harness;

beforeEach(async () => {
  h = await startHarness();
});

afterEach(async () => {
  await stopHarness();
});


//===========================
// Scenarios
//===========================

describe('a dragged copy with one failed insert', () => {
  it('names the lost mail, offers a retry, and the retry lands it exactly once', async () => {
    const { items, ids } = h.seedConversations(3);
    const label = h.fake.addLabel(TARGET_A, 'L');
    h.fake.failInsert(TARGET_A, ids[1], 'quota');

    const preview = await h.drag(items);
    expect(preview?.items.map((i) => i.saved)).toEqual([1, 1, 1]);

    const first = (await h.copy([{ email: TARGET_A, labelIds: [label] }])) as MailDropCopyResult;
    expect(first.accounts).toHaveLength(1);
    expect(first.accounts[0].failures).toEqual([
      expect.objectContaining({ subject: 'Mail 2', maybeLanded: false }),
    ]);
    expect(first.retryId).toEqual(expect.any(String));
    expect(ids.map((id) => h.inserts(TARGET_A, id))).toEqual([1, 0, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[2]]: [label] });

    const retried = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(retried.ok).toBe(true);
    expect(retried.copied).toBe(1);
    expect(retried.retryId).toBeUndefined();
    expect(retried.accounts[0].failures).toBeUndefined();
    expect(ids.map((id) => h.inserts(TARGET_A, id))).toEqual([1, 1, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[1]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('a dragged copy whose insert timed out after it landed', () => {
  it('flags the mail as maybe landed, and the retry finds it rather than sending it again', async () => {
    const { items, ids } = h.seedConversations(3);
    const label = h.fake.addLabel(TARGET_A, 'L');
    h.fake.failInsert(TARGET_A, ids[1], 'timeout-landed');
    h.fake.lag = 0;

    await h.drag(items);
    const first = (await h.copy([{ email: TARGET_A, labelIds: [label] }])) as MailDropCopyResult;
    expect(first.accounts[0].failures).toEqual([
      expect.objectContaining({ subject: 'Mail 2', maybeLanded: true }),
    ]);
    expect(first.retryId).toEqual(expect.any(String));
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);

    const checked = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(checked.needsConfirm).toBe(true);
    expect(checked.duplicates).toEqual([
      expect.objectContaining({ email: TARGET_A, labelId: label, count: 1, subjects: ['Mail 2'] }),
    ]);
    expect(checked.newCount).toBe(0);
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);

    const confirmed = (await h.retryCopy(first.retryId!, 'new')) as MailDropCopyResult;
    expect(confirmed.copied).toBe(0);
    expect(confirmed.skipped).toBe(1);
    expect(confirmed.retryId).toBeUndefined();
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);
    expect(h.fake.attempts(TARGET_A, ids[1])).toBe(1);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[1]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('the retry pressed twice', () => {
  it('refuses the second press while the first is inserting, and lands the mail once', async () => {
    const { ids, label, first } = await copyWithOneQuotaFailure();

    const hold = h.fake.holdNext('insertMessage');
    const pressed = h.retryCopy(first.retryId!, 'check');
    await hold.entered;
    const again = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(again.ok).toBe(false);
    expect(again.error).toBe('Er wordt al gekopieerd.');

    hold.release();
    const retried = (await pressed) as MailDropCopyResult;
    expect(retried.ok).toBe(true);
    expect(retried.copied).toBe(1);
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);
    expect(h.fake.attempts(TARGET_A, ids[1])).toBe(2);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[1]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('the whole-drag Kopieer after the drag was copied', () => {
  it('is refused before and after the retry, and inserts nothing', async () => {
    const { ids, label, first } = await copyWithOneQuotaFailure();
    const target = [{ email: TARGET_A, labelIds: [label] }];

    const before = (await h.copy(target, 'check')) as MailDropCopyResult;
    expect(before.ok).toBe(false);
    expect(before.error).toBe(ALREADY_COPIED_TEXT);
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 0, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[2]]: [label] });

    const retried = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(retried.copied).toBe(1);

    const after = (await h.copy(target, 'all')) as MailDropCopyResult;
    expect(after.ok).toBe(false);
    expect(after.error).toBe(ALREADY_COPIED_TEXT);
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[1]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('a drag whose pull lost one conversation', () => {
  it('offers the pull retry, fetches only that one again, and the copy lands all three once', async () => {
    const { items, ids, threadIds } = h.seedConversations(3);
    const label = h.fake.addLabel(TARGET_A, 'L');
    h.fake.failFetch(SOURCE, threadIds[1]);

    const preview = await h.drag(items);
    expect(preview?.items.map((i) => i.saved)).toEqual([1, 0, 1]);
    expect(preview?.items[1].error).toEqual(expect.any(String));
    expect(preview?.pullRetryId).toEqual(expect.any(String));
    const fetchedBefore = threadIds.map((t) => h.fake.fetches(SOURCE, t));

    const pulled = await h.retryPull(preview!.pullRetryId!);
    expect(pulled).toEqual(expect.objectContaining({ ok: true }));
    if (!pulled.ok) return;
    expect(pulled.items.map((i) => i.saved)).toEqual([1, 1, 1]);
    expect(pulled.pullRetryId).toBeUndefined();
    const fetchedAfter = threadIds.map((t) => h.fake.fetches(SOURCE, t));
    expect(fetchedAfter).toEqual([fetchedBefore[0], fetchedBefore[1] + 1, fetchedBefore[2]]);
    await h.settle();

    const copied = (await h.copy([{ email: TARGET_A, labelIds: [label] }])) as MailDropCopyResult;
    expect(copied.ok).toBe(true);
    expect(copied.copied).toBe(3);
    expect(copied.retryId).toBeUndefined();
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[1]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('a copy retry offered for a drag that was replaced', () => {
  it('is refused as expired and inserts nothing', async () => {
    const { ids, label, first } = await copyWithOneQuotaFailure();

    await h.drag([{ threadId: 'thread-3', subject: 'Mail 3' }]);
    const stale = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(stale.ok).toBe(false);
    expect(stale.error).toBe('Deze lijst is verlopen. Sleep de mail opnieuw.');
    expect(h.fake.attempts(TARGET_A, ids[1])).toBe(1);
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 0, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [label], [ids[2]]: [label] });
    h.expectLanded(TARGET_B, {});
    h.expectLanded(SOURCE, {});
  });
});

describe('a copy into two mailboxes that failed in one of them', () => {
  it('retries the mail into that mailbox only, under its own label', async () => {
    const { items, ids } = h.seedConversations(3);
    const labelA = h.fake.addLabel(TARGET_A, 'LA');
    const labelB = h.fake.addLabel(TARGET_B, 'LB');
    h.fake.failInsert(TARGET_B, ids[1], 'quota');

    await h.drag(items);
    const first = (await h.copy([
      { email: TARGET_A, labelIds: [labelA] },
      { email: TARGET_B, labelIds: [labelB] },
    ])) as MailDropCopyResult;
    const byEmail = new Map(first.accounts.map((a) => [a.email, a]));
    expect(byEmail.get(TARGET_A)?.failures).toBeUndefined();
    expect(byEmail.get(TARGET_B)?.failures).toEqual([
      expect.objectContaining({ subject: 'Mail 2', maybeLanded: false }),
    ]);
    expect(first.retryId).toEqual(expect.any(String));
    expect(insertsOf(TARGET_A, ids)).toEqual([1, 1, 1]);
    expect(insertsOf(TARGET_B, ids)).toEqual([1, 0, 1]);

    const retried = (await h.retryCopy(first.retryId!, 'check')) as MailDropCopyResult;
    expect(retried.ok).toBe(true);
    expect(retried.copied).toBe(1);
    expect(retried.retryId).toBeUndefined();
    expect(retried.accounts.map((a) => a.email)).toEqual([TARGET_B]);
    expect(ids.map((id) => h.fake.attempts(TARGET_A, id))).toEqual([1, 1, 1]);
    expect(insertsOf(TARGET_B, ids)).toEqual([1, 1, 1]);
    h.expectLanded(TARGET_A, { [ids[0]]: [labelA], [ids[1]]: [labelA], [ids[2]]: [labelA] });
    h.expectLanded(TARGET_B, { [ids[0]]: [labelB], [ids[1]]: [labelB], [ids[2]]: [labelB] });
    h.expectLanded(SOURCE, {});
  });
});


//===========================
// Helper functions
//===========================

/** Lists how often each of these mails landed in one mailbox, in the order given */
function insertsOf(email: string, ids: string[]): number[] {
  return ids.map((id) => h.inserts(email, id));
}

/**
 * Drags three conversations and copies them into TARGET_A's label L, mail 2 refused once
 *
 * @returns the Message-IDs, the label and the first copy's answer
 */
async function copyWithOneQuotaFailure(): Promise<{ ids: string[]; label: string; first: MailDropCopyResult }> {
  const { items, ids } = h.seedConversations(3);
  const label = h.fake.addLabel(TARGET_A, 'L');
  h.fake.failInsert(TARGET_A, ids[1], 'quota');
  await h.drag(items);
  const first = (await h.copy([{ email: TARGET_A, labelIds: [label] }])) as MailDropCopyResult;
  expect(first.retryId).toEqual(expect.any(String));
  expect(insertsOf(TARGET_A, ids)).toEqual([1, 0, 1]);
  return { ids, label, first };
}
