// What the app already knows about where a mail sits, without asking Gmail. Time is passed
// in, so nothing here waits or depends on the day it runs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  INDEX_TTL_MS,
  emptyIndex,
  remember,
  knownLabels,
  prune,
  capEntries,
  MAX_ENTRIES,
  indexedScan,
  toRecords,
  fromRecords,
  MessageIndexStore,
} from '../electron/mail/message-index';

const day = 24 * 60 * 60 * 1000;

describe('remember and knownLabels', () => {
  it('gives back what it was told', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['INBOX', 'L1'], 1000);
    expect(knownLabels(index, '<a@x>', 'b@x.nl', 1000)).toEqual(['INBOX', 'L1']);
  });

  // Never seen and known-to-hold-nothing are different answers, and only one of them may be
  // drawn without asking Gmail
  it('says nothing about a mail it has never seen', () => {
    expect(knownLabels(emptyIndex(), '<a@x>', 'b@x.nl', 1000)).toBeNull();
  });

  it('keeps one mailbox from answering for another', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    expect(knownLabels(index, '<a@x>', 'c@x.nl', 1000)).toBeNull();
  });

  it('matches a Message-ID whether or not it wears its brackets', () => {
    const index = emptyIndex();
    remember(index, 'a@x', 'b@x.nl', ['L1'], 1000);
    expect(knownLabels(index, '<a@x>', 'b@x.nl', 1000)).toEqual(['L1']);
  });

  it('adds a label to what it already knew rather than replacing it', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    remember(index, '<a@x>', 'b@x.nl', ['L2'], 2000);
    expect(knownLabels(index, '<a@x>', 'b@x.nl', 2000)).toEqual(['L1', 'L2']);
  });

  it('does not count the same label twice', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 2000);
    expect(knownLabels(index, '<a@x>', 'b@x.nl', 2000)).toEqual(['L1']);
  });

  // A label can be taken off in Gmail and the mail can be thrown away, neither of which this
  // ever hears about, so what it knows has a shelf life
  it('has forgotten an entry that is past its shelf life', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    expect(knownLabels(index, '<a@x>', 'b@x.nl', 1000 + INDEX_TTL_MS + 1)).toBeNull();
  });
});

describe('prune', () => {
  it('drops what has gone stale and keeps the rest', () => {
    const index = emptyIndex();
    remember(index, '<old@x>', 'b@x.nl', ['L1'], 0);
    remember(index, '<new@x>', 'b@x.nl', ['L1'], 30 * day);
    prune(index, 30 * day + 1);
    expect(knownLabels(index, '<new@x>', 'b@x.nl', 30 * day + 1)).toEqual(['L1']);
    expect(knownLabels(index, '<old@x>', 'b@x.nl', 30 * day + 1)).toBeNull();
  });

  it('leaves no empty shells behind', () => {
    const index = emptyIndex();
    remember(index, '<old@x>', 'b@x.nl', ['L1'], 0);
    prune(index, 30 * day + 1);
    expect(index.size).toBe(0);
  });
});

describe('indexedScan', () => {
  const ids = ['<a@x>', '<b@x>'];

  // The picker can draw this before a single request has gone out
  it('answers for the mails it knows and stays quiet about the rest', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    expect(indexedScan(index, ids, 'b@x.nl', 1000)).toEqual([
      { messageId: '<a@x>', labelIds: ['L1'] },
    ]);
  });

  it('has nothing to say when it knows none of them', () => {
    expect(indexedScan(emptyIndex(), ids, 'b@x.nl', 1000)).toEqual([]);
  });
});

