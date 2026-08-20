// One pull at a time. The lock exists because a second drop arriving mid-pull resets
// lastDropSaved and bumps the serial, which loses the first drag's results -- so what is
// proved here is that the second caller is refused, that a finished pull hands the lock
// back, and that a pull which never answers cannot hold it for ever.

import { describe, it, expect } from 'vitest';
import { createDropLock, DROP_LOCK_MS } from '../electron/mail/drop-lock';

describe('createDropLock', () => {
  it('hands the lock to the first caller', () => {
    const lock = createDropLock(1000);
    expect(lock.take(0)).not.toBeNull();
  });

  it('refuses a second caller while the first holds it', () => {
    const lock = createDropLock(1000);
    lock.take(0);
    expect(lock.take(500)).toBeNull();
  });

  it('hands it out again once the holder releases', () => {
    const lock = createDropLock(1000);
    const first = lock.take(0)!;
    expect(lock.release(first)).toBe(true);
    expect(lock.take(10)).not.toBeNull();
  });

  it('lets a later caller take over a lock that has gone stale', () => {
    const lock = createDropLock(1000);
    lock.take(0);
    expect(lock.take(999)).toBeNull();
    expect(lock.take(1000)).not.toBeNull();
  });

  it('ignores a release from a pull whose lock was already taken over', () => {
    const lock = createDropLock(1000);
    const stale = lock.take(0)!;
    const fresh = lock.take(1000)!;
    // The slow pull coming back must not unlock the one that replaced it, or the second
    // pull would run with no lock and a third drop could land on top of it.
    expect(lock.release(stale)).toBe(false);
    expect(lock.take(1001)).toBeNull();
    expect(lock.release(fresh)).toBe(true);
  });

  it('reports whether a pull holds it, and counts a stale hold as free', () => {
    const lock = createDropLock(1000);
    expect(lock.held(0)).toBe(false);
    lock.take(0);
    expect(lock.held(999)).toBe(true);
    expect(lock.held(1000)).toBe(false);
  });

  it('holds long enough for a label of two hundred conversations', () => {
    expect(DROP_LOCK_MS).toBeGreaterThanOrEqual(60_000);
  });
});
