// The pause/stop gate: what is proved here is that a paused waiter is blocked in place
// rather than unwound, that resume() wakes every one of them at once, and that stopping is
// one-way -- nothing started after a stop, and no pause can walk it back.

import { describe, it, expect } from 'vitest';
import { createCopyRunControl } from '../electron/mail/copy-control';

describe('createCopyRunControl', () => {
  it('starts running, so a fresh wait resolves at once', async () => {
    const control = createCopyRunControl();
    expect(control.state()).toBe('running');
    await expect(control.wait()).resolves.toBe('continue');
  });

  it('blocks a waiter in place once paused', async () => {
    const control = createCopyRunControl();
    control.pause();
    let answered = false;
    const waiting = control.wait().then((v) => {
      answered = true;
      return v;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(answered).toBe(false);
    control.resume();
    expect(await waiting).toBe('continue');
    expect(answered).toBe(true);
  });

  it('wakes every waiter with resume, not just the first', async () => {
    const control = createCopyRunControl();
    control.pause();
    const waiters = [control.wait(), control.wait(), control.wait()];
    control.resume();
    expect(await Promise.all(waiters)).toEqual(['continue', 'continue', 'continue']);
  });

  it('leaves nothing queued after a resume, so the next wait resolves immediately', async () => {
    const control = createCopyRunControl();
    control.pause();
    control.resume();
    await expect(control.wait()).resolves.toBe('continue');
  });

  it('wakes every waiter with stop, and records which mode was asked for', async () => {
    const control = createCopyRunControl();
    control.pause();
    const waiters = [control.wait(), control.wait()];
    control.stop('rollback');
    expect(await Promise.all(waiters)).toEqual(['stop', 'stop']);
    expect(control.stopMode()).toBe('rollback');
    expect(control.state()).toBe('stopping');
  });

  it('answers stop straight away once stopping, even to a caller that never paused', async () => {
    const control = createCopyRunControl();
    control.stop('keep');
    await expect(control.wait()).resolves.toBe('stop');
  });

  it('ignores a pause once stopping, so a late pause cannot walk the stop back', () => {
    const control = createCopyRunControl();
    control.stop('keep');
    control.pause();
    expect(control.state()).toBe('stopping');
  });

  it('ignores a resume that was not preceded by a pause', () => {
    const control = createCopyRunControl();
    control.resume();
    expect(control.state()).toBe('running');
  });

  it('keeps the first stop mode once a run is already stopping', async () => {
    const control = createCopyRunControl();
    control.stop('keep');
    control.stop('rollback');
    expect(control.stopMode()).toBe('keep');
  });

  it('treats a second pause as a no-op rather than losing the paused state', () => {
    const control = createCopyRunControl();
    control.pause();
    control.pause();
    expect(control.state()).toBe('paused');
  });

  // Pause and stop can arrive back to back before any worker has even called wait() once --
  // the gate must still end up stopping, with nothing left dangling from the pause.
  it('goes straight to stopping when stop follows pause before any worker reached the gate', async () => {
    const control = createCopyRunControl();
    control.pause();
    control.stop('rollback');
    expect(control.state()).toBe('stopping');
    expect(control.stopMode()).toBe('rollback');
    await expect(control.wait()).resolves.toBe('stop');
  });

  it('ignores a resume while stopping, the same as it ignores one while running', () => {
    const control = createCopyRunControl();
    control.stop('keep');
    control.resume();
    expect(control.state()).toBe('stopping');
    expect(control.stopMode()).toBe('keep');
  });

  it('leaves a second stop with the same mode exactly as harmless as the first', async () => {
    const control = createCopyRunControl();
    control.pause();
    const waiters = [control.wait(), control.wait()];
    control.stop('keep');
    control.stop('keep');
    expect(await Promise.all(waiters)).toEqual(['stop', 'stop']);
    expect(control.state()).toBe('stopping');
    expect(control.stopMode()).toBe('keep');
  });

  // Cooperative gating alone only stops new work starting; this is what actually severs an
  // upload that has been running since before the stop was asked for.
  describe('signal', () => {
    it('is not aborted before stop is called', () => {
      const control = createCopyRunControl();
      expect(control.signal().aborted).toBe(false);
    });

    it('is not aborted merely by pausing', () => {
      const control = createCopyRunControl();
      control.pause();
      expect(control.signal().aborted).toBe(false);
    });

    it('aborts the moment stop is called', () => {
      const control = createCopyRunControl();
      control.stop('rollback');
      expect(control.signal().aborted).toBe(true);
    });

    it('is the same signal object across calls, so a listener attached early still fires', () => {
      const control = createCopyRunControl();
      const signal = control.signal();
      let fired = false;
      signal.addEventListener('abort', () => {
        fired = true;
      });
      control.stop('keep');
      expect(control.signal()).toBe(signal);
      expect(fired).toBe(true);
    });

    it('abort follows stop even when stop was preceded by a pause', () => {
      const control = createCopyRunControl();
      control.pause();
      control.stop('keep');
      expect(control.signal().aborted).toBe(true);
    });
  });
});
