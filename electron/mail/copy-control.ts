// Pausing and stopping a copy in place, without losing where it was.
//
// A worker that calls wait() while paused is suspended exactly where it is -- not unwound and
// remembered as an offset to restart from. That is the whole reason resume() is cheap: it
// just answers every suspended caller and lets them carry on with the same cursor, the same
// open budget slots, the same everything. Unwinding instead would mean rebuilding which items
// remain and re-deriving the thread-group state runThreadGroup keeps mid-conversation, which
// does not compose with a restart.
//
// Once stopping, there is no way back to running: a stop is the user's final word on this
// run, and a wait() called afterwards -- even one that never paused -- answers 'stop' at
// once rather than queueing, so nothing can start work after the run was told to end.
//
// wait() alone only ever stops new work from starting. What is already on the wire when
// stop() is called keeps running until it settles on its own -- unless something also severs
// it. signal() is that something: aborted the moment stop() is called, so a request already
// in flight can be cut rather than left to finish.

import type { CopyStopMode } from './copy-run-types';


//===========================
// Types
//===========================

export type CopyGateState = 'running' | 'paused' | 'stopping';

export interface CopyRunControl {
  /** Whether new work may currently start */
  state(): CopyGateState;
  /** How a stop was asked for, once one has been; null before that */
  stopMode(): CopyStopMode | null;
  /**
   * Waits for permission to start the next piece of work
   *
   * Resolves at once while running or once stopping. While paused, the caller is suspended
   * in place until resume() or stop() answers it.
   */
  wait(): Promise<'continue' | 'stop'>;
  /** No-op once paused or stopping */
  pause(): void;
  /** No-op unless currently paused */
  resume(): void;
  /** No-op once already stopping -- the first mode asked for is the one that stands */
  stop(mode: CopyStopMode): void;
  /** Aborted the instant stop() is called, whatever state the gate was in before. The same
   * object for the life of this control, so a listener attached at the start of the run
   * still fires however late the stop comes. */
  signal(): AbortSignal;
}


//===========================
// Exported functions
//===========================

/**
 * A gate one copy run's loop checks before starting each new piece of work
 *
 * @returns the gate
 */
export function createCopyRunControl(): CopyRunControl {
  let state: CopyGateState = 'running';
  let mode: CopyStopMode | null = null;
  let waiters: Array<(answer: 'continue' | 'stop') => void> = [];
  const abort = new AbortController();

  const wake = (answer: 'continue' | 'stop'): void => {
    const held = waiters;
    waiters = [];
    for (const resolve of held) resolve(answer);
  };

  return {
    state: () => state,
    stopMode: () => mode,
    signal: () => abort.signal,
    wait(): Promise<'continue' | 'stop'> {
      if (state === 'stopping') return Promise.resolve('stop');
      if (state === 'running') return Promise.resolve('continue');
      return new Promise((resolve) => waiters.push(resolve));
    },
    pause(): void {
      if (state === 'running') state = 'paused';
    },
    resume(): void {
      if (state !== 'paused') return;
      state = 'running';
      wake('continue');
    },
    stop(requested: CopyStopMode): void {
      if (state === 'stopping') return;
      state = 'stopping';
      mode = requested;
      wake('stop');
      // Cooperative gating stops new work; this is what cuts what is already running.
      abort.abort();
    },
  };
}
