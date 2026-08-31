'use client';

import { useEffect, useState } from 'react';
import type {
  MailDropItem,
  MailDropCopyResult,
  MailDropCopyDuplicate,
  MailDropCopyMode,
  MailDropExisting,
} from '../MailDropModal';
import { labelKind, type LabelKind } from '../label-kind';
import { filterLabels } from '../label-search';
import { recentFor, type RecentLabelUse } from '../recent-labels';
import { dropFailures } from '../drop-outcome';
import {
  existingCount,
  existingNotices,
  newerExisting,
  type ExistingNotice,
} from '../existing-labels';
import {
  mailboxRows,
  pickedChips,
  firstPickable,
  localPart,
  type MailboxRow,
  type PickedChip,
} from '../mailbox-rail';
import {
  previewMayPick,
  panelBelongsToJob,
  panelMayWalk,
  phaseAfterJobEnd,
  controlFailureText,
  type JobControlAction,
  panelTitle,
  panelBody,
  jobEndText,
  type JobEnd,
  type JobLine,
  type JobPanel,
} from '../job-panel';


//===========================
// Types
//===========================

interface Label {
  id: string;
  name: string;
}
interface AccountLabels {
  email: string;
  labels: Label[];
  error?: string;
}

/** Before the scan has answered, and after one that could not run. The serial is below every
 * drag, so the first real answer always wins. */
const NOTHING_FOUND_YET: MailDropExisting = {
  accounts: [],
  scanned: 0,
  serial: -1,
  answered: 0,
};

/** What a dragged label turned out to carry. Mirrors MailDropTree in electron/core/ipc.ts. */
interface DropTree {
  dragged: string;
  members: Array<{ name: string; threads: number }>;
}

/** Stands in for "the top of the label list" where a destination label id is expected. Not a
 * label id Gmail could ever hand out, so it can never collide with one.
 *
 * Written as an escape and not as the byte itself. A raw NUL in the source makes this whole file
 * read as binary to grep, ripgrep and every diff viewer, which is how it got missed for a while;
 * the escape is the same eight characters to the compiler and none of that to the tools. */
const TOP_LEVEL = '\u0000bovenin';

interface ByMailbox {
  email: string;
  copied: number;
}

/** The main process's copy-progress payload, widened locally for the paused and rollback
 * states this file adds. Kept apart from ../MailDropModal's MailDropCopyProgress rather than
 * extending it, since that mirror is shared with other pages this change does not touch. */
interface CopyProgress {
  phase: 'check' | 'copy' | 'rollback';
  done: number;
  total: number;
  paused?: boolean;
  byMailbox?: ByMailbox[];
  /** Present only during a batched job; absent for a plain drag, which draws the line it
   * always did. */
  job?: JobLine;
  /** Sent when the driver takes over, which is the moment this window stops owning the copy and
   * the panel becomes the job's. */
  panel?: JobPanel;
  /** Sent once, when the walk is over. The driver's copy has no return path to this window --
   * only its own Kopieer has one -- so this is the only thing that can end the job phase. */
  jobEnd?: JobEnd;
}

/** Mirrors electron/mail/copy-run-types.ts's RollbackMailboxOutcome and RollbackOutcome --
 * kept as a local copy the same way ../MailDropModal mirrors the rest of what main sends,
 * since the renderer cannot import from electron/. */
interface RollbackMailboxOutcome {
  email: string;
  /** Every message id the sweep confirmed it acted on, across every round it took. */
  swept: string[];
  /** False when the retry budget ran out while the marker still listed something -- not a
   * failure, just not finished yet; the next start resumes it on its own. */
  converged: boolean;
  refused?: 'permission' | 'auth';
  reason?: string;
}
interface RollbackOutcome {
  mailboxes: RollbackMailboxOutcome[];
  complete: boolean;
}

/** A run this app never heard the end of, waiting for the same keep-or-rollback answer a live
 * run's stop dialog already asks. */
interface PendingOrphan {
  runId: string;
  byMailbox: { email: string; inserted: number }[];
}

/** A job this app never heard the end of, waiting for the same kind of answer PendingOrphan
 * asks for one run. */
interface PendingJob {
  jobId: string;
  label: string;
  batch: number;
  batches: number;
  done: number;
  total: number;
  mode: 'new' | 'all';
}

/** What a copy answers when it was stopped rather than run to its own end -- neither the
 * success nor the failure MailDropCopyResult's `ok` flag distinguishes between. */
interface StoppedResult {
  stopped: true;
  mode: 'keep' | 'rollback';
  copied: number;
  byMailbox: ByMailbox[];
  rollback?: RollbackOutcome;
  error?: string;
  warnings?: string[];
  /** Set only when this is a whole job's end rather than one copy's, which is what makes the
   * report speak of the job instead of listing a batch's mailboxes. */
  job?: JobEnd;
}

/** MailDropCopyResult widened with the one field main now adds when the copy itself fully
 * succeeded but writing the record of that (the audit log, or the journal's closing line)
 * did not. Kept local rather than added to ../MailDropModal's mirror for the same reason as
 * CopyProgress above. */
type DoneResult = MailDropCopyResult & { warnings?: string[]; job?: JobEnd };

/** What copyMailDrop actually resolves to now. `stopped?: false` is added purely so the two
 * halves of the union share a discriminant -- DoneResult itself carries no such flag -- which
 * is what lets `if (result.stopped)` narrow cleanly below. */
type CopyOrStoppedResult = (DoneResult & { stopped?: false }) | StoppedResult;

type Phase =
  | { kind: 'picking' }
  | ({ kind: 'copying' } & CopyProgress)
  | { kind: 'confirm'; duplicates: MailDropCopyDuplicate[]; newCount: number }
  | { kind: 'stopped'; result: StoppedResult }
  | { kind: 'done'; result: DoneResult }
  | { kind: 'orphan'; orphan: PendingOrphan }
  | { kind: 'job'; job: PendingJob }
  // The driver is walking a job and this panel is watching it. Deliberately not 'copying':
  // that phase belongs to this window's own Kopieer and is left by the promise it awaits, and
  // the driver's copy has no such promise -- forcing it would leave the panel stuck there with
  // its close button disabled once the job ended. Deliberately not 'picking' either: see
  // previewMayPick. The way out is a job end, which phaseAfterJobEnd turns into 'done' or
  // 'stopped'. 'walking' rather than 'job', which is the orphan-job offer above it.
  | { kind: 'walking'; panel: JobPanel; progress?: CopyProgress };


//===========================
// Helper functions
//===========================

/**
 * The phase a job's end leaves this panel in, with the report it draws
 *
 * The choice of phase lives in ../job-panel; what is added here is the result shape the two
 * report phases already take, carrying the job itself so the report speaks of the whole walk
 * rather than listing one batch's mailboxes.
 *
 * @param end what main sent when the walk finished
 * @returns 'done' or 'stopped' -- never the job phase, which has no close button of its own
 */
function phaseFromJobEnd(end: JobEnd): Phase {
  const at = phaseAfterJobEnd(end);
  if (at.kind === 'stopped') {
    return {
      kind: 'stopped',
      result: {
        stopped: true,
        mode: at.mode ?? 'keep',
        copied: end.done,
        byMailbox: [],
        ...(at.mode === 'rollback'
          ? { rollback: { mailboxes: [], complete: at.complete !== false } }
          : {}),
        job: end,
      },
    };
  }
  return {
    kind: 'done',
    result: {
      ok: !at.error,
      copied: end.done,
      skipped: 0,
      total: end.total,
      accounts: [],
      ...(at.error ? { error: at.error } : {}),
      job: end,
    },
  };
}


