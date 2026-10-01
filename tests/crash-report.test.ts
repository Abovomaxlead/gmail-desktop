// What an automatic crash report decides on its own: whether two crashes are the same bug,
// whether this one may go out, and what the queue does with it.

import { describe, expect, it } from 'vitest';
import {
  DEDUPE_MS,
  MAX_PER_HOUR,
  QUEUE_MAX,
  REMEMBER_MS,
  crashBody,
  crashSubject,
  enqueueCrash,
  fingerprint,
  pruneSent,
  sendDecision,
  type CrashContext,
  type CrashEvent,
  type QueuedCrash,
} from '../electron/feedback/crash-report';

const AT = Date.parse('2026-09-10T09:00:00.000Z');

const context: CrashContext = {
  version: '1.0.0',
  platform: 'win32',
  osRelease: '10.0.26200',
  mailboxCount: 3,
};

const crash = (over: Partial<CrashEvent> = {}): CrashEvent => ({
  kind: 'main-exception',
  message: 'Cannot read properties of undefined',
  stack: 'Error: boom\n    at pullMailDrop (C:\\app\\mail-drop-controller.js:1203:9)',
  at: AT,
  ...over,
});

const queued = (over: Partial<QueuedCrash> = {}): QueuedCrash => ({
  ...crash(),
  id: 'a',
  fingerprint: 'fp',
  tries: 0,
  ...over,
});

describe('fingerprint', () => {
  it('is the same for two firings of one bug', () => {
    const first = fingerprint(crash({ at: AT }));
    const second = fingerprint(
      crash({
        at: AT + 90_000,
        message: 'Cannot read properties of undefined',
        stack: 'Error: boom\n    at pullMailDrop (C:\\app\\mail-drop-controller.js:1211:14)',
      }),
    );
    expect(second).toBe(first);
  });

  it('separates two different faults in the same file', () => {
    const other = crash({ message: 'label create refused' });
    expect(fingerprint(other)).not.toBe(fingerprint(crash()));
  });

  it('separates the same message from two kinds of failure', () => {
    expect(fingerprint(crash({ kind: 'unhandled-rejection' }))).not.toBe(fingerprint(crash()));
  });

  it('reads the same stack from Windows and POSIX as one bug', () => {
    const posix = crash({
      stack: 'Error: boom\n    at pullMailDrop (/app/mail-drop-controller.js:1203:9)',
    });
    expect(fingerprint(posix)).toBe(fingerprint(crash()));
  });

  it('skips node internals, which identify nothing', () => {
    const withInternals = crash({
      stack: [
        'Error: boom',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
        '    at pullMailDrop (C:\\app\\mail-drop-controller.js:1203:9)',
      ].join('\n'),
    });
    expect(fingerprint(withInternals)).toBe(fingerprint(crash()));
  });
});

describe('sendDecision', () => {
  it('sends a fault nothing has been heard about', () => {
    expect(sendDecision([], 'fp', AT)).toBe('send');
  });

  it('stays quiet about a fault already reported inside the window', () => {
    const sent = [{ fingerprint: 'fp', at: AT - DEDUPE_MS + 1000 }];
    expect(sendDecision(sent, 'fp', AT)).toBe('duplicate');
  });

  it('reports the same fault again once the window has passed', () => {
    const sent = [{ fingerprint: 'fp', at: AT - DEDUPE_MS - 1 }];
    expect(sendDecision(sent, 'fp', AT)).toBe('send');
  });

  it('stops at the hourly ceiling however different the faults are', () => {
    const sent = Array.from({ length: MAX_PER_HOUR }, (_, i) => ({
      fingerprint: `fp${i}`,
      at: AT - i * 1000,
    }));
    expect(sendDecision(sent, 'new-one', AT)).toBe('flooding');
  });

  it('lets a new fault through once the hour has rolled off', () => {
    const sent = Array.from({ length: MAX_PER_HOUR }, (_, i) => ({
      fingerprint: `fp${i}`,
      at: AT - 60 * 60 * 1000 - i * 1000,
    }));
    expect(sendDecision(sent, 'new-one', AT)).toBe('send');
  });
});

describe('pruneSent', () => {
  it('keeps what still silences a fingerprint and drops what does not', () => {
    const kept = { fingerprint: 'keep', at: AT - REMEMBER_MS + 1000 };
    const gone = { fingerprint: 'gone', at: AT - REMEMBER_MS - 1000 };
    expect(pruneSent([gone, kept], AT)).toEqual([kept]);
  });
});

describe('enqueueCrash', () => {
  it('does not queue a fault that is already waiting', () => {
    const queue = [queued({ id: 'first', fingerprint: 'fp' })];
    expect(enqueueCrash(queue, queued({ id: 'second', fingerprint: 'fp' }))).toBe(queue);
  });

  it('drops the oldest when the queue is full', () => {
    const full = Array.from({ length: QUEUE_MAX }, (_, i) =>
      queued({ id: `q${i}`, fingerprint: `fp${i}` }),
    );
    const after = enqueueCrash(full, queued({ id: 'newest', fingerprint: 'newest' }));
    expect(after).toHaveLength(QUEUE_MAX);
    expect(after.at(-1)?.id).toBe('newest');
    expect(after.some((q) => q.id === 'q0')).toBe(false);
  });
});

describe('crashSubject', () => {
  it('names the version and the fault, so a mailbox sorts into bugs', () => {
    expect(crashSubject(crash(), context)).toBe(
      '[crash] 1.0.0 main-exception: Cannot read properties of undefined',
    );
  });

  it('falls back to the kind when there is no message at all', () => {
    expect(crashSubject(crash({ message: '' }), context)).toContain('main-exception');
  });

  it('never carries a newline into the header', () => {
    const subject = crashSubject(crash({ message: 'first line\nsecond line' }), context);
    expect(subject).not.toContain('\n');
  });
});

describe('crashBody', () => {
  it('carries the build, the signature and the stack', () => {
    const body = crashBody(crash({ where: 'app://bundle/maildrop.html' }), context);
    expect(body).toContain('version    1.0.0');
    expect(body).toContain('platform   win32 10.0.26200');
    expect(body).toContain(fingerprint(crash()));
    expect(body).toContain('at pullMailDrop');
    expect(body).toContain('app://bundle/maildrop.html');
  });

  it('says nobody typed it, so it is not answered as if somebody had', () => {
    expect(crashBody(crash(), context)).toContain('sent automatically');
  });
});
