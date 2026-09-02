// The per-account unread count store.

import { describe, it, expect } from 'vitest';
import { UnreadStore } from '../electron/unread/unread-store';
import { totalUnread } from '../electron/unread/badge-math';

describe('UnreadStore', () => {
  it('sums reported counts in the snapshot', () => {
    const s = new UnreadStore();
    s.report('u0', 2);
    s.report('d:x@y.com', 3);
    expect(totalUnread(s.snapshot())).toBe(5);
  });

  it('forgets a key when a view reports zero — a discarded view must not stick', () => {
    const s = new UnreadStore();
    s.report('u0', 5);
    expect(totalUnread(s.snapshot())).toBe(5);
    s.report('u0', 0);
    expect(totalUnread(s.snapshot())).toBe(0);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('treats a negative/garbage count as zero and forgets the key', () => {
    const s = new UnreadStore();
    s.report('u0', 4);
    s.report('u0', -1);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('forget() drops a key even if it was counting', () => {
    const s = new UnreadStore();
    s.report('u0', 7);
    s.forget('u0');
    expect(totalUnread(s.snapshot())).toBe(0);
    expect('u0' in s.snapshot()).toBe(false);
  });

  it('snapshot is a copy — mutating it does not corrupt the store', () => {
    const s = new UnreadStore();
    s.report('u0', 3);
    const snap = s.snapshot();
    snap.u0 = 999;
    expect(s.snapshot().u0).toBe(3);
  });

  describe('retain', () => {
    it('drops a key no live account owns — the probe view that never became a profile', () => {
      const s = new UnreadStore();
      s.report('u0', 2);
      s.report('u2', 2);
      s.retain(['u0']);
      expect('u2' in s.snapshot()).toBe(false);
      expect(totalUnread(s.snapshot())).toBe(2);
    });

    it('reports whether anything was dropped, so the caller can push the new total', () => {
      const s = new UnreadStore();
      s.report('u0', 2);
      s.report('u2', 2);
      expect(s.retain(['u0'])).toBe(true);
      expect(s.retain(['u0'])).toBe(false);
    });

    it('keeps every key that is still live', () => {
      const s = new UnreadStore();
      s.report('u0', 2);
      s.report('d:support@x.com', 10);
      expect(s.retain(['u0', 'd:support@x.com'])).toBe(false);
      expect(totalUnread(s.snapshot())).toBe(12);
    });

    it('empties the store when no account is left', () => {
      const s = new UnreadStore();
      s.report('u0', 2);
      s.retain([]);
      expect(totalUnread(s.snapshot())).toBe(0);
    });
  });

  // Two sources, five minutes apart. The badge went stale for own accounts when the sweep was
  // allowed to write over a title that had just moved: read the inbox, and the old number came
  // back at the next sweep and stayed until the one after it.
  describe('who owns an account', () => {
    it('fills in an account the page has said nothing about', () => {
      const s = new UnreadStore();
      expect(s.reportFromApi('u0', 4)).toBe(true);
      expect(s.snapshot().u0).toBe(4);
      expect(s.ownedByPage('u0')).toBe(false);
    });

    it('refuses to write over a page that has spoken', () => {
      const s = new UnreadStore();
      s.report('u0', 1);
      expect(s.reportFromApi('u0', 9)).toBe(false);
      expect(s.snapshot().u0).toBe(1);
      expect(s.ownedByPage('u0')).toBe(true);
    });

    it('keeps the page in charge after it reported an empty inbox', () => {
      const s = new UnreadStore();
      s.reportFromApi('u0', 4);
      s.report('u0', 0);
      expect(s.reportFromApi('u0', 4)).toBe(false);
      expect('u0' in s.snapshot()).toBe(false);
    });

    it('lets the API back in once the account is forgotten', () => {
      const s = new UnreadStore();
      s.report('u0', 1);
      s.forget('u0');
      expect(s.reportFromApi('u0', 9)).toBe(true);
      expect(s.snapshot().u0).toBe(9);
    });

    it('lets the API back in for an account retain dropped', () => {
      const s = new UnreadStore();
      s.report('u0', 1);
      s.retain([]);
      expect(s.reportFromApi('u0', 9)).toBe(true);
    });

    it('keeps the two accounts apart', () => {
      const s = new UnreadStore();
      s.report('u0', 1);
      expect(s.reportFromApi('u1', 5)).toBe(true);
      expect(s.snapshot()).toEqual({ u0: 1, u1: 5 });
    });
  });
});
