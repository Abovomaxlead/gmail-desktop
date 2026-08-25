// Sweeping every mailbox a run touched: strip on a clean finish, trash on a rollback.
//
// Split off from mail-drop-controller.ts, which is where every one of its call sites still
// lives, for the same reason copy-rollback.ts and copy-reconcile.ts used to be split off:
// mail-drop-controller.ts pulls in Electron's `app` at module load (via core/paths.ts) and so
// can never be imported directly by a test. Every dependency here is therefore taken in,
// never imported for real -- the real Gmail calls are wired at the one call site in
// mail-drop-controller.ts, which already needs them regardless.
//
// Deliberately takes `markers`, never journal entries: what gets acted on is whatever the
// listing itself reports under the marker, which is exactly what makes a severed insert the
// local journal never recorded still get trashed on a rollback -- see copy-run-types.ts.

import { GmailHttpError } from '../gmail/gmail-api';
import { sweepMarker, type SweepAction, type SweepDeps } from './copy-marker-sweep';
import type {
  CopyRunId,
  CreatedLabel,
  MarkerLabel,
  RollbackMailboxOutcome,
  RollbackOutcome,
} from './copy-run-types';


//===========================
// Types
//===========================

/** What sweepRunMarkers needs to reach a mailbox, injected so the strip-vs-trash wiring can be
 * tested without the network -- the same shape RollbackDeps and ReconcileDeps gave the
 * mechanisms this replaces. */
export interface SweepRunDeps {
  token: (email: string) => Promise<{ ok: true; token: string } | { ok: false; error: string }>;
  list: SweepDeps['list'];
  modify: SweepDeps['modify'];
  deleteLabel: (accessToken: string, labelId: string) => Promise<void>;
  /** Passed straight through to sweepMarker's own retry backoff; a test can shrink it, real
   * callers leave it to sweepMarker's real timer. */
  sleep?: SweepDeps['sleep'];
}


//===========================
// Exported functions
//===========================

/**
 * Sweeps every mailbox's own marker for one run, in parallel
 *
 * The one primitive both a clean finish and a rollback share: list this run's marker to
 * convergence and act on whatever it finds -- 'strip' removes it, 'trash' undoes a cancel by
 * adding TRASH to whatever still carries it. A mailbox that converges has its now-empty label
 * deleted as a courtesy; one that does not is left exactly as it is, for the resumed sweep at
 * the next start (resumeOrphanedCopyRuns) to finish -- nothing here is retried past its own
 * bounded budget, since that budget is what sweepMarker already spends.
 *
 * @param runId
 * @param markers this run's own marker per mailbox, from its journal header
 * @param mode 'strip' for a clean finish or a stop-keep, 'trash' for a stop-rollback
 * @param deps
 * @param onProgress called once per mailbox as it settles, so a rollback dialog can show this
 *   running
 * @returns what became of each mailbox, and whether every one of them converged cleanly
 */
export async function sweepRunMarkers(
  runId: CopyRunId,
  markers: MarkerLabel[],
  mode: 'strip' | 'trash',
  deps: SweepRunDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<RollbackOutcome> {
  let done = 0;
  const mailboxes = await Promise.all(
    markers.map(async ({ email, markerLabelId }): Promise<RollbackMailboxOutcome> => {
      const got = await deps.token(email);
      if (!got.ok) {
        onProgress?.(++done, markers.length);
        return { email, swept: [], converged: false, refused: 'auth' as const, reason: got.error };
      }
      const action: SweepAction =
        mode === 'strip' ? { removeLabelIds: [markerLabelId] } : { addLabelIds: ['TRASH'] };
      const sweepDeps: SweepDeps = { list: deps.list, modify: deps.modify, sleep: deps.sleep };
      try {
        const result = await sweepMarker(got.token, markerLabelId, action, sweepDeps);
        // Best-effort cleanup of the label object itself, only once nothing is left under it:
        // costs the user nothing to leave behind, so a failure here is not worth reporting.
        if (result.converged) await deps.deleteLabel(got.token, markerLabelId).catch(() => {});
        onProgress?.(++done, markers.length);
        return { email, swept: result.swept, converged: result.converged };
      } catch (e) {
        const status = e instanceof GmailHttpError ? e.status : undefined;
        const refused =
          status === 403 ? ('permission' as const) : status === 401 ? ('auth' as const) : undefined;
        onProgress?.(++done, markers.length);
        return {
          email,
          swept: [],
          converged: false,
          ...(refused ? { refused } : {}),
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  return { runId, mailboxes, complete: mailboxes.every((m) => m.converged && !m.refused) };
}

/**
 * Deletes the labels one run created, once its mail has been trashed
 *
 * Only ever the labels the run made itself -- a reused label is not in this list at all. A
 * label that has since been used by hand goes too: the user asked for the run to be undone,
 * and leaving half of it behind is the worse answer. Children before parents, so Gmail is
 * never left showing a parent whose child outlived it.
 *
 * @param created from the run's journal
 * @param deps
 * @returns the names it could not delete, for the outcome to report
 */
export async function deleteCreatedLabels(
  created: CreatedLabel[],
  deps: SweepRunDeps,
): Promise<string[]> {
  const deepestFirst = [...created].sort(
    (a, b) => b.name.split('/').length - a.name.split('/').length,
  );
  const failed: string[] = [];
  const tokens = new Map<string, string>();
  // Sequential on purpose: a parent must not be deleted while a child of it is still in
  // flight, which is the one ordering a parallel pass cannot promise.
  for (const label of deepestFirst) {
    let token = tokens.get(label.email);
    if (!token) {
      const got = await deps.token(label.email);
      if (!got.ok) {
        failed.push(label.name);
        continue;
      }
      token = got.token;
      tokens.set(label.email, token);
    }
    try {
      await deps.deleteLabel(token, label.labelId);
    } catch {
      failed.push(label.name);
    }
  }
  return failed;
}
