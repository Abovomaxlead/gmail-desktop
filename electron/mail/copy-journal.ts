// The record of what one copy run inserted, written as it happens rather than at the end.
//
// A run that is killed loses whatever it has not written yet, so the moment that matters is
// the insert answering -- not the mailbox finishing, not the run finishing. One line per
// insert, appended synchronously, is what makes that true. This deliberately does not share
// MessageIndexStore's write path: that store debounces a whole-file rewrite by two seconds,
// which is exactly the window a crash-safe record cannot have, and rewriting the whole index
// per insert would cost O(n) where this costs one line.
//
// The trailing line is what tells "the user chose to stop and keep this" apart from a crash.
// Both leave a journal with a header and some insert lines and nothing more; only the line
// that follows says which one happened. Losing that line is not a detail -- it is what would
// make the app later offer to undo a run nobody asked to undo.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CopyJournalEntry,
  CopyRunId,
  CopyStopMode,
  CreatedLabel,
  MarkerLabel,
} from './copy-run-types';


//===========================
// Types
//===========================

/** How a run's journal was closed. 'completed' is the ordinary end; 'kept' and the two
 * rolled-back outcomes come from a deliberate stop; a journal with no line of this shape at
 * all is what a crash looks like. */
export type CopyJournalOutcome = 'completed' | 'kept' | 'rolled-back' | 'rolled-back-partial';

/** One mailbox a rollback sweep did not finish converging, kept legible on disk even once the
 * window that showed it is gone. Per mailbox rather than per message: a sweep acts on
 * everything under a mailbox's marker in one pass, so what it could not confirm is a property
 * of the mailbox, not of any one message inside it. */
export interface CopyJournalRemainder {
  email: string;
  reason: string;
}

interface CopyJournalHeaderLine {
  type: 'header';
  runId: CopyRunId;
  startedAt: number;
  targets: string[];
  /** Each mailbox's own marker label, created before any file went out to it. Required, not
   * optional, because a sweep must never re-derive a label id by looking its name up again --
   * this is the one place that id survives a crash for the resumed sweep to read back. */
  markers: MarkerLabel[];
}

interface CopyJournalInsertLine extends CopyJournalEntry {
  type: 'insert';
}

interface CopyJournalLabelLine extends CreatedLabel {
  type: 'label';
  runId: CopyRunId;
}

/** What this run resolved to do with its markers, written before the sweep that acts on it is
 * even attempted -- so a crash mid-sweep still leaves the mode on disk for the next start to
 * resume with, rather than asking the user a question this run already answered. 'keep' here
 * covers a normal, never-stopped finish too: both mean the same action, strip the marker. */
interface CopyJournalDecidingLine {
  type: 'deciding';
  runId: CopyRunId;
  mode: CopyStopMode;
}

interface CopyJournalDoneLine {
  type: 'done';
  runId: CopyRunId;
  outcome: CopyJournalOutcome;
  remainder?: CopyJournalRemainder[];
}

type CopyJournalLine =
  | CopyJournalHeaderLine
  | CopyJournalInsertLine
  | CopyJournalLabelLine
  | CopyJournalDecidingLine
  | CopyJournalDoneLine;

/** A journal read back off disk: its inserts, and whether it ever closed. */
export interface CopyJournalRead {
  runId: CopyRunId;
  startedAt: number;
  targets: string[];
  markers: MarkerLabel[];
  entries: CopyJournalEntry[];
  /** Every label this run created, so a rollback can take them away again */
  created: CreatedLabel[];
  /** The mode this run resolved to act on its markers with, once decided -- null for a run
   * that crashed before ever deciding, which is the one case a resume must still ask about. */
  decidedMode: CopyStopMode | null;
  done: CopyJournalDoneLine | null;
}


//===========================
// Constants
//===========================

const SUFFIX = '.rollback.jsonl';


//===========================
// Exported functions
//===========================

/**
 * Where one run's journal lives
 *
 * @param root the drop folder
 * @param runId
 */
export function journalPath(root: string, runId: CopyRunId): string {
  return join(root, `${runId}${SUFFIX}`);
}

/**
 * Opens a run's journal with its header line
 *
 * @param root the drop folder
 * @param runId
 * @param targets the mailboxes this run is copying into
 * @param startedAt
 * @param markers each target's own marker label, already created by the time the run starts
 *   uploading -- defaults to none, for a caller (or an older test) that has nothing to record
 */
