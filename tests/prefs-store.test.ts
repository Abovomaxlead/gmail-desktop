// The preferences store: defaults, the patch per tab, and its file on disk.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore, DEFAULT_PREFS } from '../electron/core/prefs-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  file = join(dir, 'prefs.json');
});

describe('PrefsStore', () => {
  it('returns defaults when the file is missing', () => {
    const store = new PrefsStore(file);
    expect(store.getAll()).toEqual(DEFAULT_PREFS);
  });

  it('persists and re-reads a window patch', () => {
    const store = new PrefsStore(file);
    store.setWindow({ width: 900, height: 700, x: 10, y: 20, maximized: true });
    expect(new PrefsStore(file).getAll().window).toEqual({
      width: 900, height: 700, x: 10, y: 20, maximized: true,
    });
  });

  it('merges partial account prefs without dropping siblings', () => {
    const store = new PrefsStore(file);
    store.setAccount('a@x.com', { zoom: 1 });
    store.setAccount('a@x.com', { label: 'Work' });
    expect(store.getAccount('a@x.com')).toEqual({ zoom: 1, label: 'Work' });
  });

  it('assigns 0..n-1 order from setOrder', () => {
    const store = new PrefsStore(file);
    store.setOrder(['b@x.com', 'a@x.com']);
    expect(store.getAccount('b@x.com').order).toBe(0);
    expect(store.getAccount('a@x.com').order).toBe(1);
  });

  it('round-trips a per-account badgeCount=false through save and load', () => {
    const store = new PrefsStore(file);
    store.setAccount('a@b.com', { badgeCount: false });
    expect(store.getAll().accounts['a@b.com'].badgeCount).toBe(false);
    expect(new PrefsStore(file).getAccount('a@b.com').badgeCount).toBe(false);
  });

  // Proves the cache rather than the file: with no cache, two calls to getAll() each build
  // and return a fresh object, so this fails even though both would be deeply equal.
  it('returns the same object from a second read, without re-reading the file', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    expect(store.getAll()).toBe(store.getAll());
  });

  it('drops a hand-edited account entry that is not an object', () => {
    writeFileSync(file, JSON.stringify({ accounts: { 'a@b.com': 5 } }), 'utf8');
    expect(new PrefsStore(file).getAccount('a@b.com')).toEqual({});
  });

  it('keeps the valid fields of a hand-edited account and drops the malformed ones', () => {
    writeFileSync(
      file,
      JSON.stringify({ accounts: { 'a@b.com': { zoom: 'big', notify: true } } }),
      'utf8',
    );
    expect(new PrefsStore(file).getAccount('a@b.com')).toEqual({ notify: true });
  });

  // A corrupt file used to mean defaults, which is how an update cost people their
  // settings. It now means the backup, and only a corrupt backup as well means defaults.
  it('tolerates a corrupt file by reading the backup beside it', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    require('node:fs').writeFileSync(file, '{not json', 'utf8');
    expect(new PrefsStore(file).getAll().theme).toBe('dark');
  });

  it('returns defaults when the file and its backup are both corrupt', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    require('node:fs').writeFileSync(file, '{not json', 'utf8');
    require('node:fs').writeFileSync(`${file}.bak`, '{not json either', 'utf8');
    expect(new PrefsStore(file).getAll()).toEqual(DEFAULT_PREFS);
  });

  it('defaults reneMode to false and round-trips it', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().reneMode).toBe(false);
    store.setReneMode(true);
    expect(new PrefsStore(file).getAll().reneMode).toBe(true);
    store.setReneMode(false);
    expect(new PrefsStore(file).getAll().reneMode).toBe(false);
  });

  it('ignores a non-boolean stored reneMode', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    const fs = require('node:fs');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.reneMode = 'yes';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(new PrefsStore(file).getAll().reneMode).toBe(false);
  });

  it('defaults launchMinimized to false and round-trips it without touching autoStart', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().launchMinimized).toBe(false);
    store.setAutoStart(true);
    store.setLaunchMinimized(true);
    const back = new PrefsStore(file).getAll();
    expect(back.launchMinimized).toBe(true);
    expect(back.autoStart).toBe(true);
    store.setLaunchMinimized(false);
    expect(new PrefsStore(file).getAll().autoStart).toBe(true);
  });

  it('ignores a non-boolean stored launchMinimized', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    const fs = require('node:fs');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.launchMinimized = 'sure';
    fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
    expect(new PrefsStore(file).getAll().launchMinimized).toBe(false);
  });

  it('deep-merges stored notifications over defaults', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } });
    expect(new PrefsStore(file).getAll().notifications.dnd).toBe(true);
  });

  it('defaults dndUntil to undefined when absent', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: false, quietHours: { enabled: false, start: '18:00', end: '08:00' } });
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBeUndefined();
  });

  it('persists and re-reads a numeric dndUntil', () => {
    const store = new PrefsStore(file);
    store.setNotifications({ dnd: false, dndUntil: 1893456000000, quietHours: { enabled: false, start: '18:00', end: '08:00' } });
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBe(1893456000000);
  });

  it('ignores a non-numeric dndUntil on disk', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    require('node:fs').writeFileSync(
      file,
      JSON.stringify({ notifications: { dnd: false, dndUntil: 'soon', quietHours: { enabled: false, start: '18:00', end: '08:00' } } }),
      'utf8',
    );
    expect(new PrefsStore(file).getAll().notifications.dndUntil).toBeUndefined();
  });

  it('defaults the language to the system language', () => {
    const store = new PrefsStore(file);
    expect(store.getAll().language).toBe('system');
    expect(DEFAULT_PREFS.language).toBe('system');
  });

  it('stores an explicit language choice', () => {
    const store = new PrefsStore(file);
    store.setLanguage('nl');
    expect(store.getAll().language).toBe('nl');
    expect(new PrefsStore(file).getAll().language).toBe('nl');
  });

  it('rejects a language a prefs file from another version may hold', () => {
    const store = new PrefsStore(file);
    store.setLanguage('nl');
    writeFileSync(file, JSON.stringify({ ...store.getAll(), language: 'fr' }));
    expect(new PrefsStore(file).getAll().language).toBe('system');
  });

  it('defaults the tour to unseen', () => {
    expect(new PrefsStore(file).getAll().tour).toEqual({ seen: false });
  });

  // A prefs.json written by a build from before the tour existed has no tour key at all,
  // and an undefined field would make the trigger's `prefs.tour.seen` throw.
  it('reads a prefs file written before the tour existed as unseen', () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }), 'utf8');
    expect(new PrefsStore(file).getAll().tour).toEqual({ seen: false });
  });

  it('remembers the tour as seen across a reload', () => {
    const store = new PrefsStore(file);
    store.setTour({ seen: true });
    expect(new PrefsStore(file).getAll().tour.seen).toBe(true);
  });

  it('leaves the other tabs alone when the tour is marked seen', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setTour({ seen: true });
    expect(new PrefsStore(file).getAll().theme).toBe('dark');
  });
});

