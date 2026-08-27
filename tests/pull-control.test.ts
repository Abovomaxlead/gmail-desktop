// The gate that lets a pull be cancelled. Smaller than the copy's own gate on purpose: a pull
// has sent nothing to Google, so there is nothing to undo and no stop mode to choose between.
// What is proved here is that stopping is one-way, that it reaches a loop through the same
// shouldWait shape mapLimit already takes, and that it cuts a fetch that is already on the wire.

import { describe, it, expect } from 'vitest';
import { createPullControl } from '../electron/mail/pull-control';

describe('createPullControl', () => {
  it('lets work start while nothing has been cancelled', async () => {
    const control = createPullControl();
    expect(control.stopped()).toBe(false);
    await expect(control.wait()).resolves.toBe('continue');
  });

  it('refuses every piece of work after a stop', async () => {
    const control = createPullControl();
    control.stop();
    expect(control.stopped()).toBe(true);
    await expect(control.wait()).resolves.toBe('stop');
    await expect(control.wait()).resolves.toBe('stop');
  });

  // One-way, like the copy's gate: there is no resume, and a second stop is not an error --
  // Escape and the button can both arrive for the same pull.
  it('takes a second stop without complaining', () => {
    const control = createPullControl();
    control.stop();
    control.stop();
    expect(control.stopped()).toBe(true);
  });

  // The gate only keeps new work from starting. A fetch already on the wire is cut by the
  // signal, which is what keeps a cancel from waiting on the slowest conversation.
  it('aborts its signal on the stop, so a fetch in flight is severed', () => {
    const control = createPullControl();
    expect(control.signal().aborted).toBe(false);
    control.stop();
    expect(control.signal().aborted).toBe(true);
  });

  it('hands out the same signal every time, so a listener attached first still fires', () => {
    const control = createPullControl();
    const signal = control.signal();
    expect(control.signal()).toBe(signal);
    control.stop();
    expect(signal.aborted).toBe(true);
  });

  // The shape mapLimit takes (concurrency.ts: shouldWait?: () => Promise<'continue' | 'stop'>),
  // so a cancelled pull leaves its loop instead of being unwound by a thrown error.
  it('stops a mapLimit-shaped loop where it stands', async () => {
    const control = createPullControl();
    const done: number[] = [];
    for (const item of [1, 2, 3, 4, 5]) {
      if ((await control.wait()) === 'stop') break;
      done.push(item);
      if (item === 3) control.stop();
    }
    expect(done).toEqual([1, 2, 3]);
  });
});
