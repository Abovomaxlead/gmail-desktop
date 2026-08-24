// Sweeping every message under one run's marker label to convergence.

import { describe, it, expect } from 'vitest';
import { sweepMarker, type SweepDeps, type SweepPage } from '../electron/mail/copy-marker-sweep';
import { BATCH_MODIFY_LIMIT } from '../electron/gmail/gmail-api';

const noSleep = async () => {};

/** A `list` that answers from a fixed script, one page-or-round at a time, so a test can
 * describe exactly what Gmail is imagined to say without a network. */
const scripted = (pages: SweepPage[][]) => {
  let round = -1;
  return async (_token: string, _labelId: string, pageToken?: string): Promise<SweepPage> => {
    if (!pageToken) round += 1;
    const roundPages = pages[round] ?? [{ ids: [] }];
    const at = pageToken ? Number(pageToken) : 0;
    return roundPages[at];
  };
};

describe('sweepMarker', () => {
  it('converges at once when the label already has nothing under it', async () => {
    let modifyCalls = 0;
    const deps: SweepDeps = {
      list: async () => ({ ids: [] }),
      modify: async () => {
        modifyCalls += 1;
      },
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { removeLabelIds: ['Label_1'] }, deps);

    expect(result).toEqual({ swept: [], converged: true });
    expect(modifyCalls).toBe(0);
  });

  it('acts on a listing and confirms convergence once the next listing is empty', async () => {
    const modified: string[][] = [];
    const deps: SweepDeps = {
      list: scripted([[{ ids: ['a', 'b'] }], [{ ids: [] }]]),
      modify: async (_token, ids) => {
        modified.push(ids);
      },
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { addLabelIds: ['TRASH'] }, deps);

    expect(modified).toEqual([['a', 'b']]);
    expect(result).toEqual({ swept: ['a', 'b'], converged: true });
  });

  it('sweeps again when a listing after a modify still finds something', async () => {
    const modified: string[][] = [];
    const deps: SweepDeps = {
      // Round 1 finds a and b; round 2 still finds b (the modify has not shown up in the
      // listing yet, or genuinely did not apply); round 3 finds nothing.
      list: scripted([[{ ids: ['a', 'b'] }], [{ ids: ['b'] }], [{ ids: [] }]]),
      modify: async (_token, ids) => {
        modified.push(ids);
      },
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { addLabelIds: ['TRASH'] }, deps);

    expect(modified).toEqual([['a', 'b'], ['b']]);
    expect(result.converged).toBe(true);
    // Deduplicated: 'b' was modified twice but is one message.
    expect(result.swept.sort()).toEqual(['a', 'b']);
  });

  it('pages through more than one page in a single round before modifying', async () => {
    const modified: string[][] = [];
    const deps: SweepDeps = {
      list: scripted([
        [{ ids: ['a'], nextPageToken: '1' }, { ids: ['b'] }],
        [{ ids: [] }],
      ]),
      modify: async (_token, ids) => {
        modified.push(ids);
      },
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { removeLabelIds: ['Label_1'] }, deps);

    // Both pages of round one are collected before a single modify call is made for them.
    expect(modified).toEqual([['a', 'b']]);
    expect(result).toEqual({ swept: ['a', 'b'], converged: true });
  });

  it('chunks a modify at the API ceiling of 1000 ids', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `m${i}`);
    const modified: string[][] = [];
    const deps: SweepDeps = {
      list: scripted([[{ ids }], [{ ids: [] }]]),
      modify: async (_token, chunk) => {
        modified.push(chunk);
      },
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { removeLabelIds: ['Label_1'] }, deps);

    expect(modified).toHaveLength(2);
    expect(modified[0]).toHaveLength(BATCH_MODIFY_LIMIT);
    expect(modified[1]).toHaveLength(500);
    expect(result.swept).toHaveLength(1500);
    expect(result.converged).toBe(true);
  });

  it('gives up into "not converged" once the retry budget runs out, never claiming success', async () => {
    const deps: SweepDeps = {
      // Never runs dry: every round finds the same message again.
      list: async () => ({ ids: ['stuck'] }),
      modify: async () => {},
      sleep: noSleep,
    };

    const result = await sweepMarker('token', 'Label_1', { addLabelIds: ['TRASH'] }, deps);

    expect(result.converged).toBe(false);
    expect(result.swept).toEqual(['stuck']);
  });

  it('resumes idempotently: an already-swept label reports success without acting', async () => {
    // Exactly the shape a resumed orphan sweep sees: nothing left, because either an
    // earlier attempt already finished the job or there was never anything to do.
    let modifyCalls = 0;
    const deps: SweepDeps = {
      list: async () => ({ ids: [] }),
      modify: async () => {
        modifyCalls += 1;
      },
      sleep: noSleep,
    };

    const first = await sweepMarker('token', 'Label_1', { removeLabelIds: ['Label_1'] }, deps);
    const second = await sweepMarker('token', 'Label_1', { removeLabelIds: ['Label_1'] }, deps);

    expect(first).toEqual({ swept: [], converged: true });
    expect(second).toEqual({ swept: [], converged: true });
    expect(modifyCalls).toBe(0);
  });
});
