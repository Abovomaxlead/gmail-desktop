// Which pulled rows count as failed, how retried rows are put back, and where a long list is cut.

import { describe, it, expect } from 'vitest';
import { cutList, failedRowIndexes, replaceRows, SHOWN_FAILURES } from '../renderer/lib/failure-list';

describe('failedRowIndexes', () => {
  it('names a conversation that saved nothing and said why', () => {
    expect(
      failedRowIndexes([
        { threadId: 't1', subject: 'a', saved: 1 },
        { threadId: 't2', subject: 'b', saved: 0, error: 'Ophalen mislukt (HTTP 500)' },
      ]),
    ).toEqual([1]);
  });

  // A saved row can carry a warning -- the log line that did not land -- and it is not a failure.
  it('leaves a saved row with a warning alone', () => {
    expect(
      failedRowIndexes([{ threadId: 't1', subject: 'a', saved: 1, error: 'Logboek niet bijgeschreven: x' }]),
    ).toEqual([]);
  });

  // Truncation, log and empty-label rows have no conversation behind them and cannot be fetched again.
  it('never offers a row without a conversation', () => {
    expect(
      failedRowIndexes([
        { threadId: '', subject: 'Afgekapt op 2000 gesprekken', saved: 0, error: 'Het label bevat meer' },
        { threadId: '', subject: 'Niet in het logboek gezet', saved: 0, error: 'Logboek niet bijgeschreven' },
      ]),
    ).toEqual([]);
  });

  it('needs a reason before it calls a row failed', () => {
    expect(failedRowIndexes([{ threadId: 't1', subject: 'a', saved: 0 }])).toEqual([]);
  });
});

describe('replaceRows', () => {
  // Two rows of one conversation: only the one that failed is replaced.
  it('replaces by position, not by conversation', () => {
    const items = [
      { threadId: 't1', subject: 'a', saved: 1 },
      { threadId: 't1', subject: 'a', saved: 0, error: 'x' },
    ];
    expect(replaceRows(items, [1], [{ threadId: 't1', subject: 'a', saved: 1 }])).toEqual([
      { threadId: 't1', subject: 'a', saved: 1 },
      { threadId: 't1', subject: 'a', saved: 1 },
    ]);
  });

  it('leaves the original untouched', () => {
    const items = [{ threadId: 't1', subject: 'a', saved: 0, error: 'x' }];
    replaceRows(items, [0], [{ threadId: 't1', subject: 'a', saved: 1 }]);
    expect(items[0].saved).toBe(0);
  });
});

describe('cutList', () => {
  it('shows everything up to the limit', () => {
    expect(cutList([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
  });

  it('counts what it leaves out', () => {
    const list = Array.from({ length: SHOWN_FAILURES + 13 }, (_, i) => i);
    const cut = cutList(list);
    expect(cut.shown).toHaveLength(SHOWN_FAILURES);
    expect(cut.more).toBe(13);
  });
});
