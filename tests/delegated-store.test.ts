// Merging a delegation scan into the stored list of delegated mailboxes.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DelegatedStore, mergeScan } from '../electron/delegation/delegated-store';

const d = (email: string, cal: string | null = null) => ({
  email,
  mailUrl: `https://m/${email}`,
  calendarUrl: cal,
});

describe('mergeScan', () => {
  it('adds newly scanned delegates', () => {
    const { next } = mergeScan([d('a@x.com')], [d('a@x.com'), d('b@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('never drops an existing delegate the scan missed', () => {
    const { next } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(next.map((x) => x.email).sort()).toEqual(['a@x.com', 'b@x.com']);
  });
  it('flags healthOk=false when the scan returns fewer than we hold', () => {
    const { healthOk } = mergeScan([d('a@x.com'), d('b@x.com')], [d('a@x.com')]);
    expect(healthOk).toBe(false);
  });
  it('updates calendarUrl from a fresh scan for an existing delegate', () => {
    const { next } = mergeScan([d('a@x.com', null)], [d('a@x.com', 'https://c/')]);
    expect(next.find((x) => x.email === 'a@x.com')?.calendarUrl).toBe('https://c/');
  });
});

// The API knows addresses and no URLs; the scrape knows both. Combining them therefore has
// a direction: membership may come from either source, but a URL may only ever be gained,
// never lost — a mailbox that was openable this morning must not become unopenable because
// the source that spoke last has nothing to say about URLs.
//
// The rule is on upsert because upsert is what the app actually calls. mergeScan carries it
// too, so the two cannot disagree the day something starts using it.
describe('a write that carries no url', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmd-delegated-'));
    file = join(dir, 'delegated.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps the stored url when a url-less entry is written over it', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null });
    store.upsert({ email: 'support@example.nl', mailUrl: null, calendarUrl: null });
    expect(store.list()).toEqual([
      { email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null },
    ]);
  });

  it('stores a mailbox that has no url at all', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null, calendarUrl: null });
    expect(store.list()).toEqual([{ email: 'bart@example.nl', mailUrl: null, calendarUrl: null }]);
  });

  it('takes a url when one finally arrives for a mailbox that had none', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null, calendarUrl: null });
    store.upsert({ email: 'bart@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/CD/', calendarUrl: null });
    expect(store.list()[0].mailUrl).toBe('https://mail.google.com/mail/u/0/d/CD/');
  });

  it('applies the same rule in mergeScan, so the two cannot disagree', () => {
    const existing = [{ email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/', calendarUrl: null }];
    const { next } = mergeScan(existing, [{ email: 'support@example.nl', mailUrl: null, calendarUrl: null }]);
    expect(next).toEqual(existing);
  });
});
