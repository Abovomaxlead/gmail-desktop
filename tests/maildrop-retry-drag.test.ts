// The retry of a dragged copy, driven through the real mail-drop controller against a fake
// Gmail. What every scenario here comes down to is one rule: per mailbox, per Message-ID, a
// mail that should land lands exactly once, under exactly the chosen labels, and nothing
// lands anywhere else -- a retry that sends a mail twice is the bug this feature can have.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MailDropCopyResult } from '../electron/core/ipc';
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
