// The log a missing notification leaves behind. It must never cost the notification it is
// recording, so a write that cannot happen is not an error — it is a line that is not
// there.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNotifyLog, NOTIFY_LOG_MAX_BYTES, notifyLog, openNotifyLog } from '../electron/notify-log';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notify-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('createNotifyLog', () => {
  it('appends one stamped line per message', () => {
    const path = join(dir, 'notify.log');
    const log = createNotifyLog(path, () => new Date('2026-08-11T09:00:00.000Z'));
    log('[notify] raise web luca@example.nl');
    log('[toast] drew it');
    expect(readFileSync(path, 'utf8')).toBe(
      '2026-08-11T09:00:00.000Z [notify] raise web luca@example.nl\n' +
        '2026-08-11T09:00:00.000Z [toast] drew it\n',
    );
  });

  it('creates the directory it was pointed at', () => {
    const path = join(dir, 'deep', 'notify.log');
    createNotifyLog(path)('hello');
    expect(existsSync(path)).toBe(true);
  });

  it('starts over rather than grow without end', () => {
    const path = join(dir, 'notify.log');
    writeFileSync(path, 'x'.repeat(NOTIFY_LOG_MAX_BYTES + 1));
    createNotifyLog(path, () => new Date('2026-08-11T09:00:00.000Z'))('fresh');
    expect(readFileSync(path, 'utf8')).toBe('2026-08-11T09:00:00.000Z fresh\n');
  });

  it('swallows a write it cannot do', () => {
    // A directory where the file should be: the write throws, the caller must not.
    const path = join(dir, 'as-a-directory');
    require('node:fs').mkdirSync(path);
    expect(() => createNotifyLog(path)('nope')).not.toThrow();
  });
});

describe('notifyLog', () => {
  it('goes to the console even with no file open', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    notifyLog('[notify] no file yet');
    expect(spy).toHaveBeenCalledWith('[notify] no file yet');
  });

  it('writes to the file once one is opened', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const path = join(dir, 'notify.log');
    openNotifyLog(path);
    notifyLog('[notify] raise push luca@example.nl');
    expect(readFileSync(path, 'utf8')).toContain('[notify] raise push luca@example.nl');
  });
});
