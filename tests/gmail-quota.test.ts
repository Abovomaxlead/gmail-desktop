// The quota budget: how many units a call costs, and when it is allowed to go out. Time is
// injected, so none of this waits for real.
//
// The mechanism it replaced handed out a whole second's worth at the top of each second and then
// blocked. Two things went wrong with that under real concurrency, both measured: waiters woke
// together, all passed the check before any of them had booked, and went over the ceiling in one
// burst; and even when the sum was right, the burst itself is what Gmail answers with 429.

import { describe, it, expect } from 'vitest';
import {
  QUOTA_COST,
  UNITS_PER_SECOND,
  quotaCost,
  callForUrl,
  createQuotaBudget,
} from '../electron/gmail/quota';

/** A clock that stands still, for asserting on the wait a call was given rather than on a
 * timeline. Concurrent sleeps cannot be modelled by adding milliseconds to a counter. */
const frozen = () => {
  const waits: number[] = [];
  return { now: () => 1_000, sleep: async (ms: number) => void waits.push(ms), waits };
};

/** A clock that only moves when a sleep asks it to, for calls that follow each other. */
const clock = (start = 1_000) => {
  let now = start;
  const waits: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
    waits,
    tick: (ms: number) => {
      now += ms;
    },
  };
};

describe('QUOTA_COST', () => {
  // The numbers every limit is derived from, so a wrong one is a wrong limit
  it('prices the calls a drag and a copy are made of', () => {
    expect(QUOTA_COST['messages.get']).toBe(5);
    expect(QUOTA_COST['messages.list']).toBe(5);
    expect(QUOTA_COST['messages.insert']).toBe(25);
    expect(QUOTA_COST['threads.get']).toBe(10);
    expect(QUOTA_COST['history.list']).toBe(2);
  });

  // This app under-booked every trash call by a factor of four: Google's published table
  // prices messages.trash at 20, not the 5 this table carried. A pre-existing error, found
  // and fixed alongside the marker sweep -- not part of what the sweep itself adds.
  it('prices a trash at Google\'s published 20, not the 5 this table used to carry', () => {
    expect(QUOTA_COST['messages.trash']).toBe(20);
  });

  // What the marker sweep adds: one label per run, and a bulk modify to strip or trash by it.
  it('prices the calls the marker sweep adds', () => {
    expect(QUOTA_COST['messages.batchModify']).toBe(50);
    expect(QUOTA_COST['labels.create']).toBe(5);
    expect(QUOTA_COST['labels.delete']).toBe(5);
  });

  it('charges the dearest price it knows for a call it does not know', () => {
    expect(quotaCost('something.new')).toBe(Math.max(...Object.values(QUOTA_COST)));
  });
});

describe('createQuotaBudget, pacing', () => {
  const insertsPerSecond = UNITS_PER_SECOND / QUOTA_COST['messages.insert'];

  it('lets the first call go without waiting', async () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    await budget.take('messages.insert');
    expect(c.waits).toEqual([]);
  });

  // The heart of it, and it has to be asserted on the waits the budget hands out rather than on
  // a clock: a fake clock that adds milliseconds models sleeps that follow each other, not
  // sleeps that run at the same time, which is the whole case under test.
  it('spreads a second of calls across the second instead of bursting them', async () => {
    const c = frozen();
    const budget = createQuotaBudget(c);
    for (let i = 0; i < insertsPerSecond; i += 1) await budget.take('messages.insert');
    // The first goes straight out; each one behind it waits a slice longer, and the last of the
    // second waits almost the whole second.
    expect(c.waits).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  // What the old window did wrong: eighteen waiters woke together, all saw room, and all booked
  it('never lets more than the allowance start inside any one second', async () => {
    const c = frozen();
    const budget = createQuotaBudget(c);
    const starts: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const before = c.waits.length;
      await budget.take('messages.insert');
      starts.push(c.waits.length > before ? c.waits[c.waits.length - 1] : 0);
    }
    for (const t of starts) {
      const inThatSecond = starts.filter((x) => x >= t && x < t + 1000).length;
      expect(inThatSecond).toBeLessThanOrEqual(insertsPerSecond);
    }
  });

  it('holds a dear call back longer than a cheap one', async () => {
    const dear = clock();
    const cheap = clock();
    const a = createQuotaBudget({ now: dear.now, sleep: dear.sleep });
    const b = createQuotaBudget({ now: cheap.now, sleep: cheap.sleep });
    for (let i = 0; i < 20; i += 1) await a.take('messages.insert');
    for (let i = 0; i < 20; i += 1) await b.take('history.list');
    expect(dear.now()).toBeGreaterThan(cheap.now());
  });

  // A quiet minute should not earn the right to fire a minute's worth at once
  it('does not bank up more than a short burst while it is idle', async () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    c.tick(60_000);
    let free = 0;
    for (let i = 0; i < 60; i += 1) {
      const before = c.now();
      await budget.take('messages.insert');
      if (c.now() === before) free += 1;
    }
    expect(free).toBeLessThanOrEqual(insertsPerSecond);
  });
});

