// sweepRunMarkers: the strip-vs-trash wiring around one run's own sweepMarker calls, and the
// property the whole marker-label mechanism exists for -- what gets acted on is whatever the
// listing itself reports, never a locally kept record of what the journal happened to write.

import { describe, it, expect } from 'vitest';
import {
  sweepRunMarkers,
  deleteCreatedLabels,
  type SweepRunDeps,
} from '../electron/mail/copy-marker-run-sweep';
import type { MarkerLabel } from '../electron/mail/copy-run-types';

const noopDeleteLabel = async (): Promise<void> => {};

/** A `list` that answers with `ids` once, then empty forever after -- the shape almost every
 * test below wants (one round to convergence), without repeating sweepMarker's own round and
 * paging logic, which its own test file already covers. */
const onceThenEmpty = (ids: string[]): SweepRunDeps['list'] => {
  let acted = false;
  return async () => {
    if (acted) return { ids: [] };
    acted = true;
    return { ids };
  };
};

describe('sweepRunMarkers', () => {
  it('strips the marker on a clean finish -- removeLabelIds, not addLabelIds', async () => {
    const modified: Array<{ ids: string[]; action: unknown }> = [];
    const deps: SweepRunDeps = {
      token: async () => ({ ok: true, token: 'tok-a' }),
      list: onceThenEmpty(['m1']),
      modify: async (_token, ids, action) => {
        modified.push({ ids, action });
      },
      deleteLabel: noopDeleteLabel,
    };
    const markers: MarkerLabel[] = [{ email: 'a@x.nl', markerLabelId: 'L1' }];

    const outcome = await sweepRunMarkers('run-1', markers, 'strip', deps);

    expect(modified).toEqual([{ ids: ['m1'], action: { removeLabelIds: ['L1'] } }]);
    expect(outcome.mailboxes[0]).toMatchObject({ email: 'a@x.nl', swept: ['m1'], converged: true });
    expect(outcome.complete).toBe(true);
  });

  it('deletes the now-empty label once the strip has converged', async () => {
    const deletedLabels: string[] = [];
    const deps: SweepRunDeps = {
      token: async () => ({ ok: true, token: 'tok-a' }),
      list: onceThenEmpty(['m1']),
      modify: async () => {},
      deleteLabel: async (_token, labelId) => void deletedLabels.push(labelId),
    };

    await sweepRunMarkers('run-1', [{ email: 'a@x.nl', markerLabelId: 'L1' }], 'strip', deps);

    expect(deletedLabels).toEqual(['L1']);
  });

  it('never deletes the label while the sweep has not converged', async () => {
    const deletedLabels: string[] = [];
    const deps: SweepRunDeps = {
      token: async () => ({ ok: true, token: 'tok-a' }),
      list: async () => ({ ids: ['stuck'] }), // never runs dry
      modify: async () => {},
      deleteLabel: async (_token, labelId) => void deletedLabels.push(labelId),
      sleep: async () => {},
    };

    const outcome = await sweepRunMarkers(
      'run-1',
      [{ email: 'a@x.nl', markerLabelId: 'L1' }],
      'strip',
      deps,
    );

    expect(deletedLabels).toEqual([]);
    expect(outcome.mailboxes[0].converged).toBe(false);
  });

  // The point of sweeping by label rather than by journal: this id is not a gmailId any
  // journal entry ever recorded -- it exists here purely because the listing reports it under
  // the marker, exactly the shape a severed insert takes.
  it('trashes everything the listing reports, including a message no journal ever recorded', async () => {
    const modified: Array<{ ids: string[]; action: unknown }> = [];
    const deps: SweepRunDeps = {
      token: async () => ({ ok: true, token: 'tok-a' }),
      list: onceThenEmpty(['never-in-any-journal']),
      modify: async (_token, ids, action) => {
        modified.push({ ids, action });
      },
      deleteLabel: noopDeleteLabel,
    };

    const outcome = await sweepRunMarkers(
      'run-1',
      [{ email: 'a@x.nl', markerLabelId: 'L1' }],
      'trash',
      deps,
    );

    expect(modified).toEqual([
      { ids: ['never-in-any-journal'], action: { addLabelIds: ['TRASH'] } },
    ]);
    expect(outcome.mailboxes[0].swept).toEqual(['never-in-any-journal']);
    expect(outcome.complete).toBe(true);
  });

  it('reports a mailbox whose token cannot be had as refused, without touching the others', async () => {
    const deps: SweepRunDeps = {
      token: async (email: string) =>
        email === 'gone@x.nl' ? { ok: false, error: 'geen token' } : { ok: true, token: `${email}-tok` },
      list: onceThenEmpty(['m1']),
      modify: async () => {},
      deleteLabel: noopDeleteLabel,
    };

    const outcome = await sweepRunMarkers(
      'run-1',
      [
        { email: 'gone@x.nl', markerLabelId: 'L1' },
        { email: 'ok@x.nl', markerLabelId: 'L2' },
      ],
      'trash',
      deps,
    );

    const gone = outcome.mailboxes.find((m) => m.email === 'gone@x.nl')!;
    expect(gone.refused).toBe('auth');
    expect(gone.converged).toBe(false);
    const ok = outcome.mailboxes.find((m) => m.email === 'ok@x.nl')!;
    expect(ok.converged).toBe(true);
    expect(outcome.complete).toBe(false);
  });

  it('reports progress once per mailbox as it settles', async () => {
    const seen: Array<[number, number]> = [];
    const deps: SweepRunDeps = {
      token: async () => ({ ok: true, token: 'tok' }),
      list: onceThenEmpty([]),
      modify: async () => {},
      deleteLabel: noopDeleteLabel,
    };
    await sweepRunMarkers(
      'run-1',
      [
        { email: 'a@x.nl', markerLabelId: 'L1' },
        { email: 'b@x.nl', markerLabelId: 'L2' },
      ],
      'strip',
      deps,
      (done: number, total: number) => seen.push([done, total]),
    );
    expect(seen.sort()).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('deleteCreatedLabels', () => {
  const deps = (deleted: string[], fail?: string) => ({
    token: async () => ({ ok: true as const, token: 't' }),
    list: async () => ({ ids: [], done: true }),
    modify: async () => {},
    deleteLabel: async (_token: string, labelId: string) => {
      if (labelId === fail) throw new Error('nee');
      deleted.push(labelId);
    },
  });

  it('deletes every label the run made', async () => {
    const deleted: string[] = [];
    const left = await deleteCreatedLabels(
      [
        { email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' },
        { email: 'a@b.nl', labelId: 'Label_2', name: 'Archief/Klanten/Acme' },
      ],
      deps(deleted) as any,
    );
    expect(deleted).toEqual(['Label_2', 'Label_1']);
    expect(left).toEqual([]);
  });

  it('names what it could not delete rather than failing the rollback', async () => {
    const deleted: string[] = [];
    const left = await deleteCreatedLabels(
      [{ email: 'a@b.nl', labelId: 'Label_1', name: 'Archief/Klanten' }],
      deps(deleted, 'Label_1') as any,
    );
    expect(left).toEqual(['Archief/Klanten']);
  });

  it('does nothing when the run created nothing', async () => {
    const deleted: string[] = [];
    expect(await deleteCreatedLabels([], deps(deleted) as any)).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