describe('toRecords and fromRecords', () => {
  it('survives a round trip through the file', () => {
    const index = emptyIndex();
    remember(index, '<a@x>', 'b@x.nl', ['L1'], 1000);
    remember(index, '<a@x>', 'c@x.nl', ['L2'], 2000);
    const back = fromRecords(JSON.parse(JSON.stringify(toRecords(index))));
    expect(knownLabels(back, '<a@x>', 'b@x.nl', 2000)).toEqual(['L1']);
    expect(knownLabels(back, '<a@x>', 'c@x.nl', 2000)).toEqual(['L2']);
  });

  it('reads a junk file as an empty index rather than throwing', () => {
    expect(fromRecords(null).size).toBe(0);
    expect(fromRecords({ '<a@x>': 'not a list' }).size).toBe(0);
  });
});

describe('MessageIndexStore', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gmd-index-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('remembers across a restart', async () => {
    const path = join(dir, 'index.json');
    const first = new MessageIndexStore(path);
    remember(first.load(), '<a@x>', 'b@x.nl', ['L1'], 1000);
    await first.flush(1000);
    expect(knownLabels(new MessageIndexStore(path).load(), '<a@x>', 'b@x.nl', 1000)).toEqual(['L1']);
  });

  // The file runs to megabytes and a copy asks for a write once per mailbox, so asking is not
  // writing: the requests fold into one and none of them blocks the main thread
  it('does not write the moment it is asked to', () => {
    const path = join(dir, 'index.json');
    const store = new MessageIndexStore(path);
    remember(store.load(), '<a@x>', 'b@x.nl', ['L1'], 1000);
    store.save(1000);
    store.save(1000);
    expect(existsSync(path)).toBe(false);
  });

  it('writes what was asked for when it is flushed', async () => {
    const path = join(dir, 'index.json');
    const store = new MessageIndexStore(path);
    remember(store.load(), '<a@x>', 'b@x.nl', ['L1'], 1000);
    store.save(1000);
    await store.flush(1000);
    expect(existsSync(path)).toBe(true);
  });

  it('reads a missing file as an empty index', () => {
    expect(new MessageIndexStore(join(dir, 'nope.json')).load().size).toBe(0);
  });

  it('reads a corrupt file as an empty index rather than throwing', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, 'niet json', 'utf8');
    expect(new MessageIndexStore(path).load().size).toBe(0);
  });

  it('does not write back what has gone stale', async () => {
    const path = join(dir, 'index.json');
    const store = new MessageIndexStore(path);
    remember(store.load(), '<a@x>', 'b@x.nl', ['L1'], 0);
    await store.flush(INDEX_TTL_MS + 1);
    expect(new MessageIndexStore(path).load().size).toBe(0);
  });

  it('does not write back more entries than it is allowed to keep', async () => {
    const path = join(dir, 'index.json');
    const store = new MessageIndexStore(path);
    const index = store.load();
    for (let i = 0; i < MAX_ENTRIES + 50; i += 1) {
      remember(index, `<m${i}@x>`, 'b@x.nl', ['L1'], 1000 + i);
    }
    await store.flush(1000);
    expect(new MessageIndexStore(path).load().size).toBe(MAX_ENTRIES);
  });
});

describe('capEntries', () => {
  const at = (n: number) => ({ email: 'b@x.nl', labelIds: ['L1'], at: n });

  // The shelf life alone did not bound this: thirty days of company mail is megabytes of file
  it('keeps the newest entries and drops the oldest', () => {
    const index = new Map([
      ['old@x', [at(1)]],
      ['mid@x', [at(2)]],
      ['new@x', [at(3)]],
    ]);
    capEntries(index, 2);
    expect([...index.keys()].sort()).toEqual(['mid@x', 'new@x']);
  });

  it('leaves an index that fits alone', () => {
    const index = new Map([['a@x', [at(1)]]]);
    capEntries(index, 10);
    expect(index.size).toBe(1);
  });

  // A Message-ID known in several mailboxes counts once, and keeps all of them
  it('judges an entry by the most recent mailbox it was seen in', () => {
    const index = new Map([
      ['a@x', [at(1), at(9)]],
      ['b@x', [at(5)]],
    ]);
    capEntries(index, 1);
    expect([...index.keys()]).toEqual(['a@x']);
    expect(index.get('a@x')).toHaveLength(2);
  });
});
