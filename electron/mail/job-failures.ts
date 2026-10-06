// What a batched job lost across all its batches, gathered so one retry at the end can send
// exactly that mail again. Pure: the controller owns when, this owns how they merge.

import { failedConversations, type FailedFile, type FailedFileRef, type TargetFailures } from './copy-failures';


//===========================
// Types
//===========================

export interface JobFailures<
  T extends { email: string },
  F extends FailedFileRef,
  P extends { threadId: string },
> {
  copy: TargetFailures<T, F>[];
  pull: P[];
}


//===========================
// Constants
//===========================


//===========================
// Exported functions
//===========================

/**
 * Creates an empty job failures record
 *
 * @returns an empty JobFailures record
 */
export function emptyJobFailures<
  T extends { email: string },
  F extends FailedFileRef,
  P extends { threadId: string },
>(): JobFailures<T, F, P> {
  return { copy: [], pull: [] };
}

/**
 * Adds one batch's copy failures, per mailbox
 *
 * @param acc the accumulator
 * @param batch the copy's failures, one entry per mailbox written to
 * @returns a new record; a mailbox holds each file once
 */
export function addCopyFailures<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  batch: TargetFailures<T, F>[],
): JobFailures<T, F, P> {
  const copy = acc.copy.map((t) => ({ target: t.target, files: [...t.files] }));
  for (const entry of batch) {
    if (entry.files.length === 0) continue;
    let held = copy.find((t) => t.target.email === entry.target.email);
    if (!held) {
      held = { target: entry.target, files: [] };
      copy.push(held);
    }
    for (const lost of entry.files) {
      if (!held.files.some((h) => sameFile(h.file, lost.file))) held.files.push(lost);
    }
  }
  return { copy, pull: acc.pull };
}

/**
 * Adds conversations a batch could not fetch
 *
 * @param acc the accumulator
 * @param threads the conversations that failed to fetch
 * @returns a new record; a conversation appears once
 */
export function addPullFailures<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  threads: P[],
): JobFailures<T, F, P> {
  const pull = [...acc.pull];
  for (const t of threads) if (!pull.some((h) => h.threadId === t.threadId)) pull.push(t);
  return { copy: acc.copy, pull };
}

/**
 * Replaces one batch's pull losses with those of its latest attempt
 *
 * @param acc the accumulator
 * @param sliceThreadIds every conversation the batch asked for
 * @param failed the conversations this attempt could not fetch
 * @returns a new record; other batches' losses are kept as they were
 */
export function replaceBatchPull<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  sliceThreadIds: Iterable<string>,
  failed: P[],
): JobFailures<T, F, P> {
  const slice = new Set(sliceThreadIds);
  const kept = { copy: acc.copy, pull: acc.pull.filter((t) => !slice.has(t.threadId)) };
  return addPullFailures(kept, failed);
}

/**
 * Splits off the conversations one retry press fetches
 *
 * @param acc the accumulator
 * @param max conversations per press
 * @returns the slice to fetch now and what stays for the next press
 */
export function takePullSlice<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  max: number,
): { slice: P[]; rest: P[] } {
  return { slice: acc.pull.slice(0, max), rest: acc.pull.slice(max) };
}

/**
 * Hands mail a retry has just fetched to every mailbox of the job
 *
 * @param acc the accumulator
 * @param targets the job's mailboxes
 * @param files the newly saved mail, which landed nowhere yet
 * @returns a new record
 */
export function addFetchedToAllTargets<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
  targets: T[],
  files: F[],
): JobFailures<T, F, P> {
  const fresh: FailedFile<F>[] = files.map((file) => ({ file, error: '', maybeLanded: false }));
  return addCopyFailures(acc, targets.map((target) => ({ target, files: fresh })));
}

/**
 * Returns the files to retry, keyed by target email
 *
 * @param acc the accumulator
 * @returns email to files map
 */
export function retryFiles<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): Map<string, F[]> {
  return new Map(acc.copy.map((t) => [t.target.email, t.files.map((f) => f.file)]));
}

/**
 * Tells whether the job has no losses to retry
 *
 * @param acc the accumulator
 * @returns true if both copy and pull are empty
 */
export function isEmpty<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): boolean {
  return acc.pull.length === 0 && acc.copy.every((t) => t.files.length === 0);
}

/**
 * Counts how many conversations the job still owes, in the unit the job line speaks
 *
 * @param acc the accumulator
 * @returns distinct conversations across mailboxes and the pull
 */
export function lostConversations<T extends { email: string }, F extends FailedFileRef, P extends { threadId: string }>(
  acc: JobFailures<T, F, P>,
): number {
  return failedConversations(acc.copy, acc.pull.map((p) => p.threadId));
}


//===========================
// Helper functions
//===========================

/**
 * Tells whether two files are the same by threadId and messageId
 *
 * @param a the first file
 * @param b the second file
 * @returns true if the files are identical by identity or by threadId and messageId
 */
function sameFile(a: FailedFileRef, b: FailedFileRef): boolean {
  return a === b || (a.threadId === b.threadId && a.messageId === b.messageId);
}