//===========================
// Page
//===========================

export default function MailDropModalPage() {
  const [items, setItems] = useState<MailDropItem[]>([]);
  const [tree, setTree] = useState<DropTree | null>(null);
  /** Per mailbox, set only once the user switches the structure off. Absent means on, which is
   * the default for a tree drag and irrelevant for every other drag. */
  const [flatMode, setFlatMode] = useState<Record<string, boolean>>({});
  const [accounts, setAccounts] = useState<AccountLabels[] | null>(null);
  const [active, setActive] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<RecentLabelUse[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'picking' });
  const [existing, setExisting] = useState<MailDropExisting>(NOTHING_FOUND_YET);
  /** How far the running job has got, kept apart from `phase` so a batch this window did not
   * start can still report itself. Null outside a job, and cleared by the next real drag. */
  const [jobLine, setJobLine] = useState<JobLine | null>(null);
  // Open the moment the X is clicked, not once the pause is confirmed -- the round trip to
  // main must not be what decides whether the dialog appears.
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  /** What the last stop asked of main and did not get, or null when there is nothing to say */
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    // Which mailboxes can be copied to depends on which one was dragged from, so this has to be
    // asked again for every drop and never carried over. The counter keeps the answer of a
    // request that was overtaken from replacing a newer one.
    let labelRun = 0;
    const loadLabels = () => {
      const mine = (labelRun += 1);
      setAccounts(null);
      // Asked per drop, like the labels themselves: a copy started from another window, or one
      // the driver made between two drops, belongs in this list too.
      void bridge
        .getRecentLabels()
        .then((r) => {
          if (mine === labelRun) setRecent(r);
        })
        .catch(() => {
          if (mine === labelRun) setRecent([]);
        });
      void bridge
        .getLabels()
        .then(({ accounts: a }) => {
          if (mine !== labelRun) return;
          setAccounts(a);
          setActive(firstPickable(a));
        })
        .catch(() => {
          if (mine === labelRun) setAccounts([]);
        });
    };

    // The scan runs from the drop, so what it has already found is asked for once here; the
    // mailboxes still being looked up arrive on their own.
    const loadExisting = () => {
      setExisting(NOTHING_FOUND_YET);
      void bridge
        .getMailDropExisting()
        .then((e) => setExisting((cur) => newerExisting(cur, e)))
        .catch(() => {
        });
    };
    void bridge.getMailDropPreview().then((got) => {
      const { items: i, tree: t, panel, job } = got as {
        items: MailDropItem[];
        tree?: unknown;
        panel?: JobPanel;
        job?: JobLine;
      };
      if (i.length > 0) setItems(i);
      setTree((t as DropTree | null) ?? null);
      // Reopened halfway through a job: without this the window would come back in its picking
      // phase, offering Kopieer for mail the driver has in flight. Refused by main, but the
      // offer itself is the thing that must not be there.
      if (panel) {
        if (job) setJobLine(job);
        setPhase((cur) => (cur.kind === 'picking' ? { kind: 'walking', panel } : cur));
      }
    });
    // Every drop, not every drop but the first. This used to skip the reload for the first
    // preview after mounting, on the assumption that the mount belonged to that same drop --
    // and any remount in between broke it, leaving the previous drag's mailboxes on screen with
    // the mailbox just dragged from still offered as a target and the one dragged to gone.
    bridge.onMailDropPreview((p) => {
      const {
        items: i,
        tree: t,
        panel,
        job,
      } = p as { items: MailDropItem[]; tree?: unknown; panel?: JobPanel; job?: JobLine };
      setItems(i);
      setTree((t as DropTree | null) ?? null);
      // A driven batch is a job showing what it is about to copy itself, not a new drag. Its list
      // is worth updating -- the alternative was showing nothing at all, which left a half-hour
      // job invisible once this window had been closed after a batch. Everything below is the
      // part that must not happen for it: returning to `picking` clears the chosen mailboxes and
      // puts Kopieer back in front of the user for mail the driver already has in flight, and on
      // 2026-08-26 that landed 717 mails twice.
      if (!previewMayPick(p as { driven?: boolean })) {
        // The same panel it was already looking at, with this batch's numbers in it. Never a new
        // panel and never a batch report: one job is one piece of work.
        if (job) setJobLine(job);
        if (panel) {
          setPhase((cur) =>
            !panelMayWalk(cur) ? cur : cur.kind === 'walking' ? { ...cur, panel } : { kind: 'walking', panel },
          );
        }
        return;
      }
      setFlatMode({});
      setPicked({});
      setSearch('');
      setPhase({ kind: 'picking' });
      setJobLine(null);
      loadLabels();
      loadExisting();
    });
    loadLabels();
    loadExisting();
    // Asked once, the same moment the picker itself first asks what it needs -- a run this
    // app never heard the end of is not tied to any one drag, so there is nothing to re-ask
    // for on a later drop the way loadLabels/loadExisting are.
    (
      window.desktop as unknown as { getPendingOrphan?: () => Promise<PendingOrphan | null> }
    ).getPendingOrphan?.()
      .then((orphan) => {
        if (orphan) {
          setPhase((cur) => (cur.kind === 'picking' ? { kind: 'orphan', orphan } : cur));
          return;
        }
        // Only when the run-level offer had nothing waiting: two offers stacked on one modal is
        // a queue nobody asked for, and that one is the more urgent since it holds mail under a
        // marker.
        return (
          window.desktop as unknown as { getPendingJob?: () => Promise<PendingJob | null> }
        )
          .getPendingJob?.()
          .then((job) => {
            if (job) setPhase((cur) => (cur.kind === 'picking' ? { kind: 'job', job } : cur));
          });
      })
      .catch(() => {});
    bridge.onMailDropExisting((e) => setExisting((cur) => newerExisting(cur, e)));
    bridge.onMailDropCopyProgress((p: CopyProgress) => {
      // Kept beside the phase rather than folded into it. A batch the driver started never puts
      // this window into `copying` -- only its own Kopieer does that -- so before this, progress
      // for every batch after the first was simply dropped and the window sat on the previous
      // batch's result. Forcing the phase instead would leave it stuck there when the job ends,
      // with the close button disabled and nothing left to send.
      if (p.job) setJobLine(p.job);
      // The way out of the job phase, and the only one there is.
      if (p.jobEnd) {
        const end = p.jobEnd;
        setStopDialogOpen(false);
        // The job answered in the end, so whatever the last stop could not get is stale.
        setControlError(null);
        // Cleared with the same click, or the footer would go on announcing a running batch
        // over a panel that has just reported the job finished.
        setJobLine(null);
        setPhase(phaseFromJobEnd(end));
        return;
      }
      // The driver has taken over. Announced on this channel because it happens while this
      // window is still awaiting its own copy: the panel is the job's from here on, whichever
      // of the two answers first.
      if (p.panel) {
        const panel = p.panel;
        // Not once this panel has already reported the job's end. The progress channel goes on
        // delivering after a walk is over, and a panel message landing then would put the
        // finished report back behind a phase whose only exit has already been sent.
        setPhase((cur) =>
          !panelMayWalk(cur) ? cur : cur.kind === 'walking' ? { ...cur, panel } : { kind: 'walking', panel },
        );
        return;
      }
      setPhase((cur) =>
        cur.kind === 'copying'
          ? { kind: 'copying', ...p }
          // Held for the stop dialog, which asks about the batch in flight and needs its
          // mailboxes and its count to do that.
          : cur.kind === 'walking'
            ? { ...cur, progress: p }
            : cur,
      );
    });
  }, []);

  const n = items.length;
  const close = () => window.desktop?.closeMailDropPreview();

  // controlMailDropCopy is not yet part of DesktopBridge (../page.tsx) -- that interface is
  // outside this change's owned files -- so it is reached through an explicit, narrow cast
  // instead of widening `window.desktop` to `any`.
  const controlCopy = (action: JobControlAction) =>
    (
      window.desktop as unknown as {
        controlMailDropCopy?: (a: typeof action) => Promise<{ ok: boolean; error?: string }>;
      }
    ).controlMailDropCopy?.(action);

  // Every one of these used to be fired and forgotten, so a stop the gate refused looked
  // exactly like one it took: the dialog closed and the panel went on saying the job was
  // running. Awaited and reported instead -- what to report is controlFailureText's rule, so
  // that a refused pause between two batches stays the non-event it is.
  const ask = async (action: JobControlAction) => {
    setControlError(null);
    let answer: { ok: boolean; error?: string } | undefined;
    try {
      answer = await controlCopy(action);
    } catch (e) {
      answer = { ok: false, error: (e as Error)?.message };
    }
    setControlError(controlFailureText(action, answer));
  };

  // Pausing and opening the dialog happen in the same click, together: the user does not
  // have to wait on a round trip to main before seeing their choices.
  const requestStop = () => {
    void ask('pause');
    setStopDialogOpen(true);
  };
  const keepCopying = () => {
    setStopDialogOpen(false);
    void ask('resume');
  };
  const stopAndKeep = () => {
    setStopDialogOpen(false);
    void ask('stop-keep');
  };
  const stopAndTrashBatch = () => {
    setStopDialogOpen(false);
    void ask('stop-rollback-batch');
  };
  const stopAndTrashJob = () => {
    setStopDialogOpen(false);
    void ask('stop-rollback-job');
  };

  const decideOrphan = (runId: string, mode: 'keep' | 'rollback') => {
    setPhase({ kind: 'picking' });
    void (
      window.desktop as unknown as {
        decideOrphanRun?: (runId: string, mode: 'keep' | 'rollback') => Promise<{ ok: boolean }>;
      }
    ).decideOrphanRun?.(runId, mode);
  };

  const decideJob = (jobId: string, choice: 'continue' | 'keep' | 'rollback') => {
    setPhase({ kind: 'picking' });
    void (
      window.desktop as unknown as {
        decideJobRun?: (
          jobId: string,
          choice: 'continue' | 'keep' | 'rollback',
        ) => Promise<{ ok: boolean }>;
      }
    ).decideJobRun?.(jobId, choice);
  };

  /** Whether this mailbox takes the dragged tree rather than a set of ticked labels */
  const takesTree = (email: string) => tree !== null && !flatMode[email];

  const toggle = (email: string, labelId: string) => {
    setPicked((cur) => {
      const mine = cur[email] ?? [];
      // A tree lands in exactly one place, so choosing a destination replaces the previous one
      // instead of adding to it. Clicking the chosen one again unchooses the mailbox.
      if (takesTree(email)) {
        return { ...cur, [email]: mine.includes(labelId) ? [] : [labelId] };
      }
      return {
        ...cur,
        [email]: mine.includes(labelId) ? mine.filter((l) => l !== labelId) : [...mine, labelId],
      };
    });
  };

  const targets = Object.entries(picked)
    .filter(([, labelIds]) => labelIds.length > 0)
    .map(([email, labelIds]) =>
      takesTree(email)
        ? {
            email,
            labelIds: [],
            tree: { parentLabelId: labelIds[0] === TOP_LEVEL ? null : labelIds[0] },
          }
        : { email, labelIds },
    );
  // A tree mailbox counts as one: it is one place, however many labels get made there.
  const pickedCount = targets.reduce((s, t) => s + (t.tree ? 1 : t.labelIds.length), 0);

  const savedCount = items.reduce((s, i) => s + i.saved, 0);
  const failures = dropFailures(items);
  const notices = existingNotices(existing.accounts, accounts ?? []);
  const rows = mailboxRows(accounts ?? [], picked, existing.accounts, search);
  const chips = pickedChips(picked, accounts ?? []);
  const openMailbox = accounts?.find((a) => a.email === active) ?? accounts?.[0] ?? null;

  const copy = async (mode: MailDropCopyMode = 'check') => {
    const bridge = window.desktop;
    if (!bridge || targets.length === 0) return;
    setPhase({
      kind: 'copying',
      phase: mode === 'all' ? 'copy' : 'check',
      done: 0,
      total: 0,
    });
    try {
      const result = (await bridge.copyMailDrop(targets, mode)) as CopyOrStoppedResult;
      setStopDialogOpen(false);
      // Batch one's copy answers this window, and the driver takes over in the same breath. Which
      // of the two arrives first is not ours to decide, so a job that has already claimed the
      // panel keeps it: reporting batch one here is exactly the per-batch panel this replaced.
      if (result.stopped) {
        setPhase((cur) => (panelBelongsToJob(cur) ? cur : { kind: 'stopped', result }));
        return;
      }
      setPhase((cur) =>
        panelBelongsToJob(cur)
          ? cur
          : result.needsConfirm
            ? {
                kind: 'confirm',
                duplicates: result.duplicates ?? [],
                newCount: result.newCount ?? 0,
              }
            : { kind: 'done', result },
      );
    } catch (e) {
      setStopDialogOpen(false);
      setPhase((cur) =>
        panelBelongsToJob(cur)
          ? cur
          : {
              kind: 'done',
              result: {
                ok: false,
                copied: 0,
                skipped: 0,
                total: 0,
                accounts: [],
                error: (e as Error).message,
              },
            },
      );
    }
  };

  // A job that has ended still has its numbers, in the report rather than in the line: the line
  // is cleared the moment the walk is over so the footer stops announcing a running batch.
  const endJob = phase.kind === 'done' || phase.kind === 'stopped' ? phase.result.job : undefined;
  const shownJob: JobLine | null = endJob
    ? {
        batch: endJob.copiedBatches,
        batches: endJob.batches,
        done: endJob.done,
        total: endJob.total,
      }
    : jobLine;
  // The stop dialog asks about the batch in flight, and during a job it is the driver's batch
  // rather than this window's. Both hand it the same shape.
  const stopProgress: CopyProgress | null =
    phase.kind === 'copying'
      ? phase
      : phase.kind === 'walking'
        ? phase.progress ?? { phase: 'copy', done: 0, total: 0 }
        : null;

  const labelName = (email: string, labelId: string) =>
    labelId === TOP_LEVEL
      ? 'Bovenin'
      : accounts?.find((a) => a.email === email)?.labels.find((l) => l.id === labelId)?.name ??
        labelId;

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        // Closing the panel during a job does not stop the job -- the driver owns that copy, and
        // the footer's Annuleren is the way to end it. Only this window's own copy holds the
        // backdrop, since that one has nothing else watching it.
        className="flex h-screen w-full items-center justify-center bg-black/40 p-6"
        onClick={phase.kind === 'copying' ? undefined : close}
      >
        <div
          // Picking gets a panel of its own height, so the rail and the labels each keep a
          // scroll region instead of one page that grows with the longest mailbox. A report
          // is as tall as it is.
          className={`flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900 ${
            phase.kind === 'picking' && failures.length === 0 && accounts?.length !== 0
              ? 'h-full max-h-[680px]'
              : 'max-h-full'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-5 py-3.5 dark:border-white/10">
            <h1 className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {panelTitle({ items: n, job: shownJob, failed: failures.length > 0 })}
            </h1>
            <button
              // Copying no longer disables this: it pauses and asks instead of doing nothing.
              // Once the dialog itself is open a second click has nowhere new to go, so it is
              // disabled only for that one moment.
              onClick={phase.kind === 'copying' ? requestStop : close}
              disabled={phase.kind === 'copying' && stopDialogOpen}
              // "Sluiten" is wrong here while copying -- this pauses and asks, it does not
              // close anything. Named the same as the button below it, since it does exactly
              // what that button does.
              aria-label={phase.kind === 'copying' ? 'Annuleren' : 'Sluiten'}
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-neutral-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{ height: 18, width: 18 }}
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          {phase.kind === 'picking' && failures.length === 0 && accounts !== null && accounts.length > 0 && (
            <div className="shrink-0 border-b border-black/5 px-5 pb-3 pt-3 dark:border-white/10">
              <LabelSearch value={search} onChange={setSearch} />
            </div>
          )}

          {phase.kind === 'picking' && failures.length === 0 && notices.length > 0 && (
            <div className="shrink-0 border-b border-black/5 px-5 pt-3 dark:border-white/10">
              <ExistingWarning notices={notices} scanned={existing.scanned} />
            </div>
          )}

          {stopDialogOpen && stopProgress ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <StopConfirm
                phase={stopProgress}
                job={phase.kind === 'copying' ? phase.job : jobLine ?? undefined}
                onKeepCopying={keepCopying}
                onStopAndKeep={stopAndKeep}
                onStopAndTrashBatch={stopAndTrashBatch}
                onStopAndTrashJob={stopAndTrashJob}
              />
            </div>
          ) : phase.kind === 'walking' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <JobRunning panel={phase.panel} line={jobLine} />
            </div>
          ) : phase.kind === 'stopped' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {phase.result.job ? (
                <JobReport end={phase.result.job} />
              ) : (
                <StoppedReport result={phase.result} />
              )}
            </div>
          ) : phase.kind === 'done' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {phase.result.job ? (
                <JobReport end={phase.result.job} />
              ) : (
                <CopyReport result={phase.result} />
              )}
            </div>
          ) : phase.kind === 'confirm' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DuplicateWarning
                duplicates={phase.duplicates}
                newCount={phase.newCount}
                labelName={labelName}
              />
            </div>
          ) : phase.kind === 'orphan' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <OrphanDecision orphan={phase.orphan} onDecide={decideOrphan} />
            </div>
          ) : phase.kind === 'job' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <JobDecision job={phase.job} onDecide={decideJob} />
            </div>
          ) : failures.length > 0 ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DropFailure reasons={failures} />
            </div>
          ) : accounts === null ? (
            <div className="flex min-h-0 flex-1">
              <RailPlaceholder />
              <p className="flex-1 px-5 py-4 text-sm text-neutral-500">Labels ophalen…</p>
            </div>
          ) : accounts.length === 0 ? (
            <p className="flex-1 px-5 py-4 text-sm text-neutral-500">Geen ander gekoppeld account.</p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <MailboxRail rows={rows} active={openMailbox?.email ?? ''} onSelect={setActive} />
              {openMailbox && (
                <LabelPane
                  account={openMailbox}
                  search={search}
                  recent={recentFor(recent, openMailbox.email, openMailbox.labels)}
                  picked={picked[openMailbox.email] ?? []}
                  disabled={phase.kind === 'copying'}
                  tree={takesTree(openMailbox.email) ? tree : null}
                  treeOffered={tree !== null}
                  onFlatMode={(off) =>
                    setFlatMode((cur) => {
                      setPicked((p) => ({ ...p, [openMailbox.email]: [] }));
                      return { ...cur, [openMailbox.email]: off };
                    })
                  }
                  countExisting={(labelId) =>
                    existingCount(existing.accounts, openMailbox.email, labelId)
                  }
                  onToggle={(labelId) => toggle(openMailbox.email, labelId)}
                />
              )}
            </div>
          )}

          {controlError && (
            // Above the footer rather than in it: the footer's own line is the job's progress,
            // and a refused stop is about the button beside it, not about how far the job got.
            //
            // Dismissable, because nothing else is guaranteed to clear it: a stop clicked just
            // after the job answered is refused by main and set here after the job end that would
            // have cleared it, which left a red line standing over a panel reporting a finished
            // job.
            <div className="flex shrink-0 items-start justify-between gap-3 border-t border-black/10 px-5 pt-3 dark:border-white/10">
              <p className="text-xs text-red-700 dark:text-red-400">{controlError}</p>
              <button
                type="button"
                onClick={() => setControlError(null)}
                aria-label="Melding sluiten"
                className="shrink-0 rounded px-1 text-xs text-red-700 hover:bg-red-500/10 dark:text-red-400"
              >
                ✕
              </button>
            </div>
          )}

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/10 px-5 py-3 dark:border-white/10">
            <Status
              phase={phase}
              jobLine={jobLine}
              pickedCount={pickedCount}
              savedCount={savedCount}
              failures={failures}
              chips={chips}
            />
            {phase.kind === 'copying' || phase.kind === 'walking' ? (
              // The X in the header does exactly this too, but nothing there told anyone a
              // running copy could be stopped at all -- this is the labelled way in. Disabled
              // once the dialog itself is open, for the same reason the X is: a second click
              // has nowhere new to go.
              <button
                onClick={requestStop}
                disabled={stopDialogOpen}
                className="shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-black/5 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
              >
                Annuleren
              </button>
            ) : phase.kind === 'done' || phase.kind === 'stopped' || failures.length > 0 ? (
              <button
                onClick={close}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Sluiten
              </button>
            ) : phase.kind === 'orphan' || phase.kind === 'job' ? null : phase.kind === 'confirm' ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setPhase({ kind: 'picking' })}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
                >
                  Annuleren
                </button>
                <button
                  onClick={() => void copy('all')}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
                >
                  Alles kopiëren
                </button>
                {phase.newCount > 0 && (
                  <button
                    onClick={() => void copy('new')}
                    className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                  >
                    {phase.newCount === 1
                      ? 'Alleen de nieuwe kopiëren'
                      : `Alleen de ${phase.newCount} nieuwe kopiëren`}
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => void copy()}
                // 'copying' has its own branch above now, with its own button -- this one is
                // never reached while it is, so the disabled/label pair it used to need for
                // that no longer applies here.
                disabled={pickedCount === 0 || savedCount === 0}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                Kopieer
              </button>
            )}
          </footer>
        </div>
      </div>
    </>
  );
}


//===========================
// Helper components
//===========================

/**
 * The mailboxes to file in, one row each
 *
 * A row carries what the columns used to say by being on screen: how much is ticked there,
 * whether the mail is already in it, whether it can be read, and how many labels a running
 * search leaves standing. Without that the rail would be a list of addresses to guess from.
 *
 * @param rows
 * @param active the mailbox the pane is showing
 * @param onSelect
 */
function MailboxRail({
  rows,
  active,
  onSelect,
}: {
  rows: MailboxRow[];
  active: string;
  onSelect: (email: string) => void;
}) {
  return (
    <nav
      aria-label="Postvakken"
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-black/10 p-2 dark:border-white/10"
    >
      {rows.map((row) => {
        const on = row.email === active;
        const empty = row.matchCount === 0;
        return (
          <button
            key={row.email}
            type="button"
            onClick={() => onSelect(row.email)}
            title={row.error ? `${row.email} — ${row.error}` : row.email}
            aria-current={on}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition ${
              on
                ? 'bg-blue-50 text-neutral-900 dark:bg-blue-500/15 dark:text-neutral-100'
                : `${
                    empty
                      ? 'text-neutral-400 dark:text-neutral-600'
                      : 'text-neutral-700 dark:text-neutral-300'
                  } hover:bg-black/[0.04] dark:hover:bg-white/5`
            }`}
          >
            <span className="truncate">{row.email}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {row.error && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-red-500"
                  style={{ flexShrink: 0 }}
                />
              )}
              {row.hasExisting && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                  style={{ flexShrink: 0 }}
                />
              )}
              {row.matchCount !== null && (
                <span className="text-[11px] tabular-nums text-neutral-400">{row.matchCount}</span>
              )}
              {row.pickedCount > 0 && (
                <span className="rounded bg-blue-600 px-1.5 text-[11px] font-medium tabular-nums text-white">
                  {row.pickedCount}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** The rail's own shape while the label lists are still on their way, so the panel does not
 * jump sideways once they land. */
function RailPlaceholder() {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-black/10 p-2 dark:border-white/10">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mx-2 my-2 h-3 animate-pulse rounded bg-black/[0.06] dark:bg-white/10" />
      ))}
    </div>
  );
}

