// The plan behind a label too big to copy in one run: which conversations, cut into which
// batches, copied with which choices, and how far it got.
//
// Append-only, one line per transition, for the reason copy-journal.ts gives for itself: a job
// that is killed loses whatever it has not written yet, so the moment that matters is the
// transition and not the end of the run. And the absence of a closing line is the only thing
// that tells a crashed job from a finished one, which is what the resume offer reads.
//
// This never replaces the journal and never duplicates it. A journal answers for one batch's
// inserts and owns the marker a rollback sweeps by; this answers for which batches there are.
// The link between them is the runId a batch's copy minted, recorded here the moment it is
// known.
//
// The conversation list is written once, at plan time, one line per batch. The batches are
// slices of a list that was true at one instant: a mail arriving in the label halfway through
// must not shift the boundaries underneath the job, and a resumed job has to ask for the same
// ids the original one planned. One line per batch rather than one line for all of them keeps a
// ten-thousand-thread plan off a single megabyte-long line.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CopyRunId } from './copy-run-types';
import type { TreeThread } from './label-drop';
import type { CopyTarget } from './mail-copy';


//===========================
// Types
//===========================

/** Where one batch has got to. 'pulled' means its mail is on disk and its preview was drawn;
 * 'copied' means its copy answered. 'failed' stops the job rather than moving to the next
 * batch -- an unattended job that keeps trying the next two thousand into a mailbox that just
 * locked us out is worse than one that waits. */
export type JobBatchState = 'pending' | 'pulled' | 'copied' | 'failed';

/** How a job was closed. The same vocabulary the journal's own outcomes use, one level up. */
export type JobOutcome = 'completed' | 'kept' | 'rolled-back' | 'rolled-back-partial';

export interface JobBatch {
  index: number;
  state: JobBatchState;
  /** The slice this batch was planned with, written at plan time and never recomputed */
  threads: TreeThread[];
  /** The copy run that carried this batch. The one key a rollback of this batch works from. */
  runId?: CopyRunId;
  copied?: number;
  skipped?: number;
  error?: string;
}

/** What batch one was copied with, and what every batch after it is copied with. Written once
 * the user has answered; never read to decide anything about duplicates, only to re-ask
 * Gmail the same question with the same policy. */
export interface JobChoices {
  targets: CopyTarget[];
  mode: 'new' | 'all';
}

export interface LabelJob {
  jobId: string;
  startedAt: number;
  /** The mailbox the label was dragged out of */
  account: string;
  label: string;
  /** Every label of the dragged tree, parents first, as the collection resolved it */
  members: string[];
  batchSize: number;
  /** Conversations across the whole job, which is the sum of the batches' slices */
  total: number;
  choices: JobChoices | null;
  batches: JobBatch[];
  outcome: JobOutcome | null;
}

interface JobHeaderLine {
  type: 'header';
  jobId: string;
  startedAt: number;
  account: string;
  label: string;
  members: string[];
  batchSize: number;
  total: number;
}

interface JobBatchLine {
  type: 'batch';
  index: number;
  threads: TreeThread[];
}

interface JobChoicesLine {
  type: 'choices';
  choices: JobChoices;
}

interface JobStateLine {
  type: 'state';
  index: number;
  state: JobBatchState;
  runId?: CopyRunId;
  copied?: number;
  skipped?: number;
  error?: string;
}

interface JobDoneLine {
  type: 'done';
  outcome: JobOutcome;
}

type JobLine = JobHeaderLine | JobBatchLine | JobChoicesLine | JobStateLine | JobDoneLine;


//===========================
// Constants
//===========================

/** How many conversations one batch holds.
 *
 * Not a quota figure -- pacing is what keeps a copy inside its allowance, and five batches of
 * two thousand spend per minute exactly what one run of ten thousand spends. This is how much
 * work a stop or a crash may cost, and how many rows a preview has to draw. Two thousand is the
 * number the mailbox owner settled on after a run of 2,574 failed one short of the end. */
export const JOB_BATCH_THREADS = 2000;