describe('PrefsStore mailDrop', () => {
  it('defaults to an empty folder (meaning: use the default location)', () => {
    expect(new PrefsStore(file).getAll().mailDrop).toEqual({ folder: '' });
  });

  it('persists a chosen folder across instances', () => {
    new PrefsStore(file).setMailDropFolder('D:\\Mail');
    expect(new PrefsStore(file).getAll().mailDrop.folder).toBe('D:\\Mail');
  });

  it('keeps other prefs intact when the folder changes', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setMailDropFolder('D:\\Mail');
    expect(store.getAll().theme).toBe('dark');
  });

  it('ignores a non-string folder in a hand-edited file', () => {
    require('node:fs').writeFileSync(file, JSON.stringify({ mailDrop: { folder: 42 } }), 'utf8');
    expect(new PrefsStore(file).getAll().mailDrop.folder).toBe('');
  });
});

describe('PrefsStore survives a write the app was killed in the middle of', () => {
  it('reads the settings back when prefs.json was truncated', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setLanguage('nl');
    // what an update leaves behind when the installer kills the app inside a write
    writeFileSync(file, '{"theme": "da', 'utf8');
    const reread = new PrefsStore(file).getAll();
    expect(reread.theme).toBe('dark');
    expect(reread.language).toBe('nl');
  });

  it('reads the settings back when prefs.json was truncated to nothing', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    writeFileSync(file, '', 'utf8');
    expect(new PrefsStore(file).getAll().theme).toBe('dark');
  });

  it('does not resurrect an old setting the user has since changed', () => {
    const store = new PrefsStore(file);
    store.setTheme('dark');
    store.setTheme('light');
    expect(new PrefsStore(file).getAll().theme).toBe('light');
  });
});

describe('PrefsStore update channel', () => {
  // Absent is the whole point: it means nobody has chosen, which is what makes the app
  // behave as it did before the setting existed. Collapsing it to false would silently
  // take every beta tester off the beta channel.
  it('leaves allowPrerelease absent until it is set', () => {
    expect(new PrefsStore(file).getAll().updates.allowPrerelease).toBeUndefined();
  });

  it('round-trips both choices across instances', () => {
    const store = new PrefsStore(file);
    store.setUpdates({ allowPrerelease: true });
    expect(new PrefsStore(file).getAll().updates.allowPrerelease).toBe(true);
    store.setUpdates({ allowPrerelease: false });
    expect(new PrefsStore(file).getAll().updates.allowPrerelease).toBe(false);
  });

  it('ignores a non-boolean in a hand-edited file rather than trusting it', () => {
    writeFileSync(file, JSON.stringify({ updates: { allowPrerelease: 'yes' } }), 'utf8');
    expect(new PrefsStore(file).getAll().updates.allowPrerelease).toBeUndefined();
  });

  it('keeps the other update prefs when the channel changes', () => {
    const store = new PrefsStore(file);
    store.setUpdates({ notify: false });
    store.setUpdates({ allowPrerelease: true });
    const u = new PrefsStore(file).getAll().updates;
    expect(u).toEqual({ autoCheck: true, notify: false, allowPrerelease: true });
  });
});

describe('PrefsStore advanced.lowMemory', () => {
  it('defaults to off, so nothing changes for anyone who never asked', () => {
    expect(new PrefsStore(file).getAll().advanced.lowMemory).toBe(false);
  });

  it('round-trips without disturbing hardware acceleration', () => {
    const store = new PrefsStore(file);
    store.setAdvanced({ hardwareAcceleration: false });
    store.setAdvanced({ lowMemory: true });
    expect(new PrefsStore(file).getAll().advanced).toEqual({
      hardwareAcceleration: false,
      lowMemory: true,
    });
  });

  it('ignores a non-boolean in a hand-edited file', () => {
    writeFileSync(file, JSON.stringify({ advanced: { lowMemory: 'yes' } }), 'utf8');
    expect(new PrefsStore(file).getAll().advanced.lowMemory).toBe(false);
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));
