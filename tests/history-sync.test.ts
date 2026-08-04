// Deciding which messages in a history delta are worth notifying about.

import { describe, it, expect } from 'vitest';
import { notifiableIds, shouldNotify, SKIP_LABELS } from '../electron/history-sync';

const msg = (id: string, ...labelIds: string[]) => ({ id, labelIds });

describe('notifiableIds', () => {
  it('keeps a plain new inbox message', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'UNREAD')])).toEqual(['m1']);
  });

  it('skips a message that is not in the inbox', () => {
    expect(notifiableIds([msg('m1', 'SENT')])).toEqual([]);
  });

  it('skips promotions and social, so newsletters stay quiet', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'CATEGORY_PROMOTIONS')])).toEqual([]);
    expect(notifiableIds([msg('m2', 'INBOX', 'CATEGORY_SOCIAL')])).toEqual([]);
  });

  it('keeps the other categories', () => {
    expect(notifiableIds([msg('m1', 'INBOX', 'CATEGORY_PERSONAL')])).toEqual(['m1']);
    expect(notifiableIds([msg('m2', 'INBOX', 'CATEGORY_UPDATES')])).toEqual(['m2']);
  });

  it('deduplicates: one message can appear in several history records', () => {
    expect(notifiableIds([msg('m1', 'INBOX'), msg('m1', 'INBOX')])).toEqual(['m1']);
  });

  it('keeps the order Gmail gave, so notifications arrive oldest first', () => {
    expect(notifiableIds([msg('m1', 'INBOX'), msg('m2', 'INBOX')])).toEqual(['m1', 'm2']);
  });

  it('returns nothing for an empty page', () => {
    expect(notifiableIds([])).toEqual([]);
  });

  it('names the labels it skips, so the reason is readable', () => {
    expect(SKIP_LABELS).toEqual(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']);
  });
});

describe('shouldNotify', () => {
  const covered = 1_000_000;

  it('notifies for mail that arrived while push covered the account', () => {
    expect(shouldNotify(covered + 1, covered)).toBe(true);
  });

  it('stays quiet for mail that was already there when coverage began', () => {
    expect(shouldNotify(covered - 1, covered)).toBe(false);
  });

  it('counts mail that arrived exactly at the moment coverage began', () => {
    expect(shouldNotify(covered, covered)).toBe(true);
  });

  it('stays quiet when the account is not covered at all', () => {
    expect(shouldNotify(covered + 1, null)).toBe(false);
  });
});
