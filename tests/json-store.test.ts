// Reading and writing a store file: the swap that never shows half a file, and the backup a
// read falls back to when the main file is wreckage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupPath,
  readJsonFile,
  tempPath,
  writeFileAtomic,
  writeJsonFile,
} from '../electron/core/json-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'json-store-'));
  file = join(dir, 'prefs.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readJsonFile', () => {
  it('returns null when there is no file at all', () => {
    expect(readJsonFile(file)).toBeNull();
  });

  it('reads the file when it parses', () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }), 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'dark' });
  });

  it('falls back to the backup when the main file is truncated', () => {
    writeFileSync(backupPath(file), JSON.stringify({ theme: 'dark' }), 'utf8');
    writeFileSync(file, '{"theme": "da', 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'dark' });
  });

  it('falls back to the backup when the main file was truncated to nothing', () => {
    writeFileSync(backupPath(file), JSON.stringify({ theme: 'dark' }), 'utf8');
    writeFileSync(file, '', 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'dark' });
  });

  it('falls back to the backup when the main file went missing entirely', () => {
    writeFileSync(backupPath(file), JSON.stringify({ theme: 'dark' }), 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'dark' });
  });

  it('returns null when both the file and its backup are broken', () => {
    writeFileSync(backupPath(file), 'also not json', 'utf8');
    writeFileSync(file, 'not json', 'utf8');
    expect(readJsonFile(file)).toBeNull();
  });

  it('prefers the main file over an older backup', () => {
    writeFileSync(backupPath(file), JSON.stringify({ theme: 'dark' }), 'utf8');
    writeFileSync(file, JSON.stringify({ theme: 'light' }), 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'light' });
  });
});

describe('writeJsonFile', () => {
  it('creates the folder it writes into', () => {
    const nested = join(dir, 'a', 'b', 'prefs.json');
    writeJsonFile(nested, { theme: 'dark' });
    expect(readJsonFile(nested)).toEqual({ theme: 'dark' });
  });

  it('leaves no temporary file behind', () => {
    writeJsonFile(file, { theme: 'dark' });
    expect(existsSync(tempPath(file))).toBe(false);
    expect(existsSync(tempPath(backupPath(file)))).toBe(false);
  });

  // The point of the backup: it holds what the main file holds, so recovering from it costs
  // the user nothing rather than costing them their last change.
  it('leaves the backup holding the same version as the file', () => {
    writeJsonFile(file, { theme: 'dark' });
    writeJsonFile(file, { theme: 'light' });
    expect(JSON.parse(readFileSync(backupPath(file), 'utf8'))).toEqual({ theme: 'light' });
    expect(readJsonFile(file)).toEqual({ theme: 'light' });
  });

  it('backs up the very first version too', () => {
    writeJsonFile(file, { theme: 'dark' });
    expect(JSON.parse(readFileSync(backupPath(file), 'utf8'))).toEqual({ theme: 'dark' });
  });

  it('replaces a file that was read a moment ago', () => {
    writeJsonFile(file, { theme: 'dark' });
    readFileSync(file, 'utf8');
    writeJsonFile(file, { theme: 'light' });
    expect(readJsonFile(file)).toEqual({ theme: 'light' });
  });

  it('recovers the newest settings when the file is ruined right after a write', () => {
    writeJsonFile(file, { theme: 'dark', sound: 'notify-3' });
    writeFileSync(file, '{"theme": "da', 'utf8');
    expect(readJsonFile(file)).toEqual({ theme: 'dark', sound: 'notify-3' });
  });
});

describe('writeFileAtomic', () => {
  it('writes text that is not built from an object', () => {
    const path = join(dir, 'google-oauth.json');
    writeFileAtomic(path, '{ "installed": {} }');
    expect(readFileSync(path, 'utf8')).toBe('{ "installed": {} }');
  });

  it('backs that text up as well', () => {
    const path = join(dir, 'google-oauth.json');
    writeFileAtomic(path, '{ "installed": {} }');
    expect(readFileSync(backupPath(path), 'utf8')).toBe('{ "installed": {} }');
  });
});
