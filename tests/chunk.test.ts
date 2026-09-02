// The one chunking loop label-job.ts, label-purge.ts and copy-marker-sweep.ts all used to keep
// a copy of. Tested once here rather than once per caller.

import { describe, it, expect } from 'vitest';
import { chunk } from '../electron/mail/chunk';

const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${i + from}`);

describe('chunk', () => {
  it('cuts an exact multiple into equal chunks', () => {
    expect(chunk(ids(6), 3).map((c) => c.length)).toEqual([3, 3]);
  });

  it('leaves the last chunk short rather than padding it', () => {
    expect(chunk(ids(7), 3).map((c) => c.length)).toEqual([3, 3, 1]);
  });

  it('answers one chunk for a list shorter than the size', () => {
    expect(chunk(ids(5), 2000).map((c) => c.length)).toEqual([5]);
  });

  it('answers nothing at all for an empty list', () => {
    expect(chunk([], 2000)).toEqual([]);
  });

  it('keeps every item exactly once, in order', () => {
    const all = ids(10);
    expect(chunk(all, 4).flat()).toEqual(all);
  });
});
