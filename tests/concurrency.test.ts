// mapLimit: running work with a bounded number of slots.

import { describe, it, expect } from 'vitest';
import { mapLimit } from '../electron/concurrency';

const defer = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('mapLimit', () => {
  it('keeps the input order even when results come back out of order', async () => {
    const out = await mapLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('runs no more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([...Array(20).keys()], 5, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
    });
    expect(peak).toBe(5);
  });

  it('starts the next item as soon as a slot frees up', async () => {
    const gates = [defer<void>(), defer<void>(), defer<void>()];
    const started: number[] = [];
    const run = mapLimit([0, 1, 2], 2, async (i) => {
      started.push(i);
      await gates[i].promise;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve();
    gates[2].resolve();
    await run;
  });

  it('handles an empty list without hanging', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
  });

  it('never runs fewer than one worker', async () => {
    expect(await mapLimit([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
  });
});
