// The stored list of delegated mailboxes: adding, updating, and removing entries.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DelegatedStore } from '../electron/delegation/delegated-store';

// The API knows addresses and no URL; the scrape knows both. Combining them therefore has
// a direction: membership may come from either source, but a URL may only ever be gained,
// never lost — a mailbox that was openable this morning must not become unopenable because
// the source that spoke last has nothing to say about URLs.
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
    store.upsert({ email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/' });
    store.upsert({ email: 'support@example.nl', mailUrl: null });
    expect(store.list()).toEqual([
      { email: 'support@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/AB/' },
    ]);
  });

  it('stores a mailbox that has no url at all', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null });
    expect(store.list()).toEqual([{ email: 'bart@example.nl', mailUrl: null }]);
  });

  it('takes a url when one finally arrives for a mailbox that had none', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null });
    store.upsert({ email: 'bart@example.nl', mailUrl: 'https://mail.google.com/mail/u/0/d/CD/' });
    expect(store.list()[0].mailUrl).toBe('https://mail.google.com/mail/u/0/d/CD/');
  });

  it('forgets a removed mailbox for good', () => {
    const store = new DelegatedStore(file);
    store.upsert({ email: 'bart@example.nl', mailUrl: null });
    store.remove('bart@example.nl');
    expect(store.list()).toEqual([]);
  });
});
