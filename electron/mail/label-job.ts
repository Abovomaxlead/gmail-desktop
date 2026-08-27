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
import { readCopyJournal } from './copy-journal';
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
  /** How many mailboxes that run actually opened, which is what its `copied` is spread over.
   * Fewer than the job's chosen targets whenever a mailbox could not be given a marker label,
   * since one without a marker is never inserted into. Read off the run's own journal when the
   * state is written; absent on a plan written before that was recorded. */
  mailboxes?: number;
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

/** The live figures of the batch being copied right now, which are the one part of a job's
 * progress that is nowhere on disk. `done` is counted the way the copy itself counts it: one
 * per message per target mailbox, and during 'check' one per message scanned instead. Neither
 * of those is a conversation, which is why it is handed over raw with `targets` beside it and
 * normalised here rather than added anywhere else. */
export interface RunningBatchProgress {
  phase: 'check' | 'copy';
  done: number;
  targets: number;
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
  mailboxes?: number;
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
 * Whether a listed label is big enough to be worth a plan
 *
 * The boundary the whole change rests on. At or under the batch size there is no plan file, no
 * driver and no job progress, and the drag is byte-for-byte the one this app already made -- so
 * everything a job adds can only ever be reached by a label that genuinely did not fit.
 *
 * @param threads what the listing answered
 * @param batchSize
 * @returns true when the list has to be cut
 */
export function needsJob(threads: TreeThread[], batchSize: number): boolean {
  return threads.length > batchSize;
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
 * The mailbox count is filled in here rather than asked of the caller. A batch's `copied` is
 * spread over the mailboxes its run actually opened, and only that run knows which those were --
 * it names them in its own journal header before its first insert. This is the moment both the
 * run id and the count are still reachable, so the count is written down beside the state and
 * the reading side never has to guess it. Costs one journal read per batch that names a run,
 * which is twice in a batch's life, against a batch that takes minutes.
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
  const mailboxes = at.mailboxes ?? (at.runId ? mailboxesOfRun(root, at.runId) : undefined);
  writeLine(root, jobId, { type: 'state', ...at, ...(mailboxes ? { mailboxes } : {}) });
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
      // Folded over the batch's earlier lines rather than replacing them. A line records one
      // transition and carries only what became known with it, so the bare 'pending' line that
      // takes a stuck batch up again mentions no count -- and replacing wholesale threw away
      // what that batch had already put in the mailbox, which the line was still counting a
      // moment earlier. A key absent from the newer line keeps the older value; a key present
      // on it wins, so a second attempt still overwrites the first attempt's figures.
      states.set(state.index, { ...states.get(state.index), ...state });
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
        mailboxes: state?.mailboxes,
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
 * Counted in conversations, matching what the drop progress already counts. Every batch that
 * answered is counted off the plan file -- a copied one by its whole slice, one that stopped part
 * way by what it actually managed -- so all of that reads back identically after a restart.
 *
 * The number can step back, in two ways, and neither is a restart losing the plan file:
 *
 * A restart loses the batch under way. That batch is the one part nowhere on disk, folded in from
 * `running`, and a resumed job has nothing to fold in until its next batch reports -- so the line
 * falls back by at most that batch's own slice, and never below what the plan file accounts for.
 * Persisting a per-insert tally would close that gap and was rejected: this file writes
 * transitions and not tallies, for the reason the note at the top gives, and the copy journal
 * already records every insert that landed.
 *
 * A batch can also be recorded below what it was showing, with no restart involved. `running`
 * counts every message the copy attempted, the duplicates it skipped included, while the `copied`
 * it finally records counts only the inserts that landed. A batch that skipped most of its mail
 * and then failed therefore drops to its recorded figure the moment it answers. That is the
 * estimate being corrected by the count, not the count being lost, and it is bounded the same
 * way: by that batch's own slice.
 *
 * @param job
 * @param running what the copy of the current batch has managed so far, when one is under way
 * @returns the batch under way or at fault (one-based, because it is read out to a person), how
 *   many there are, and the conversations behind and in total
 */
export function jobProgress(
  job: LabelJob,
  running?: RunningBatchProgress,
): {
  batch: number;
  batches: number;
  done: number;
  total: number;
} {
  const at = nextBatch(job);
  const done = job.batches.reduce((sum, b) => sum + batchConversations(job, b, at, running), 0);
  return {
    batch: batchNumber(job),
    batches: job.batches.length,
    done: Math.min(done, job.total),
    total: job.total,
  };
}


//===========================
// Helper functions
//===========================

// One contribution per batch, chosen rather than accumulated. A batch that was taken up again
// after failing has both a count of its own and a live figure describing the same conversations
// -- its first attempt's mail is still in the mailbox while the second attempt re-walks it -- and
// adding those together counted that mail twice. The larger of the two is the floor under what
// is known to have landed, and being one expression it cannot be summed by accident.

/**
 * What one batch is worth to the job line, in conversations
 *
 * @param job
 * @param batch
 * @param at the batch under way, so a live figure is only ever applied to that one
 * @param running
 * @returns conversations, between zero and the batch's own slice
 * @private
 */
function batchConversations(
  job: LabelJob,
  batch: JobBatch,
  at: JobBatch | null,
  running?: RunningBatchProgress,
): number {
  if (batch.state === 'copied') return batch.threads.length;
  const recorded = partialConversations(job, batch);
  const live = batch === at ? runningConversations(at, running) : 0;
  return Math.max(recorded, live);
}

/**
 * Which batch the line names
 *
 * The batch under way, or the one that stopped the job. `nextBatch` answers null for a stuck job
 * exactly as it does for a finished one, and falling back to the last batch for both claimed
 * "batch 4 van 4" over a job that never got past its second -- with no way to tell the two apart
 * on the number alone. The failed batch is named instead, which is the batch the user has to
 * answer for and the same one the panel's own closing line names (jobEndText in
 * renderer/app/job-panel.ts).
 *
 * @param job
 * @returns the one-based number, or zero for a plan holding no batches at all -- there is no
 *   batch one to point at, and zero is the only number that is not a claim
 * @private
 */
function batchNumber(job: LabelJob): number {
  if (job.batches.length === 0) return 0;
  const at = nextBatch(job);
  // The first failed batch, which is the one nextBatch stopped at: a later one cannot exist,
  // since a failure ends the walk rather than stepping over it.
  const stuck = job.batches.find((b) => b.state === 'failed');
  return (at?.index ?? stuck?.index ?? job.batches.length - 1) + 1;
}

/**
 * What the running batch is worth to the job line, in conversations
 *
 * Nothing is folded in during 'check': that counter is the duplicate scan's, and it would move
 * the line before a single mail had gone out. Nothing either once the job has no batch under way,
 * so a figure handed in over a stuck or finished job is ignored rather than added to a batch that
 * has already been counted off the plan file.
 *
 * @param at the batch being worked on, or null when the job has none left
 * @param running
 * @returns conversations, between zero and the batch's own slice
 * @private
 */
function runningConversations(at: JobBatch | null, running?: RunningBatchProgress): number {
  if (!at || !running || running.phase !== 'copy') return 0;
  return conversationsFrom(running.done, running.targets, at.threads.length);
}

/**
 * What a batch that did not finish is worth to the job line, in conversations
 *
 * Mail that really moved. A batch that failed after copying eight hundred conversations had those
 * eight hundred in the mailbox, and counting only the copied batches understated the job by every
 * one of them -- in that run and in every resume after it, since the count is on disk.
 *
 * Its `copied` is the copy's own figure, in the same message-insert unit the running batch reports,
 * so it needs the same conversion. Divided by the mailboxes the run opened, which is what those
 * inserts are spread over: a mailbox that never got a marker label is never inserted into, so
 * dividing by the mailboxes that were merely chosen understated the batch by that mailbox's whole
 * share -- and disagreed with the live line, which divides by the ready ones too. Only a plan
 * written before that count was recorded falls back to the chosen ones, which is the closest
 * thing on the file and never overstates, since ready can only be fewer.
 *
 * @param job
 * @param batch any batch that is not 'copied'; one that recorded no count is worth nothing
 * @returns conversations, between zero and the batch's own slice
 * @private
 */
function partialConversations(job: LabelJob, batch: JobBatch): number {
  return conversationsFrom(
    batch.copied ?? 0,
    batch.mailboxes ?? job.choices?.targets.length ?? 0,
    batch.threads.length,
  );
}

/**
 * How many mailboxes one run actually opened
 *
 * @param root the drop folder
 * @param runId
 * @returns the count, or undefined when that run left no journal to read it from
 * @private
 */
function mailboxesOfRun(root: string, runId: CopyRunId): number | undefined {
  const count = readCopyJournal(root, runId)?.targets.length ?? 0;
  return count > 0 ? count : undefined;
}

/**
 * Inserts turned into conversations, capped at the batch they belong to
 *
 * Divided by the mailboxes, because the same mail goes up once per target and the line counts
 * each conversation once. That division is exact only for one message per conversation; a thread
 * of five mails would run past its own batch, so the share is capped at the batch's conversation
 * count. Capped rather than scaled: the batch's message count is not written down anywhere, and a
 * bar that arrives early is a smaller lie than one that overshoots the total.
 *
 * @param inserts what the copy counted, one per message per target mailbox
 * @param targets how many mailboxes those inserts were spread over
 * @param slice the batch's own conversation count
 * @returns conversations, between zero and `slice`; zero when there is no mailbox to divide by,
 *   since inserts into no mailbox convert to nothing -- reading them as conversations credited a
 *   whole batch to a copy where every mailbox had failed and nothing had gone out
 * @private
 */
function conversationsFrom(inserts: number, targets: number, slice: number): number {
  if (targets < 1) return 0;
  return Math.min(Math.floor(Math.max(0, inserts) / targets), slice);
}

function writeLine(root: string, jobId: string, line: JobLine): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(jobPath(root, jobId), JSON.stringify(line) + '\n', 'utf8');
}
