// Sweeping every message under one run's marker label, to convergence.
//
// This is the one primitive both exits of a cancel-safe copy need: list what still carries
// the run's own marker, act on all of it, and check again -- with `removeLabelIds` on a clean
// finish or a `stop-keep`, with `addLabelIds: ['TRASH']` on a `stop-rollback`. What the marker
// buys is that this never has to ask which message is "this run's own" the way a search on the
// RFC822 Message-ID would: membership under a label unique to this run answers that by
// construction, severed inserts included, so there is nothing here that plays the role
// copy-reconcile.ts used to.
//
// Gmail publishes no consistency guarantee for how soon a `labelIds`-filtered listing reflects
// a message this app just inserted, or a `batchModify` it just sent. So a listing is never
// trusted after one pass: this keeps re-listing and re-acting until a listing itself comes back
// empty, bounded by a retry budget with growing backoff the same shape copy-reconcile.ts used
// to give a zero-hit search. Running out of that budget while something is still listed is
// reported as `converged: false`, never as success -- the caller must leave that mailbox for
// the next resumed sweep rather than claim it clean.

import { BATCH_MODIFY_LIMIT } from '../gmail/gmail-api';
import { chunk } from './chunk';


//===========================
// Types
//===========================

export interface SweepAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/** One page of a listing under the marker label. */
export interface SweepPage {
  ids: string[];
  nextPageToken?: string;
}

export interface SweepDeps {
  /** One page of whatever currently carries the marker label. The real implementation is
   * gmail-api.ts's fetchMessageListPage; injected so this can be tested without the network. */
  list: (accessToken: string, labelId: string, pageToken?: string) => Promise<SweepPage>;
  /** Applies `action` to a chunk of ids, already split at BATCH_MODIFY_LIMIT. The real
   * implementation is gmail-api.ts's batchModifyMessages. */
  modify: (accessToken: string, ids: string[], action: SweepAction) => Promise<void>;
  /** Waits between one non-empty listing and the next attempt. Injected so a test does not
   * actually wait; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SweepResult {
  /** Every id this pass acted on, across every round, deduplicated. Independent of what any
   * local journal separately believes -- this is what the sweep itself did. */
  swept: string[];
  /** True only once a listing came back empty. False means the retry budget ran out while the
   * label still listed something; the caller must report this as not-yet-done, not as failed
   * and not as complete, and leave it for the next resumed sweep. */
  converged: boolean;
}


//===========================
// Constants
//===========================

/** Rounds of list-then-act this sweep allows itself before giving up into `converged: false`.
 * One of these is spent just to *confirm* an already-empty label, so this is "up to four
 * genuine retries", the same shape copy-reconcile.ts's zero-hit search retry used to be. */
export const MAX_SWEEP_ROUNDS = 5;

/** Growing backoff between rounds, so a listing that is merely running behind Gmail's own
 * write gets more room the longer it stays non-empty. One entry per retry, not per round --
 * the first round never waits, since there is nothing yet to have been slow. */
const SWEEP_RETRY_DELAYS_MS = [300, 600, 1200, 2400];

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));


//===========================
// Exported functions
//===========================

/**
 * Lists this run's marker to convergence, acting on whatever it finds each time
 *
 * @param accessToken
 * @param labelId this run's own marker label, never re-derived by name -- see the module
 *   comment on copy-run-types.ts for why a coincidental name collision must stay unsweepable
 * @param action removeLabelIds to strip the marker, addLabelIds: ['TRASH'] to undo a cancel
 * @param deps
 * @returns what this pass swept, and whether the label is now confirmed empty
 */
export async function sweepMarker(
  accessToken: string,
  labelId: string,
  action: SweepAction,
  deps: SweepDeps,
): Promise<SweepResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const swept = new Set<string>();

  for (let round = 1; round <= MAX_SWEEP_ROUNDS; round++) {
    const ids = await listAll(accessToken, labelId, deps.list);
    if (ids.length === 0) return { swept: [...swept], converged: true };

    await modifyInChunks(accessToken, ids, action, deps.modify);
    for (const id of ids) swept.add(id);

    if (round < MAX_SWEEP_ROUNDS) await sleep(SWEEP_RETRY_DELAYS_MS[round - 1]);
  }
  return { swept: [...swept], converged: false };
}


//===========================
// Helper functions
//===========================

/**
 * Every id currently under the label, paged to exhaustion
 *
 * A single page is not enough: a run large enough to fill more than one page would otherwise
 * have its tail quietly left unswept.
 *
 * @param accessToken
 * @param labelId
 * @param list
 * @returns every id found, across every page
 * @private
 */
async function listAll(
  accessToken: string,
  labelId: string,
  list: SweepDeps['list'],
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await list(accessToken, labelId, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

/**
 * Applies one action to a whole listing, split at the API's own ceiling
 *
 * @param accessToken
 * @param ids
 * @param action
 * @param modify
 * @private
 */
async function modifyInChunks(
  accessToken: string,
  ids: string[],
  action: SweepAction,
  modify: SweepDeps['modify'],
): Promise<void> {
  for (const part of chunk(ids, BATCH_MODIFY_LIMIT)) {
    await modify(accessToken, part, action);
  }
}