describe('createQuotaBudget, when Gmail refuses anyway', () => {
  it('starts at the published allowance', () => {
    const c = clock();
    expect(createQuotaBudget({ now: c.now, sleep: c.sleep }).ceiling()).toBe(UNITS_PER_SECOND);
  });

  // Nobody is told when a project is moved to the tighter price list Google published; a refusal
  // that arrives while the budget thought there was room is the only signal there is.
  it('gives itself less after being refused', () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    const before = budget.ceiling();
    budget.refused();
    expect(budget.ceiling()).toBeLessThan(before);
  });

  it('stops lowering at a floor rather than down to nothing', () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    for (let i = 0; i < 40; i += 1) budget.refused();
    expect(budget.ceiling()).toBeGreaterThan(0);
  });

  // One bad minute used to cost the rest of the session: the ceiling only ever went down
  it('climbs back after a quiet spell', async () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    budget.refused();
    const lowered = budget.ceiling();
    c.tick(10 * 60_000);
    await budget.take('history.list');
    expect(budget.ceiling()).toBeGreaterThan(lowered);
  });

  it('does not climb past the published allowance', async () => {
    const c = clock();
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep });
    budget.refused();
    c.tick(24 * 60 * 60_000);
    await budget.take('history.list');
    expect(budget.ceiling()).toBe(UNITS_PER_SECOND);
  });

  it('paces to the lowered ceiling while it is lowered', async () => {
    const full = clock();
    const cut = clock();
    const a = createQuotaBudget({ now: full.now, sleep: full.sleep });
    const b = createQuotaBudget({ now: cut.now, sleep: cut.sleep });
    b.refused();
    for (let i = 0; i < 20; i += 1) await a.take('messages.insert');
    for (let i = 0; i < 20; i += 1) await b.take('messages.insert');
    expect(cut.now()).toBeGreaterThan(full.now());
  });

  // The line has to reach the log the app actually keeps, not just a terminal nobody is watching
  it('reports a lowered ceiling to whoever is listening', () => {
    const c = clock();
    const notes: string[] = [];
    const budget = createQuotaBudget({ now: c.now, sleep: c.sleep }, (m) => notes.push(m));
    budget.refused();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('plafond');
  });
});

describe('callForUrl', () => {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';

  it('reads one message as a get and a search as a list', () => {
    expect(callForUrl(`${base}/messages/abc?format=raw`)).toBe('messages.get');
    expect(callForUrl(`${base}/messages?q=rfc822msgid:x`)).toBe('messages.list');
  });

  it('reads one conversation as a get and prices it as one', () => {
    expect(callForUrl(`${base}/threads/abc?format=minimal`)).toBe('threads.get');
    expect(callForUrl(`${base}/threads?labelIds=L1`)).toBe('threads.list');
  });

  it('names the cheap calls the sync leans on', () => {
    expect(callForUrl(`${base}/history?startHistoryId=1`)).toBe('history.list');
    expect(callForUrl(`${base}/labels`)).toBe('labels.list');
    expect(callForUrl(`${base}/profile`)).toBe('users.getProfile');
  });

  // The upload endpoint is a different host path, and the dearest call of the drag
  it('reads the upload endpoint as an insert', () => {
    expect(
      callForUrl('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages?uploadType=multipart'),
    ).toBe('messages.insert');
  });

  it('reads the watch calls as a watch', () => {
    expect(callForUrl(`${base}/watch`)).toBe('watch');
    expect(callForUrl(`${base}/stop`)).toBe('watch');
  });

  // A POST to a message is a change, not a read, and Gmail prices those apart
  it('tells a modify from a plain get', () => {
    expect(callForUrl(`${base}/messages/abc/modify`)).toBe('messages.modify');
    expect(callForUrl(`${base}/messages/abc/trash`)).toBe('messages.trash');
  });

  // A create is a POST to the bare collection, same path as a list -- the two must be told
  // apart by method, or a create is silently booked at labels.list's much cheaper price.
  it('tells a label create from a label list by method, not by path alone', () => {
    expect(callForUrl(`${base}/labels`, 'GET')).toBe('labels.list');
    expect(callForUrl(`${base}/labels`)).toBe('labels.list'); // no init at all: a plain read, same as today
    expect(callForUrl(`${base}/labels`, 'POST')).toBe('labels.create');
  });

  it('reads a label delete off its own path and method', () => {
    expect(callForUrl(`${base}/labels/L9`, 'DELETE')).toBe('labels.delete');
  });

  // rest.split('/')[1] is undefined for a bulk-verb path with no message id in front of it,
  // which used to fall through to the plain messages.get branch and silently under-book a
  // batchModify at a fifth of its real price.
  it('reads batchModify as its own call, not as a plain get', () => {
    expect(callForUrl(`${base}/messages/batchModify`)).toBe('messages.batchModify');
  });
});
