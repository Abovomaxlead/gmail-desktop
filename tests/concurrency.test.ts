// mapLimit: running work with a bounded number of slots.

import { describe, it, expect } from 'vitest';
import { mapLimit, memoise, createUploadBudget } from '../electron/core/concurrency';

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

describe('memoise', () => {
  it('does the work once for the same key', async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const make = async () => {
      calls += 1;
      return 42;
    };
    expect(await memoise(cache, 'a', make)).toBe(42);
    expect(await memoise(cache, 'a', make)).toBe(42);
    expect(calls).toBe(1);
  });

  // The whole point: twenty-two rows of one conversation ask at the same moment, before any of
  // them has an answer. Caching the promise rather than the value is what makes them share it.
  it('lets callers that ask at the same moment share one answer', async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const make = async () => {
      calls += 1;
      await Promise.resolve();
      return 7;
    };
    const answers = await Promise.all(
      Array.from({ length: 22 }, () => memoise(cache, 't1', make)),
    );
    expect(answers).toEqual(Array.from({ length: 22 }, () => 7));
    expect(calls).toBe(1);
  });

  it('keeps different keys apart', async () => {
    const cache = new Map<string, Promise<string>>();
    expect(await memoise(cache, 'a', async () => 'A')).toBe('A');
    expect(await memoise(cache, 'b', async () => 'B')).toBe('B');
  });

  // A cache that keeps a rejection hands the same failure to everyone who asks later, so it
  // forgets one instead and the next caller may try again
  it('does not keep a failure', async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const make = async () => {
      calls += 1;
      if (calls === 1) throw new Error('eenmalig');
      return 9;
    };
    await expect(memoise(cache, 'a', make)).rejects.toThrow('eenmalig');
    expect(await memoise(cache, 'a', make)).toBe(9);
    expect(calls).toBe(2);
  });
});

describe('createUploadBudget', () => {
  const MB = 1024 * 1024;

  it('lets an upload that fits start straight away', async () => {
    const budget = createUploadBudget(10 * MB, 8);
    expect(await budget.run(MB, async () => 'klaar')).toBe('klaar');
  });

  // The whole point: small mails should not be held back by a limit set for big ones
  it('runs many small uploads alongside each other', async () => {
    const budget = createUploadBudget(10 * MB, 32);
    const gate = defer<void>();
    let live = 0;
    let peak = 0;
    const runs = Array.from({ length: 20 }, () =>
      budget.run(50 * 1024, async () => {
        live += 1;
        peak = Math.max(peak, live);
        await gate.promise;
        live -= 1;
      }),
    );
    await Promise.resolve();
    gate.resolve();
    await Promise.all(runs);
    expect(peak).toBe(20);
  });

  it('holds an upload back until the bytes come free', async () => {
    const budget = createUploadBudget(10 * MB, 8);
    const first = defer<void>();
    let secondStarted = false;
    const a = budget.run(8 * MB, () => first.promise);
    const b = budget.run(8 * MB, async () => {
      secondStarted = true;
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    first.resolve();
    await Promise.all([a, b]);
    expect(secondStarted).toBe(true);
  });

  it('holds an upload back on the count as well, even when the bytes fit', async () => {
    const budget = createUploadBudget(100 * MB, 2);
    const gate = defer<void>();
    let live = 0;
    let peak = 0;
    const runs = Array.from({ length: 5 }, () =>
      budget.run(1024, async () => {
        live += 1;
        peak = Math.max(peak, live);
        await gate.promise;
        live -= 1;
      }),
    );
    await Promise.resolve();
    gate.resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  // An upload that fails still has to give its room back, or the copy seizes up after one error
  it('gives the room back when an upload throws', async () => {
    const budget = createUploadBudget(1 * MB, 8);
    await expect(budget.run(MB, async () => { throw new Error('mislukt'); })).rejects.toThrow('mislukt');
    expect(await budget.run(MB, async () => 'daarna')).toBe('daarna');
  });

  // A mail bigger than the whole budget would otherwise wait for room that can never come
  it('runs an upload larger than the whole budget, on its own', async () => {
    const budget = createUploadBudget(1 * MB, 8);
    const gate = defer<void>();
    let alongside = false;
    const big = budget.run(20 * MB, () => gate.promise);
    const small = budget.run(1024, async () => {
      alongside = true;
    });
    await Promise.resolve();
    expect(alongside).toBe(false);
    gate.resolve();
    await Promise.all([big, small]);
    expect(alongside).toBe(true);
  });

  // Without this a stream of small mails would keep jumping the queue and the big one would
  // never get its room
  it('does not let a queue of small uploads starve a big one', async () => {
    const budget = createUploadBudget(10 * MB, 8);
    const first = defer<void>();
    const order: string[] = [];
    const a = budget.run(9 * MB, () => first.promise);
    const big = budget.run(9 * MB, async () => {
      order.push('groot');
    });
    const small = budget.run(1024, async () => {
      order.push('klein');
    });
    await Promise.resolve();
    first.resolve();
    await Promise.all([a, big, small]);
    expect(order).toEqual(['groot', 'klein']);
  });
});
