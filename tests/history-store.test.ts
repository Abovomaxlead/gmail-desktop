// The Gmail history-id store.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../electron/history-store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gmd-history-'));
  file = join(dir, 'nested', 'gmail-history.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('HistoryStore', () => {
  it('remembers a cursor across instances', () => {
    new HistoryStore(file).set('a@x.nl', '9900');
    expect(new HistoryStore(file).get('a@x.nl')).toBe('9900');
  });

  it('creates the folder it needs', () => {
    new HistoryStore(file).set('a@x.nl', '1');
    expect(new HistoryStore(file).get('a@x.nl')).toBe('1');
  });

  it('keeps accounts apart and is case-insensitive on the address', () => {
    const store = new HistoryStore(file);
    store.set('A@x.nl', '1');
    store.set('b@x.nl', '2');
    expect(store.get('a@X.nl')).toBe('1');
    expect(store.get('b@x.nl')).toBe('2');
  });

  it('overwrites rather than appending', () => {
    const store = new HistoryStore(file);
    store.set('a@x.nl', '1');
    store.set('a@x.nl', '2');
    expect(store.get('a@x.nl')).toBe('2');
  });

  it('forgets an account, so a removed one re-baselines if it comes back', () => {
    const store = new HistoryStore(file);
    store.set('a@x.nl', '1');
    store.remove('a@x.nl');
    expect(store.get('a@x.nl')).toBeUndefined();
  });

  it('reports nothing for an unknown account', () => {
    expect(new HistoryStore(file).get('nobody@x.nl')).toBeUndefined();
  });

  it('treats an unreadable file as empty', () => {
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ this is not json', 'utf8');
    expect(new HistoryStore(broken).get('a@x.nl')).toBeUndefined();
  });

  it('ignores a value that is not a history id', () => {
    const odd = join(dir, 'odd.json');
    writeFileSync(odd, JSON.stringify({ 'a@x.nl': { nope: 1 } }), 'utf8');
    expect(new HistoryStore(odd).get('a@x.nl')).toBeUndefined();
  });
});