export function startCopyJournal(
  root: string,
  runId: CopyRunId,
  targets: string[],
  startedAt: number,
  markers: MarkerLabel[] = [],
): void {
  writeLine(root, runId, { type: 'header', runId, startedAt, targets, markers });
}

/**
 * Records one message this run inserted, the moment the insert answered
 *
 * @param root the drop folder
 * @param entry
 */
export function appendCopyJournalEntry(root: string, entry: CopyJournalEntry): void {
  writeLine(root, entry.runId, { type: 'insert', ...entry });
}

/**
 * Records one label this run created, the moment the create answered
 *
 * @param root the drop folder
 * @param runId
 * @param label
 */
export function appendCopyJournalLabel(root: string, runId: CopyRunId, label: CreatedLabel): void {
  writeLine(root, runId, { type: 'label', runId, ...label });
}

/**
 * Attempts a write this run's own report must not lose in silence
 *
 * The audit log and the journal's own closing line have both been dropped by a redirected
 * network share before now. Neither may vanish into an empty catch again -- an unclosed
 * journal reads as a crash to the next-start orphan scan, so a write this fails on must be
 * handed back as a message rather than thrown away, for the caller to fold into what it
 * tells the user instead of only a line nobody reads.
 *
 * @param write the write to attempt
 * @returns null on success, or the message of whatever write() threw
 */
