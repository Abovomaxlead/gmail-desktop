// The count-then-purge handle: a count remembers its ids and answers a handle, the purge takes
// the handle and nothing else. Pure, so none of this needs Electron or a network: the safety
// property this feature rests on is that a purge can only ever act on ids somebody was shown,
// and that is decided here.

import { describe, it, expect } from 'vitest';
import { PURGE_LIST_MAX, createPurgeStore, type CountedLabel } from '../electron/mail/label-purge';

const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${i + from}`);

/** A store whose handles are predictable, so a test can name one. */
const store = () => {
  let n = 0;
  return createPurgeStore(() => `h${++n}`);
};

const counted = (): CountedLabel[] => [
  { name: 'test', labelId: 'Label_1', ids: ids(3) },
  { name: 'test/test123', labelId: 'Label_2', ids: ids(2, 3) },
];

describe('the purge store', () => {
  it('answers a count per label and a total', () => {
    const s = store();
    const count = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(count.handle).toBe('h1');
    expect(count.email).toBe('a@b.nl');
    expect(count.label).toBe('test');
    expect(count.total).toBe(5);
    expect(count.labels).toEqual([
      { name: 'test', labelId: 'Label_1', messages: 3 },
      { name: 'test/test123', labelId: 'Label_2', messages: 2 },
    ]);
    expect(count.capped).toBe(false);
  });

  // The ids never leave the main process in the count. Only the counts do.
  it('does not put the ids in the count it answers', () => {
    const count = store().put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(JSON.stringify(count)).not.toContain('m0');
  });

  it('gives back the ids of the labels named, and only those', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test'])).toEqual({ email: 'a@b.nl', ids: ['m0', 'm1', 'm2'] });
  });

  it('gives back both labels when both are named', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test', 'test/test123'])?.ids).toHaveLength(5);
  });

  // The user unticked it, so its ids must not travel with the ones they left ticked.
  it('never returns ids of a label that was not named', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test/test123'])).toEqual({ email: 'a@b.nl', ids: ['m3', 'm4'] });
  });

  it('ignores a label name it never counted', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test', 'nooit-geteld'])?.ids).toHaveLength(3);
  });

  // One count buys one purge. A second click has nothing to act on.
  it('consumes the handle, so a second purge finds nothing', () => {
    const s = store();
    const { handle } = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(handle, ['test'])).not.toBeNull();
    expect(s.take(handle, ['test'])).toBeNull();
  });

  it('refuses a handle it never issued', () => {
    const s = store();
    s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take('h999', ['test'])).toBeNull();
  });

  // Counting again replaces what is held: a stale window cannot fire a listing nobody looked at.
  it('refuses the previous handle once a new count replaces it', () => {
    const s = store();
    const first = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    const second = s.put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: false });
    expect(s.take(first.handle, ['test'])).toBeNull();
    expect(s.take(second.handle, ['test'])).not.toBeNull();
  });

  it('carries the capped flag through', () => {
    const count = store().put({ email: 'a@b.nl', label: 'test', byLabel: counted(), capped: true });
    expect(count.capped).toBe(true);
  });
});

describe('the listing bound', () => {
  // Far past any real label, and there so a runaway page loop cannot allocate without end.
  it('is high enough never to bite in practice and low enough to bound memory', () => {
    expect(PURGE_LIST_MAX).toBe(50_000);
  });
});