const SUFFIX = '.job.jsonl';


//===========================
// Exported functions
//===========================

/**
 * Cuts a planned conversation list into the batches it will be pulled in
 *
 * @param threads in the order the collection produced them, already deduplicated across the
 *   tree's labels
 * @param batchSize
 * @returns one slice per batch, the last one short rather than padded, and nothing at all for
 *   an empty list
 */
export function sliceIntoBatches(threads: TreeThread[], batchSize: number): TreeThread[][] {
  const out: TreeThread[][] = [];
  for (let at = 0; at < threads.length; at += batchSize) {
    out.push(threads.slice(at, at + batchSize));
  }
  return out;
}

/**
 * What every batch after the first is copied with, given what the first one resolved to
 *
 * A named function rather than a ternary at the call site, because it is the one place a
 * permission is inherited. 'all' means the user was shown duplicates and said to copy them
 * anyway. Anything else -- including batch one never raising the question because it had no
 * duplicates -- inherits 'new', which asks Gmail again per batch and skips what is already
 * there. Inheriting 'all' from silence would grant permission nobody gave.
 *
 * @param confirmed what the user answered, or null when they were never asked
 * @returns the mode the remaining batches run with
 */
export function inheritedMode(confirmed: 'new' | 'all' | null): 'new' | 'all' {
  return confirmed === 'all' ? 'all' : 'new';
}

/**
 * Where one job's plan lives
 *
 * @param root the drop folder
 * @param jobId
 */
export function jobPath(root: string, jobId: string): string {
  return join(root, `${jobId}${SUFFIX}`);
}

/**
 * Opens a job's plan with its header and one line per batch
 *
 * @param root the drop folder
 * @param header everything decided before the first batch is pulled
 * @param batches the slices, from sliceIntoBatches
 */
export function startLabelJob(
  root: string,
  header: Omit<LabelJob, 'choices' | 'batches' | 'outcome'>,
  batches: TreeThread[][],
): void {
  writeLine(root, header.jobId, { type: 'header', ...header });
  for (const [index, threads] of batches.entries()) {
    writeLine(root, header.jobId, { type: 'batch', index, threads });
  }
}

/**
 * Records the targets and the duplicate policy batch one was copied with
 *
 * @param root the drop folder
 * @param jobId
 * @param choices
 */
export function recordJobChoices(root: string, jobId: string, choices: JobChoices): void {
  writeLine(root, jobId, { type: 'choices', choices });
}

/**
 * Records one batch reaching a new state, the moment it does
 *
 * @param root the drop folder
 * @param jobId
 * @param at the batch, its new state, and whatever became known with it
 */
export function recordJobBatchState(
  root: string,
  jobId: string,
  at: Omit<JobStateLine, 'type'>,
): void {
  writeLine(root, jobId, { type: 'state', ...at });
}

/**
 * Closes a job's plan with what became of it
 *
 * Left to throw rather than swallowing its own failure, the same as finishCopyJournal: a job
 * reported as finished whose closing line never reached the disk would be offered for
 * resumption at the next start, which is the one thing this line exists to prevent.
 *
 * @param root the drop folder
 * @param jobId
 * @param outcome
 */
export function finishLabelJob(root: string, jobId: string, outcome: JobOutcome): void {
  writeLine(root, jobId, { type: 'done', outcome });
}

/**
 * Reads one job's plan back
 *
 * @param root the drop folder
 * @param jobId
 * @returns the plan, or null when this job never started one
 */
export function readLabelJob(root: string, jobId: string): LabelJob | null {
  let raw: string;
  try {
    raw = readFileSync(jobPath(root, jobId), 'utf8');
  } catch {
    return null;
  }
  return parseLabelJob(raw);
}

/**
 * Parses a plan's own text back into its header, batches, choices and closing line
 *
 * A line that will not parse is skipped rather than losing the rest -- the same leniency
 * parseCopyJournal extends to a file it cannot fully trust. State lines are folded in the order
 * they were written, so the last one for a batch is the one that stands.
 *
 * @param raw the file's contents
 * @returns null when there is no header to anchor the rest to
 */