/**
 * One mailbox's labels to tick, narrowed by what is in the search box
 *
 * Two modes in one pane, because they answer the same question -- where does this mail go. With
 * a tree the answer is one place, so the labels turn from tickboxes into a single choice and
 * `Bovenin` joins them as a place of its own; without one, nothing about the pane changes.
 *
 * @param account
 * @param search
 * @param recent the labels today's copies went into for this mailbox, newest first
 * @param picked the labels ticked for this account, or its one chosen destination
 * @param disabled while a copy is running
 * @param tree the dragged tree when this mailbox takes it, null when it does not
 * @param treeOffered whether the drag carried a tree at all, which is what puts the switch on
 *   screen
 * @param onFlatMode told true when the structure is switched off
 * @param countExisting how much of the drag a label already holds
 * @param onToggle
 */
function LabelPane({
  account,
  search,
  recent,
  picked,
  disabled,
  tree,
  treeOffered,
  onFlatMode,
  countExisting,
  onToggle,
}: {
  account: AccountLabels;
  search: string;
  recent: Label[];
  picked: string[];
  disabled: boolean;
  tree: DropTree | null;
  treeOffered: boolean;
  onFlatMode: (off: boolean) => void;
  countExisting: (labelId: string) => number;
  onToggle: (labelId: string) => void;
}) {
  const shown = filterLabels(account.labels, search, picked);
  const single = tree !== null;
  const places: Array<{ id: string; name: string }> = single
    ? [{ id: TOP_LEVEL, name: 'Bovenin' }, ...shown]
    : shown;
  // Only above an empty box. Once something is typed the list is the answer to that, and a
  // shortcut standing in front of it is one more thing to read past.
  const shortcuts = search.trim() === '' ? recent : [];
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-black/5 px-4 py-2 dark:border-white/10">
        <p
          className="truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"
          title={account.email}
        >
          {account.email}
        </p>
        {treeOffered && (
          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-neutral-600 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={single}
              disabled={disabled}
              onChange={(e) => onFlatMode(!e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-blue-600"
            />
            Structuur overnemen
          </label>
        )}
      </div>
      {tree && <TreeOutline tree={tree} />}
      {account.error ? (
        <span className="px-4 py-3 text-xs text-red-600 dark:text-red-500">{account.error}</span>
      ) : account.labels.length === 0 && !single ? (
        <span className="px-4 py-3 text-xs text-neutral-400">Geen labels</span>
      ) : places.length === 0 ? (
        <span className="px-4 py-3 text-xs text-neutral-400">Geen label gevonden</span>
      ) : (
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {shortcuts.length > 0 && (
            <>
              <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                Recent
              </p>
              {shortcuts.map((label) => (
                <PlaceRow
                  key={`recent-${label.id}`}
                  label={label}
                  on={picked.includes(label.id)}
                  single={single}
                  disabled={disabled}
                  already={countExisting(label.id)}
                  onToggle={() => onToggle(label.id)}
                />
              ))}
              <div className="my-1.5 border-t border-black/5 dark:border-white/10" />
            </>
          )}
          {single && (
            <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Plaats onder
            </p>
          )}
          {places.map((label) => (
            <PlaceRow
              key={label.id}
              label={label}
              on={picked.includes(label.id)}
              single={single}
              disabled={disabled}
              // Never asked about a place that is not a label, and never about a label that is
              // about to be created: neither can hold anything yet.
              already={label.id === TOP_LEVEL ? 0 : countExisting(label.id)}
              onToggle={() => onToggle(label.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One place the mail can go, as a row in the picker
 *
 * Shared by the Recent block and the list under it, so a label offered twice is the same row
 * twice -- one tickbox drawn two ways is what would make them disagree.
 *
 * @param label
 * @param on whether it is ticked
 * @param single one destination rather than several, which turns the tickbox into a choice
 * @param disabled while a copy is running
 * @param already how much of the drag this label holds already
 * @param onToggle
 */
function PlaceRow({
  label,
  on,
  single,
  disabled,
  already,
  onToggle,
}: {
  label: { id: string; name: string };
  on: boolean;
  single: boolean;
  disabled: boolean;
  already: number;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition ${
        on
          ? 'bg-blue-50 text-neutral-900 dark:bg-blue-500/15 dark:text-neutral-100'
          : 'text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/5'
      }`}
    >
      <input
        type={single ? 'radio' : 'checkbox'}
        checked={on}
        disabled={disabled}
        onChange={onToggle}
        className="h-4 w-4 shrink-0 accent-blue-600"
      />
      {label.id === TOP_LEVEL ? <TopLevelIcon /> : <LabelIcon id={label.id} />}
      <span className="truncate" title={label.name}>
        {label.name}
      </span>
      {already > 0 && (
        <span className="ml-auto shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/40 dark:text-amber-500">
          {already === 1 ? 'Bericht bestaat al in label' : `${already} berichten bestaan al in label`}
        </span>
      )}
    </label>
  );
}

/**
 * The labels a tree drag is going to make, with what each one holds
 *
 * Shown before anything is copied because it is the only place a sublabel the scrape could not
 * see becomes visible while the drag can still be cancelled.
 *
 * @param tree
 */
function TreeOutline({ tree }: { tree: DropTree }) {
  return (
    <div className="max-h-32 shrink-0 overflow-y-auto border-b border-black/5 bg-black/[0.02] px-4 py-2 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {tree.members.length === 1 ? '1 label' : `${tree.members.length} labels`}
      </p>
      {tree.members.map((m) => {
        const depth = m.name.split('/').length - tree.dragged.split('/').length;
        return (
          <div
            key={m.name}
            className="flex items-center gap-2 py-px text-[12px] text-neutral-600 dark:text-neutral-400"
            style={{ paddingLeft: `${depth * 12}px` }}
          >
            <span className="truncate" title={m.name}>
              {m.name.split('/').pop()}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-neutral-400">{m.threads}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The mark beside `Bovenin`, which is a place rather than a label */
function TopLevelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0 text-neutral-400">
      <path
        d="M2 4.5h12M2 8h8M2 11.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The box that narrows the labels of every mailbox at once
 *
 * One box rather than one per mailbox: the rail counts the matches per mailbox, so a search
 * says where the label you mean lives instead of only filtering what is already open.
 *
 * @param value
 * @param onChange
 */
function LabelSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
        style={{ height: 15, width: 15 }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        autoFocus
        placeholder="Zoek een label…"
        aria-label="Zoek een label"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        className="w-full rounded-lg border border-black/10 bg-black/[0.03] py-1.5 pl-8 pr-8 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-blue-500 focus:bg-transparent dark:border-white/10 dark:bg-white/5 dark:text-neutral-100 dark:focus:border-blue-400"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Zoekopdracht wissen"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-neutral-500 transition hover:bg-black/5 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-neutral-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ height: 14, width: 14 }}
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function Status({
  phase,
  jobLine,
  pickedCount,
  savedCount,
  failures,
  chips,
}: {
  phase: Phase;
  jobLine: CopyProgress['job'] | null;
  pickedCount: number;
  savedCount: number;
  failures: string[];
  chips: PickedChip[];
}) {
  // A job carries on between batches, and this window is not in its `copying` phase then: the
  // batch that is running was started by the driver and not by the button here. Said first and
  // on its own, because the line underneath it would otherwise be the *previous* batch's result
  // while the next one is already going -- which reads as finished when it is not.
  // Nothing here while the panel is watching a job: the body already says which batch is
  // running and how far the job has got, and saying it twice in one panel is noise.
  if (jobLine && phase.kind !== 'copying' && phase.kind !== 'walking' && jobLine.done < jobLine.total) {
    return (
      <span className="text-xs text-blue-700 dark:text-blue-400">
        Batch {jobLine.batch} van {jobLine.batches} loopt — {jobLine.done} van {jobLine.total}{' '}
        gekopieerd
      </span>
    );
  }

  // Empty on purpose while the panel is watching a job: everything it could say is already in
  // the body above it, and the alternative -- falling through to the picking lines -- would ask
  // the user to choose a destination for a job that is already filing into one.
  if (phase.kind === 'walking') return <span />;

  if (phase.kind === 'copying') {
    if (phase.paused) {
      return (
        <span className="text-xs text-amber-700 dark:text-amber-500">
          Gepauzeerd — {phase.job ? phase.job.done : phase.done}{' '}
          {(phase.job ? phase.job.done : phase.done) === 1 ? 'bericht' : 'berichten'} al
          gekopieerd
        </span>
      );
    }
    const doing =
      phase.phase === 'check'
        ? 'Controleren'
        : phase.phase === 'rollback'
          ? 'Ongedaan maken'
          : 'Kopiëren';
    const text =
      phase.total > 0 ? `${doing}: ${phase.done} van ${phase.total}` : `${doing}…`;
    return (
      <span className="text-xs text-neutral-500">
        {phase.job && `Batch ${phase.job.batch} van ${phase.job.batches} — `}
        {text}
        {phase.job && ` (${phase.job.done} van ${phase.job.total} in totaal)`}
      </span>
    );
  }
  if (phase.kind === 'stopped') {
    const r = phase.result;
    if (r.job) {
      return <span className="text-xs text-neutral-500">{jobEndText(r.job)}</span>;
    }
    if (r.error) {
      return <span className="text-xs text-red-600 dark:text-red-500">{r.error}</span>;
    }
    return (
      <span className="text-xs text-neutral-500">
        {r.mode === 'keep'
          ? `Gestopt, ${r.copied} ${r.copied === 1 ? 'bericht blijft' : 'berichten blijven'} gekopieerd`
          : r.rollback?.complete
            ? 'Gestopt en ongedaan gemaakt'
            : 'Gestopt, ongedaan maken niet overal gelukt'}
      </span>
    );
  }
  if (phase.kind === 'confirm') {
    const n = phase.duplicates.reduce((s, d) => s + d.count, 0);
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        {n === 1 ? 'Deze mail staat er al' : `${n} van deze berichten staan er al`}
        {phase.newCount > 0 &&
          `, ${phase.newCount} ${phase.newCount === 1 ? 'is' : 'zijn'} nieuw`}
      </span>
    );
  }
  if (phase.kind === 'done') {
    const r = phase.result;
    if (r.job) {
      return (
        <span
          className={`text-xs ${
            r.ok ? 'text-green-700 dark:text-green-500' : 'text-red-600 dark:text-red-500'
          }`}
        >
          {jobEndText(r.job)}
        </span>
      );
    }
    const bad = !r.ok || r.accounts.some((a) => a.error);
    const skipped = r.skipped > 0 ? `, ${r.skipped} overgeslagen` : '';
    return (
      <span className={`text-xs ${bad ? 'text-red-600 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
        {r.ok ? `${r.copied} gekopieerd${skipped}` : (r.error ?? 'Niets gekopieerd')}
        {r.warnings && r.warnings.length > 0 && (
          <span className="text-amber-700 dark:text-amber-500"> — {r.warnings.length === 1 ? '1 waarschuwing' : `${r.warnings.length} waarschuwingen`}</span>
        )}
      </span>
    );
  }

  if (phase.kind === 'orphan') {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        Vorige keer afgebroken — nog een keuze nodig
      </span>
    );
  }

  if (phase.kind === 'job') {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        Vorige keer afgebroken — nog een keuze nodig over &quot;{phase.job.label}&quot;
      </span>
    );
  }

  if (failures.length > 0) return <span />;
  if (savedCount === 0) {
    return <span className="text-xs text-neutral-500">Niets opgeslagen om te kopiëren</span>;
  }
  if (pickedCount === 0) {
    return <span className="text-xs text-neutral-500">Kies waar de mail naartoe moet</span>;
  }
  // A chip per mailbox rather than one total: with a rail there is always a mailbox out of
  // sight, and "naar 3 labels" does not say which ones are in it.
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs text-neutral-500">
      <span className="shrink-0">
        {savedCount} {savedCount === 1 ? 'bericht' : 'berichten'} naar
      </span>
      {chips.map((chip) => (
        <span
          key={chip.email}
          title={chip.email}
          className="shrink-0 whitespace-nowrap rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-neutral-700 dark:bg-white/10 dark:text-neutral-300"
        >
          <span className="font-medium">{localPart(chip.email)}</span>: {chip.label}
          {chip.extra > 0 && ` +${chip.extra}`}
        </span>
      ))}
    </div>
  );
}

function LabelIcon({ id, className = '' }: { id: string; className?: string }) {
  const kind = labelKind(id);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      className={`${ICON_COLOR[kind]} ${className}`}
      style={{ height: 15, width: 15, flexShrink: 0 }}
    >
      <title>{KIND_TITLE[kind]}</title>
      <path d={ICON_PATH[kind]} />
    </svg>
  );
}

/**
 * Why a drop saved nothing, in place of the label picker
 *
 * @param reasons one per distinct failure, as dropFailures collected them
 */
function DropFailure({ reasons }: { reasons: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        Er is niets opgeslagen, dus er is ook niets om te kopiëren.
      </p>
      <ul className="flex flex-col gap-1">
        {reasons.map((reason, i) => (
          <li key={i} className="text-sm text-red-600 dark:text-red-500">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Which mailboxes already hold the dragged mail, above the labels rather than after them
 *
 * @param notices one per mailbox the scan had something to say about
 * @param scanned how many messages the drag saved, which decides the wording
 */
function ExistingWarning({ notices, scanned }: { notices: ExistingNotice[]; scanned: number }) {
  const found = notices.filter((n) => !n.error);
  const unchecked = notices.filter((n) => n.error);
  return (
    <div className="mb-3 flex flex-col gap-2">
      {found.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {scanned === 1
              ? 'Deze mail staat al in een postvak dat je kunt kiezen.'
              : 'Een deel van deze mail staat al in een postvak dat je kunt kiezen.'}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {found.map((n) => (
              <li key={n.email} className="truncate text-xs text-amber-700 dark:text-amber-500">
                <span className="font-medium">{n.email}</span>
                {n.labels.length > 0 ? ` — ${n.labels.join(', ')}` : ' — staat er al'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unchecked.length > 0 && (
        <p className="text-xs text-neutral-500">
          Niet nagekeken op dubbelen:{' '}
          {unchecked.map((n) => `${n.email} (${n.error})`).join(', ')}
        </p>
      )}
    </div>
  );
}

function DuplicateWarning({
  duplicates,
  newCount,
  labelName,
}: {
  duplicates: MailDropCopyDuplicate[];
  newCount: number;
  labelName: (email: string, labelId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {newCount > 0
          ? `Een deel staat op de bestemming al. "Alleen de nieuwe kopiëren" slaat die over en zet
             ${newCount === 1 ? 'het ene nieuwe bericht' : `de ${newCount} nieuwe berichten`} erbij;
             "Alles kopiëren" maakt van de bestaande een tweede exemplaar.`
          : 'Alles wat je sleepte staat op de bestemming al. Kopiëren maakt er van elk een tweede exemplaar bij.'}
      </p>
      <ul className="flex flex-col gap-3">
        {duplicates.map((d) => (
          <li
            key={`${d.email}:${d.labelId}`}
            className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              <LabelIcon id={d.labelId} />
              <span className="truncate">
                {labelName(d.email, d.labelId)}
                <span className="font-normal text-neutral-500"> · {d.email}</span>
              </span>
            </div>
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
              {d.count === 1 ? 'staat er al' : `${d.count} berichten staan er al`}
            </div>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {d.subjects.map((s, i) => (
                <li key={i} className="truncate text-xs text-neutral-600 dark:text-neutral-400" title={s}>
                  {s}
                </li>
              ))}
              {d.count > d.subjects.length && (
                <li className="text-xs text-neutral-500">
                  en nog {d.count - d.subjects.length}…
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a paused copy asks the user to decide
 *
 * Shows how much has already landed, and in which mailboxes, since that is exactly what
 * makes the choice between the three actions an informed one -- along with the one fact that
 * makes "naar de prullenbak" a safe thing to offer: it is not gone, it is recoverable from
 * Gmail's own trash for another 30 days.
 *
 * @param phase the paused copying phase, for its counts
 * @param job the batched job this copy is one batch of, absent for a plain drag
 * @param onKeepCopying resumes exactly where the copy paused
 * @param onStopAndKeep stops and leaves what already landed where it is
 * @param onStopAndTrashBatch stops and undoes what this batch landed
 * @param onStopAndTrashJob stops and undoes every batch of the job
 */
function StopConfirm({
  phase,
  job,
  onKeepCopying,
  onStopAndKeep,
  onStopAndTrashBatch,
  onStopAndTrashJob,
}: {
  phase: CopyProgress;
  /** Present only during a batched job, which is the only case where the two rollback scopes
   * mean different things. A plain drag is one batch and gets the two buttons it always had. */
  job?: { batch: number; batches: number; done: number; total: number };
  onKeepCopying: () => void;
  onStopAndKeep: () => void;
  onStopAndTrashBatch: () => void;
  onStopAndTrashJob: () => void;
}) {
  const rows = phase.byMailbox ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Kopiëren gepauzeerd
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {phase.done === 0
            ? 'Er is nog niets gekopieerd.'
            : phase.done === 1
              ? 'Er staat al 1 bericht in:'
              : `Er staan al ${phase.done} berichten in:`}
        </p>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => (
            <li key={r.email} className="truncate text-sm text-neutral-700 dark:text-neutral-300">
              <span className="font-medium">{r.email}</span>:{' '}
              {r.copied} {r.copied === 1 ? 'bericht' : 'berichten'}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={onKeepCopying}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Kopiëren voortzetten
        </button>
        <button
          onClick={onStopAndKeep}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          Stoppen, wat er al staat laten staan
        </button>
        <button
          onClick={onStopAndTrashBatch}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          {job
            ? `Stoppen en alleen batch ${job.batch} naar de prullenbak`
            : 'Stoppen en naar de prullenbak verplaatsen'}
        </button>
        {job && job.batch > 1 && (
          <button
            onClick={onStopAndTrashJob}
            className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
          >
            Stoppen en alle {job.done} gekopieerde berichten naar de prullenbak
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Naar de prullenbak is niet definitief: Gmail bewaart het daar nog 30 dagen.
      </p>
      {job && job.batch > 1 && (
        <p className="text-xs text-neutral-500">
          Alles terugdraaien duurt even: {job.done} berichten uit de prullenbak halen is nog een
          paar minuten werk.
        </p>
      )}
    </div>
  );
}

/**
 * The same keep-or-rollback choice a live stop dialog asks, for a copy this app never heard
 * the end of -- the app was closed or crashed before the question was answered
 *
 * @param orphan
 * @param onDecide
 */
function OrphanDecision({
  orphan,
  onDecide,
}: {
  orphan: PendingOrphan;
  onDecide: (runId: string, mode: 'keep' | 'rollback') => void;
}) {
  const total = orphan.byMailbox.reduce((s, m) => s + m.inserted, 0);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Vorige keer afgebroken
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {total === 0
            ? 'Er is toen nog niets gekopieerd.'
            : total === 1
              ? 'Er stond al 1 bericht in:'
              : `Er stonden al ${total} berichten in:`}
        </p>
      </div>
      {orphan.byMailbox.some((m) => m.inserted > 0) && (
        <ul className="flex flex-col gap-0.5">
          {orphan.byMailbox
            .filter((m) => m.inserted > 0)
            .map((m) => (
              <li key={m.email} className="truncate text-sm text-neutral-700 dark:text-neutral-300">
                <span className="font-medium">{m.email}</span>:{' '}
                {m.inserted} {m.inserted === 1 ? 'bericht' : 'berichten'}
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onDecide(orphan.runId, 'keep')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Laten staan
        </button>
        <button
          onClick={() => onDecide(orphan.runId, 'rollback')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          Naar de prullenbak verplaatsen
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Naar de prullenbak is niet definitief: Gmail bewaart het daar nog 30 dagen. Dit wordt op
        de achtergrond afgemaakt -- je kunt intussen verder.
      </p>
    </div>
  );
}

/**
 * What a job this app never heard the end of asks the user to decide
 *
 * @param job
 * @param onDecide
 */
function JobDecision({
  job,
  onDecide,
}: {
  job: PendingJob;
  onDecide: (jobId: string, choice: 'continue' | 'keep' | 'rollback') => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Vorige keer afgebroken
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          Van label “{job.label}” zijn {job.done} van {job.total} berichten gekopieerd, tot batch{' '}
          {job.batch} van {job.batches}.
        </p>
      </div>
      {job.mode === 'all' && (
        <p className="text-sm text-amber-700 dark:text-amber-500">
          Deze klus kopieert ook berichten die er al staan, zoals je toen gekozen hebt. Verdergaan
          betekent dat batch {job.batch} deels dubbel komt te staan.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onDecide(job.jobId, 'continue')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Verdergaan met batch {job.batch}
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'keep')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          Laten staan, klus afsluiten
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'rollback')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          Alle {job.done} berichten naar de prullenbak
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Naar de prullenbak is niet definitief: Gmail bewaart het daar nog 30 dagen.
      </p>
    </div>
  );
}

/**
 * What became of a stopped run
 *
 * @param result
 */
function StoppedReport({ result }: { result: StoppedResult }) {
  if (result.error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {result.mode === 'keep' ? 'Gestopt, maar niet afgerond' : 'Ongedaan maken niet gelukt'}
        </p>
        <p className="text-sm text-red-600 dark:text-red-500">{result.error}</p>
        <WarningsList warnings={result.warnings} />
      </div>
    );
  }
  if (result.mode === 'keep') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-neutral-900 dark:text-neutral-100">
          Gestopt. {result.copied === 1 ? '1 bericht blijft' : `${result.copied} berichten blijven`}{' '}
          gekopieerd.
        </p>
        <WarningsList warnings={result.warnings} />
      </div>
    );
  }
  const rollback = result.rollback;
  // A mailbox the sweep cannot reach at all -- a delegated target with no scope for this, or a
  // token that could not be had. Retrying will not fix either, so this is the one case that
  // still needs the user, the same as it always has.
  const refusedMailboxes = rollback?.mailboxes.filter((m) => m.refused) ?? [];
  // Not refused, simply not confirmed empty yet -- the marker sweep's own retry budget ran out
  // before Gmail's listing caught up. There is nothing ambiguous about it any more: everything
  // this run created carries the marker, so what is left is exactly what still needs sweeping,
  // and the next start does that on its own without being asked.
  const pendingMailboxes =
    rollback?.mailboxes.filter((m) => !m.converged && !m.refused) ?? [];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-900 dark:text-neutral-100">
        {rollback?.complete
          ? 'Ongedaan gemaakt. Alles wat al gekopieerd was staat weer in de prullenbak.'
          : 'Ongedaan maken is niet overal gelukt.'}
      </p>
      <WarningsList warnings={result.warnings} />
      {refusedMailboxes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {refusedMailboxes.map((m) => (
            <li key={m.email} className="text-sm text-amber-700 dark:text-amber-500">
              <span className="font-medium">{m.email}</span>:{' '}
              {m.refused === 'permission'
                ? 'geen rechten om te verwijderen, staat er nog'
                : 'kon niet worden geopend, staat er nog'}
            </li>
          ))}
        </ul>
      )}
      {pendingMailboxes.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
            {pendingMailboxes.length === 1
              ? 'Opruimen in 1 postvak nog niet klaar.'
              : `Opruimen in ${pendingMailboxes.length} postvakken nog niet klaar.`}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {pendingMailboxes.map((m) => (
              <li key={m.email} className="text-xs text-amber-700 dark:text-amber-500">
                {m.email}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-500">
            Wordt automatisch afgemaakt zodra de app weer opstart — hier hoeft niets voor
            gedaan te worden.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Whatever did not itself succeed alongside an otherwise successful outcome
 *
 * Never rendered in place of the report it sits beside -- only next to it, since none of
 * these mean the copy or the stop itself failed. Dropping this silently is the defect it
 * exists to close: an unclosed journal reads as a crash to the next start.
 *
 * @param warnings
 */
function WarningsList({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
      <ul className="flex flex-col gap-0.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs text-amber-700 dark:text-amber-500">
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The body of the panel while the driver walks a job
 *
 * One panel for the whole walk: which label is being copied, where it is going, and how far the
 * job has got. No list of this batch's conversations and no batch report -- those are what made
 * four batches look like four separate jobs.
 *
 * @param panel what main said about the job
 * @param line how far it has got, absent for the moment between two batches
 */
function JobRunning({ panel, line }: { panel: JobPanel; line: JobLine | null }) {
  const { into, progress } = panelBody({ job: line, targets: panel.targets });
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {panel.label}
      </p>
      {into && <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">{into}</p>}
      <p className="text-sm text-blue-700 dark:text-blue-400">{progress || 'Bezig…'}</p>
    </div>
  );
}

/**
 * The body of the panel once a job is over
 *
 * Stands in for CopyReport and StoppedReport, which both answer for one copy's mailboxes: a job
 * is many copies and the number that matters is its own.
 *
 * @param end
 */
function JobReport({ end }: { end: JobEnd }) {
  const { into } = panelBody({ job: null, targets: end.targets });
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {end.label}
      </p>
      {into && <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">{into}</p>}
      <p
        className={`text-sm ${
          end.outcome === 'completed'
            ? 'text-green-700 dark:text-green-500'
            : end.outcome === 'stuck'
              ? 'text-red-600 dark:text-red-500'
              : 'text-neutral-700 dark:text-neutral-300'
        }`}
      >
        {jobEndText(end)}
      </p>
      <p className="text-xs text-neutral-500">
        {end.copiedBatches} van {end.batches} batches gekopieerd
      </p>
    </div>
  );
}

function CopyReport({ result }: { result: DoneResult }) {
  if (result.error) {
    return <p className="text-sm text-red-600 dark:text-red-500">{result.error}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <WarningsList warnings={result.warnings} />
      <ul className="flex flex-col gap-2">
        {result.accounts.map((a) => (
          <li key={a.email} className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {a.email}
            </span>
            <span
              className={`text-xs ${
                a.error ? 'text-red-600 dark:text-red-500' : 'text-neutral-500'
              }`}
            >
              {a.error
                ? `${a.copied} van ${a.total} gekopieerd — ${a.error}`
                : `${a.copied} ${a.copied === 1 ? 'bericht' : 'berichten'} gekopieerd` +
                  (a.skipped > 0 ? `, ${a.skipped} stond er al` : '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}


//===========================
// Icon tables
//===========================

const ICON_PATH: Record<LabelKind, string> = {
  inbox:
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z',
  starred: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  important:
    'M3.5 18.99l11 .01c.67 0 1.27-.33 1.63-.84L20.5 12l-4.37-6.16c-.36-.51-.96-.84-1.63-.84l-11 .01L8 12l-4.5 6.99z',
  user: 'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
};

const ICON_COLOR: Record<LabelKind, string> = {
  inbox: 'text-blue-600 dark:text-blue-400',
  starred: 'text-amber-500 dark:text-amber-400',
  important: 'text-orange-500 dark:text-orange-400',
  user: 'text-neutral-400 dark:text-neutral-500',
};

const KIND_TITLE: Record<LabelKind, string> = {
  inbox: 'Postvak',
  starred: 'Met ster',
  important: 'Belangrijk',
  user: 'Eigen label',
};
