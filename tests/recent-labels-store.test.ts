// Remembering today's copy destinations, and forgetting them when the day turns.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecentLabelStore, RECENT_KEPT, localDay } from '../electron/mail/recent-labels-store';

describe('localDay', () => {
  // The day has to be the user's, not UTC. notify.log stamps UTC and this does not: at half
  // past midnight local time those two disagree about which day it is, and this is the one the
  // person in front of the screen means.
  it('is the date where the user is, not in UTC', () => {
    expect(localDay(new Date(2026, 7, 28, 0, 30))).toBe('2026-08-28');
    expect(localDay(new Date(2026, 7, 28, 23, 30))).toBe('2026-08-28');
  });

  it('pads a single-digit month and day', () => {
    expect(localDay(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});

describe('RecentLabelStore', () => {
  let dir: string;
  let file: string;
  let now: number;
  let store: RecentLabelStore;

  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmd-recent-'));
    file = join(dir, 'recent-labels.json');
    now = at(2026, 8, 28);
    store = new RecentLabelStore(file, () => now);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('holds nothing before anything is copied', () => {
    expect(store.today()).toEqual([]);
  });

  it('remembers a label a copy went into', () => {
    store.remember('a@x.com', ['L1']);
    expect(store.today()).toEqual([{ email: 'a@x.com', labelId: 'L1', at: now }]);
  });

  it('remembers every label of one copy', () => {
    store.remember('a@x.com', ['L1', 'L2']);
    expect(store.today().map((e) => e.labelId)).toEqual(['L1', 'L2']);
  });

  it('survives a restart within the same day', () => {
    store.remember('a@x.com', ['L1']);
    expect(new RecentLabelStore(file, () => now).today()).toHaveLength(1);
  });

  // The whole rule: the list is about today. Nothing sweeps, nothing expires -- the date in
  // the file is read, and a different one means the file has nothing to say.
  it('forgets everything once the day has turned', () => {
    store.remember('a@x.com', ['L1']);
    now = at(2026, 8, 29);
    expect(store.today()).toEqual([]);
  });

  it('starts the new day clean rather than appending to yesterday', () => {
    store.remember('a@x.com', ['L1']);
    now = at(2026, 8, 29);
    store.remember('a@x.com', ['L2']);
    expect(store.today().map((e) => e.labelId)).toEqual(['L2']);
  });

  // A job walks batch after batch through the same targets. Appending each pass would spend
  // the whole file on one label and lose every other mailbox of the day.
  it('moves a label it already holds to the end instead of adding it again', () => {
    store.remember('a@x.com', ['L1']);
    store.remember('a@x.com', ['L2']);
    now += 1000;
    store.remember('a@x.com', ['L1']);
    expect(store.today()).toEqual([
      { email: 'a@x.com', labelId: 'L2', at: now - 1000 },
      { email: 'a@x.com', labelId: 'L1', at: now },
    ]);
  });

  it('tells the same label in two mailboxes apart', () => {
    store.remember('a@x.com', ['L1']);
    store.remember('b@x.com', ['L1']);
    expect(store.today()).toHaveLength(2);
  });

  it('keeps the newest when a heavy day runs past the cap', () => {
    for (let i = 0; i < RECENT_KEPT + 5; i += 1) store.remember('a@x.com', [`L${i}`]);
    const held = store.today();
    expect(held).toHaveLength(RECENT_KEPT);
    expect(held[held.length - 1].labelId).toBe(`L${RECENT_KEPT + 4}`);
  });

  it('ignores an empty list of labels, which is what a tree copy passes', () => {
    store.remember('a@x.com', []);
    expect(store.today()).toEqual([]);
  });

  // Losing the shortcut is a nuisance; a broken picker is not. Anything unreadable reads as a
  // day with nothing in it.
  it('reads a broken file as nothing used today', () => {
    writeFileSync(file, '{ not json');
    expect(new RecentLabelStore(file, () => now).today()).toEqual([]);
  });

  it('ignores entries in the file that are not a use', () => {
    writeFileSync(
      file,
      JSON.stringify({
        day: '2026-08-28',
        entries: [{ email: 'a@x.com', labelId: 'L1', at: now }, 7, null, { email: 'b@x.com' }],
      }),
    );
    expect(new RecentLabelStore(file, () => now).today()).toEqual([
      { email: 'a@x.com', labelId: 'L1', at: now },
    ]);
  });
});