export function parseLabelJob(raw: string): LabelJob | null {
  let header: JobHeaderLine | null = null;
  const slices = new Map<number, TreeThread[]>();
  const states = new Map<number, Omit<JobStateLine, 'type'>>();
  let choices: JobChoices | null = null;
  let outcome: JobOutcome | null = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const type = (parsed as { type?: unknown })?.type;
    if (type === 'header' && !header) header = parsed as JobHeaderLine;
    else if (type === 'batch') {
      const l = parsed as JobBatchLine;
      slices.set(l.index, Array.isArray(l.threads) ? l.threads : []);
    } else if (type === 'choices') choices = (parsed as JobChoicesLine).choices;
    else if (type === 'state') {
      const { type: _discriminator, ...state } = parsed as JobStateLine;
      states.set(state.index, state);
    } else if (type === 'done') outcome = (parsed as JobDoneLine).outcome;
  }
  if (!header) return null;

  const batches: JobBatch[] = [...slices.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const state = states.get(index);
      // Field by field rather than by spreading the state line over a default: the slice comes
      // from the batch line and never from a state line, since a state line records a transition
      // and not the work, and a spread would let a later line quietly shrink a batch -- or, with
      // its own index in it, move one.
      return {
        index,
        threads: slices.get(index) ?? [],
        state: state?.state ?? 'pending',
        runId: state?.runId,
        copied: state?.copied,
        skipped: state?.skipped,
        error: state?.error,
      };
    });

  return {
    jobId: header.jobId,
    startedAt: header.startedAt,
    account: header.account,
    label: header.label,
    members: header.members ?? [],
    batchSize: header.batchSize,
    total: header.total,
    choices,
    batches,
    outcome,
  };
}

/**
 * Which jobs in the drop folder never reached their closing line
 *
 * A crash and a job still running leave the same file behind, so this is only meaningful at a
 * start, before anything of this app is copying -- exactly where findOrphanedRuns is used.
 *
 * @param root the drop folder
 * @returns each unfinished job, in the order its file was found
 */
export function findUnfinishedJobs(root: string): LabelJob[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.endsWith(SUFFIX));
  } catch {
    return [];
  }
  const open: LabelJob[] = [];
  for (const name of names) {
    let raw: string;
    try {
      raw = readFileSync(join(root, name), 'utf8');
    } catch {
      continue;
    }
    const job = parseLabelJob(raw);
    if (job && !job.outcome) open.push(job);
  }
  return open;
}

/**
 * The batch the driver should work on next
 *
 * A batch that was pulled but never copied is where a crash lands, and it is the one to resume
 * -- not the one after it. A batch that failed stops the job: stepping over it would be the
 * driver walking past a mailbox that just refused us.
 *
 * @param job
 * @returns the batch, or null when the job is finished or stuck
 */
export function nextBatch(job: LabelJob): JobBatch | null {
  for (const batch of job.batches) {
    if (batch.state === 'failed') return null;
    if (batch.state !== 'copied') return batch;
  }
  return null;
}

/**
 * How far the whole job has got, for the strip above the picker
 *
 * Counted in conversations, matching what the drop progress already counts, and off the copied
 * batches rather than a running tally so a resumed job reports the same number the one before
 * it did.
 *
 * @param job
 * @returns the batch being worked on (one-based, because it is read out to a person), how many
 *   there are, and the conversations behind and in total
 */
export function jobProgress(job: LabelJob): {
  batch: number;
  batches: number;
  done: number;
  total: number;
} {
  const copied = job.batches.filter((b) => b.state === 'copied');
  const at = nextBatch(job);
  return {
    batch: (at?.index ?? job.batches.length - 1) + 1,
    batches: job.batches.length,
    done: copied.reduce((sum, b) => sum + b.threads.length, 0),
    total: job.total,
  };
}


//===========================
// Helper functions
//===========================

function writeLine(root: string, jobId: string, line: JobLine): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(jobPath(root, jobId), JSON.stringify(line) + '\n', 'utf8');
}
