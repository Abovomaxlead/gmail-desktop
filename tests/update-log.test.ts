// A packaged app has no console, so electron-updater's default logger writes every line
// about a failed update to nowhere. This is the file that replaces it. The properties that
// matter are that it cannot itself break an update, and that it cannot grow without bound.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UPDATE_LOG_MAX_BYTES, createUpdateLog } from '../electron/update-log';

let dir = '';
const at = (iso: string) => () => new Date(iso);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'update-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createUpdateLog', () => {
  it('writes a timestamped, levelled line per message', () => {
    const path = join(dir, 'update.log');
    const log = createUpdateLog(path, at('2026-08-07T10:00:00.000Z'));
    log.info('Downloading update from https://example.test/app.exe');
    log.error('sha512 checksum mismatch, expected abc, got def');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      '2026-08-07T10:00:00.000Z [info] Downloading update from https://example.test/app.exe',
    );
    expect(lines[1]).toContain('[error] sha512 checksum mismatch');
  });

  it('creates the directory it is pointed at rather than dropping the first lines', () => {
    const path = join(dir, 'nested', 'deeper', 'update.log');
    createUpdateLog(path).info('first');
    expect(existsSync(path)).toBe(true);
  });

  it('starts over instead of growing without bound', () => {
    const path = join(dir, 'update.log');
    writeFileSync(path, 'x'.repeat(UPDATE_LOG_MAX_BYTES + 1));
    createUpdateLog(path).info('after the cap');

    const text = readFileSync(path, 'utf8');
    expect(text).toContain('after the cap');
    expect(statSync(path).size).toBeLessThan(UPDATE_LOG_MAX_BYTES);
  });

  // The point being that an update must never fail because its log could not be written.
  it('swallows a path it cannot write, rather than throwing into the updater', () => {
    const path = join(dir, 'update.log');
    writeFileSync(path, '');
    // A directory where the file should be: every write against it fails.
    const blocked = createUpdateLog(join(dir, 'update.log', 'impossible.log'));
    expect(() => blocked.info('nowhere')).not.toThrow();
    expect(() => blocked.error('nowhere')).not.toThrow();
  });

  it('accepts whatever electron-updater hands it, not only strings', () => {
    const path = join(dir, 'update.log');
    const log = createUpdateLog(path);
    expect(() => log.warn(new Error('boom'))).not.toThrow();
    expect(() => log.debug({ percent: 42 })).not.toThrow();
    expect(readFileSync(path, 'utf8')).toContain('boom');
  });
});