export function attemptWrite(write: () => void): string | null {
  try {
    write();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Records one successful insert in the journal, tolerating a failure to do so
 *
 * A deliberate choice, not an oversight: the insert already landed in Gmail and is reported
 * as copied regardless of what happens here, so a line this app cannot write locally must
 * never undo that. What is lost is narrow and already accounted for elsewhere -- this one
 * message cannot be offered for rollback later -- rather than the run itself.
 *
 * @param root the drop folder
 * @param entry
 * @param append injectable, so a test can make the write fail without touching a disk
 * @returns null on success, or the write's own failure message, for the caller to log
 */
export function recordCopyJournalEntry(
  root: string,
  entry: CopyJournalEntry,
  append: typeof appendCopyJournalEntry = appendCopyJournalEntry,
): string | null {
  return attemptWrite(() => append(root, entry));
}

/**
 * Records a created label, tolerating a failure to do so
 *
 * The same choice recordCopyJournalEntry makes: the label already exists in Gmail, so a line
 * this app cannot write locally must not undo that. What is lost is narrow -- this one label
 * cannot be taken away again by a later rollback.
 *
 * @param root the drop folder
 * @param runId
 * @param label
 * @param append injectable, so a test can make the write fail without touching a disk
 * @returns null on success, or the write's own failure message, for the caller to log
 */
export function recordCopyJournalLabel(
  root: string,
  runId: CopyRunId,
  label: CreatedLabel,
  append: typeof appendCopyJournalLabel = appendCopyJournalLabel,
): string | null {
  return attemptWrite(() => append(root, runId, label));
}

/**
 * Folds whatever went wrong along the way into an otherwise-successful result
 *
 * Never used to turn a success into a failure -- `base` already carries whatever decided
 * that; this only adds where a write did not go perfectly, so both can be reported at once
 * instead of the one being lost to report the other. That silent loss is exactly the defect
 * this exists to close: a run that fully succeeded, only to have the record of that fail
 * without a trace.
 *
 * @param base what a plain, fully-recorded success answers with
 * @param warnings collected along the way; nothing is added when this is empty
 * @returns base unchanged when there is nothing to add, or base with `warnings` folded in
 */
export function withWarnings<T extends object>(
  base: T,
  warnings: string[],
): T | (T & { warnings: string[] }) {
  return warnings.length > 0 ? { ...base, warnings } : base;
}

/**
 * Records what this run resolved to do with its markers, before attempting the sweep itself
 *
 * Written ahead of the sweep on purpose: if the process dies partway through sweeping, this
 * line is what lets the next start resume with the mode already decided rather than asking
 * the user a question this run already answered. Left to throw, the same as finishCopyJournal
 * -- a caller that cannot record this must know, so it can at least log the gap rather than
 * silently risk asking twice.
 *
 * @param root the drop folder
 * @param runId
 * @param mode 'keep' also covers a normal, never-stopped finish -- both strip the marker
 */
export function recordCopyJournalDecision(root: string, runId: CopyRunId, mode: CopyStopMode): void {
  writeLine(root, runId, { type: 'deciding', runId, mode });
}

/**
 * Closes a run's journal with what became of it
 *
 * Left to throw rather than swallowing its own failure: a caller reporting a deliberate stop
 * as done must know when this line did not make it to disk, since that is the one write that
 * tells a kept run apart from a crashed one.
 *
 * @param root the drop folder
 * @param runId
 * @param outcome
 * @param remainder what a rollback could not account for, for 'rolled-back-partial'
 */
export function finishCopyJournal(
  root: string,
  runId: CopyRunId,
  outcome: CopyJournalOutcome,
  remainder?: CopyJournalRemainder[],
): void {
  writeLine(root, runId, {
    type: 'done',
    runId,
    outcome,
    ...(remainder && remainder.length > 0 ? { remainder } : {}),
  });
}

/**
 * Reads one run's journal back
 *
 * @param root the drop folder
 * @param runId
 * @returns the journal, or null when this run never started one
 */
export function readCopyJournal(root: string, runId: CopyRunId): CopyJournalRead | null {
  let raw: string;
  try {
    raw = readFileSync(journalPath(root, runId), 'utf8');
  } catch {
    return null;
  }
  return parseCopyJournal(raw);
}

/**
 * Parses a journal's own text back into its header, entries and closing line
 *
 * A line that will not parse is skipped rather than losing the rest -- the same leniency the
 * message index already extends to a file it cannot fully trust.
 *
 * @param raw the journal file's contents
 * @returns null when there is no header to anchor the rest to
 */
export function parseCopyJournal(raw: string): CopyJournalRead | null {
  let header: CopyJournalHeaderLine | null = null;
  const entries: CopyJournalEntry[] = [];
  const created: CreatedLabel[] = [];
  let decidedMode: CopyStopMode | null = null;
  let done: CopyJournalDoneLine | null = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const type = (parsed as { type?: unknown })?.type;
    if (type === 'header' && !header) header = parsed as CopyJournalHeaderLine;
    else if (type === 'insert') {
      // Drop the line's own discriminator: entries is typed as CopyJournalEntry, the shape
      // copy-run-types.ts defines, not this file's on-disk line format.
      const { type: _discriminator, ...entry } = parsed as CopyJournalInsertLine;
      entries.push(entry);
    } else if (type === 'label') {
      // Same as the insert branch: the on-disk line carries a discriminator and the run it
      // belongs to, neither of which is part of the CreatedLabel shape read back.
      const { type: _discriminator, runId: _runId, ...label } = parsed as CopyJournalLabelLine;
      created.push(label);
    } else if (type === 'deciding') decidedMode = (parsed as CopyJournalDecidingLine).mode;
    else if (type === 'done') done = parsed as CopyJournalDoneLine;
  }
  if (!header) return null;
  return {
    runId: header.runId,
    startedAt: header.startedAt,
    targets: header.targets,
    // Older journals (or a header line that failed to write its markers) have none -- read
    // back as empty rather than undefined, so every reader can rely on the array being there.
    markers: header.markers ?? [],
    entries,
    created,
    decidedMode,
    done,
  };
}

/**
 * Which runs in the drop folder never reached their closing line
 *
 * A crash and a deliberate stop leave the same kind of file behind -- a header and some
 * inserts -- so the only thing that tells them apart is whether the closing line
 * (finishCopyJournal) ever got written. Anything without one is a run this app never heard
 * the end of.
 *
 * @param root the drop folder
 * @returns each orphaned run, in the order its file was found
 */
export function findOrphanedRuns(root: string): CopyJournalRead[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.endsWith(SUFFIX));
  } catch {
    return [];
  }
  const orphans: CopyJournalRead[] = [];
  for (const name of names) {
    let raw: string;
    try {
      raw = readFileSync(join(root, name), 'utf8');
    } catch {
      continue;
    }
    const journal = parseCopyJournal(raw);
    if (journal && !journal.done) orphans.push(journal);
  }
  return orphans;
}


//===========================
// Helper functions
//===========================

function writeLine(root: string, runId: CopyRunId, line: CopyJournalLine): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(journalPath(root, runId), JSON.stringify(line) + '\n', 'utf8');
}
