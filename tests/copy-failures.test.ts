// What a copy remembers of its failures, and when a retry of them may run.

import { describe, it, expect } from 'vitest';
import {
  copyFailuresOf,
  failedConversations,
  failedFiles,
  failureLines,
  retryRefusal,
  wholeTargetFailed,
} from '../electron/mail/copy-failures';
import { GmailHttpError, GmailTimeoutError, insertMayHaveLanded } from '../electron/gmail/gmail-api';

const f = (threadId: string, subject = threadId) => ({ threadId, subject, messageId: `<${threadId}@x>` });

describe('failedFiles', () => {
  it('keeps only the failed files, with their own error', () => {
    expect(
      failedFiles(
        [f('t1'), f('t2'), f('t3')],
        [{ kind: 'copied' }, { kind: 'failed', error: 'quota', maybeLanded: false }, { kind: 'skipped' }],
      ),
    ).toEqual([{ file: f('t2'), error: 'quota', maybeLanded: false }]);
  });

  // A stopped file and a file the gate never started are not failures: a retry is not a resume.
  it('never counts a stopped or missing outcome', () => {
    expect(failedFiles([f('t1'), f('t2')], [{ kind: 'stopped' }, undefined])).toEqual([]);
  });

  it('carries the maybe-landed flag', () => {
    expect(failedFiles([f('t1')], [{ kind: 'failed', error: 'time-out', maybeLanded: true }])[0].maybeLanded).toBe(true);
  });

  it('names a failure that gave no reason', () => {
    expect(failedFiles([f('t1')], [{ kind: 'failed' }])[0].error).toBe('onbekende fout');
  });
});

describe('wholeTargetFailed', () => {
  it('puts every file of a mailbox that could not be opened in the retry', () => {
    expect(wholeTargetFailed([f('t1'), f('t2')], 'Geen toegang')).toEqual([
      { file: f('t1'), error: 'Geen toegang', maybeLanded: false },
      { file: f('t2'), error: 'Geen toegang', maybeLanded: false },
    ]);
  });
});

describe('failureLines', () => {
  it('is what the panel draws per mail', () => {
    expect(failureLines([{ file: f('t1', 'Offerte'), error: 'quota', maybeLanded: false }])).toEqual([
      { subject: 'Offerte', error: 'quota', maybeLanded: false },
    ]);
  });
});

describe('copyFailuresOf', () => {
  it('drops mailboxes where everything landed', () => {
    const a = { target: { email: 'a@x.nl' }, files: [] };
    const b = { target: { email: 'b@x.nl' }, files: [{ file: f('t1'), error: 'e', maybeLanded: false }] };
    expect(copyFailuresOf([a, b])).toEqual([b]);
  });

  // The review-focus case: a retry where everything lands must not leave an offer behind.
  it('answers null when nothing failed', () => {
    expect(copyFailuresOf([{ target: { email: 'a@x.nl' }, files: [] }])).toBeNull();
  });
});

describe('failedConversations', () => {
  it('counts a conversation once however many mailboxes it failed in', () => {
    const one = { file: f('t1'), error: 'e', maybeLanded: false };
    expect(
      failedConversations(
        [
          { target: { email: 'a@x.nl' }, files: [one] },
          { target: { email: 'b@x.nl' }, files: [one] },
        ],
        [],
      ),
    ).toBe(1);
  });

  it('adds conversations that were never fetched', () => {
    expect(
      failedConversations([{ target: { email: 'a@x.nl' }, files: [{ file: f('t1'), error: 'e', maybeLanded: false }] }], [
        't1',
        't2',
      ]),
    ).toBe(2);
  });
});

describe('retryRefusal', () => {
  const ok = {
    wanted: 'r1',
    held: { retryId: 'r1', serial: 4 },
    serial: 4,
    jobDriving: false,
    jobActive: false,
    pulling: false,
    copying: false,
  };

  it('lets a current retry run', () => {
    expect(retryRefusal(ok)).toBeNull();
  });

  it('refuses when there is nothing to retry', () => {
    expect(retryRefusal({ ...ok, held: null })).not.toBeNull();
  });

  it('refuses a stale id', () => {
    expect(retryRefusal({ ...ok, wanted: 'r0' })).not.toBeNull();
  });

  it('refuses after a new drag', () => {
    expect(retryRefusal({ ...ok, serial: 5 })).not.toBeNull();
  });

  it('refuses while a job drives or is held', () => {
    expect(retryRefusal({ ...ok, jobDriving: true })).not.toBeNull();
    expect(retryRefusal({ ...ok, jobActive: true })).not.toBeNull();
  });

  // The double-click case: the first retry is running, the second must not start beside it.
  it('refuses while a pull or a copy runs', () => {
    expect(retryRefusal({ ...ok, pulling: true })).not.toBeNull();
    expect(retryRefusal({ ...ok, copying: true })).not.toBeNull();
  });
});

describe('insertMayHaveLanded', () => {
  it('says yes for a timeout and a dropped connection', () => {
    expect(insertMayHaveLanded(new GmailTimeoutError('geen antwoord van Google (time-out)'))).toBe(true);
    expect(insertMayHaveLanded(new Error('net::ERR_CONNECTION_RESET'))).toBe(true);
  });

  it('says no for an answer Gmail actually gave', () => {
    expect(insertMayHaveLanded(new GmailHttpError('Quota exceeded', 429, null))).toBe(false);
    expect(insertMayHaveLanded(new Error('Verbinding verlopen'))).toBe(false);
  });
});
