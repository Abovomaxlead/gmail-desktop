// A drop that saved nothing has nothing to copy, so the modal must not offer labels — the
// case that made this necessary is a mail dragged out of a delegated mailbox, which comes
// back as HTTP 403.

import { describe, it, expect } from 'vitest';
import { dropFailures, NOTHING_SAVED } from '../renderer/app/drop-outcome';

describe('dropFailures', () => {
  it('says nothing while at least one mail was saved', () => {
    expect(dropFailures([{ saved: 1 }])).toEqual([]);
  });

  it('says nothing before anything was dragged', () => {
    expect(dropFailures([])).toEqual([]);
  });

  it('reports the refusal when the only conversation saved nothing', () => {
    expect(dropFailures([{ saved: 0, error: 'Ophalen mislukt (HTTP 403)' }])).toEqual([
      'Ophalen mislukt (HTTP 403)',
    ]);
  });

  // A partial drag still has something to copy, and the picker is how you copy it.
  it('keeps quiet when one of several failed', () => {
    expect(
      dropFailures([{ saved: 0, error: 'Ophalen mislukt (HTTP 403)' }, { saved: 1 }]),
    ).toEqual([]);
  });

  // A label drag reports per conversation, and forty rows that failed on the same refusal
  // are one fact, not forty.
  it('reports one refusal once, however many rows carry it', () => {
    expect(
      dropFailures([
        { saved: 0, error: 'Ophalen mislukt (HTTP 403)' },
        { saved: 0, error: 'Ophalen mislukt (HTTP 403)' },
        { saved: 0, error: 'Kan niet schrijven naar X' },
      ]),
    ).toEqual(['Ophalen mislukt (HTTP 403)', 'Kan niet schrijven naar X']);
  });

  it('still reports a failure when nothing said why', () => {
    expect(dropFailures([{ saved: 0 }])).toEqual([NOTHING_SAVED]);
    expect(dropFailures([{ saved: 0, error: '  ' }])).toEqual([NOTHING_SAVED]);
  });
});
