// The list of mailboxes the user waved away, which has to survive an update.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HiddenStore } from '../electron/accounts/hidden-store';

describe('HiddenStore', () => {
  let dir: string;
  let file: string;
  let store: HiddenStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmd-hidden-'));
    file = join(dir, 'hidden.json');
    store = new HiddenStore(file);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('holds nothing before anything is hidden', () => {
    expect(store.list()).toEqual([]);
    expect(store.has('a@x.com')).toBe(false);
  });

  it('remembers an address across a fresh reader of the same file', () => {
    store.add('a@x.com', 'authuser');
    expect(new HiddenStore(file).has('a@x.com')).toBe(true);
  });

  it('remembers what kind of mailbox was hidden', () => {
    store.add('a@x.com', 'authuser');
    store.add('support@x.com', 'delegated');
    expect(store.list()).toEqual([
      { email: 'a@x.com', kind: 'authuser' },
      { email: 'support@x.com', kind: 'delegated' },
    ]);
  });

  // The address arrives from a profile, from an IPC message and from Google's relay, and
  // those three do not agree on case.
  it('recognises an address whatever case it is asked in', () => {
    store.add('Support@Example.NL', 'delegated');
    expect(store.has('support@example.nl')).toBe(true);
    expect(store.list()[0].email).toBe('support@example.nl');
  });

  it('holds one entry per address however often it is added', () => {
    store.add('a@x.com', 'authuser');
    store.add('A@X.com', 'authuser');
    expect(store.list()).toHaveLength(1);
  });

  // Detection and the relay can both name the same address, and the second word on what it is
  // is the better one: a mailbox that turns out to be delegated must be prunable as one.
  it('lets a later add correct the kind', () => {
    store.add('a@x.com', 'authuser');
    store.add('a@x.com', 'delegated');
    expect(store.list()).toEqual([{ email: 'a@x.com', kind: 'delegated' }]);
  });

  it('forgets an address again', () => {
    store.add('a@x.com', 'authuser');
    store.add('b@x.com', 'authuser');
    store.remove('A@X.com');
    expect(store.list().map((h) => h.email)).toEqual(['b@x.com']);
    expect(store.has('a@x.com')).toBe(false);
  });

  it('names the hidden mailboxes of one kind', () => {
    store.add('a@x.com', 'authuser');
    store.add('support@x.com', 'delegated');
    store.add('info@x.com', 'delegated');
    expect(store.emailsOfKind('delegated')).toEqual(['support@x.com', 'info@x.com']);
  });

  // A file that cannot be read must not hide anything: a wrecked hidden.json costing someone
  // every mailbox is worse than one that has forgotten what was waved away.
  it('reads a broken file as nothing hidden', () => {
    writeFileSync(file, '{ not json');
    expect(new HiddenStore(file).list()).toEqual([]);
  });

  it('ignores entries in the file that carry no address', () => {
    writeFileSync(file, JSON.stringify([{ email: 'a@x.com', kind: 'delegated' }, 42, null, { kind: 'authuser' }]));
    expect(new HiddenStore(file).list()).toEqual([{ email: 'a@x.com', kind: 'delegated' }]);
  });

  // Unrecognisable is not the same as delegated: a stray kind that fell through as 'delegated'
  // would be pruned the first time the relay did not name it, which is every scan.
  it('reads an entry with no usable kind as an own account', () => {
    writeFileSync(file, JSON.stringify([{ email: 'a@x.com' }, { email: 'b@x.com', kind: 'nonsense' }]));
    expect(new HiddenStore(file).emailsOfKind('authuser')).toEqual(['a@x.com', 'b@x.com']);
  });
});
