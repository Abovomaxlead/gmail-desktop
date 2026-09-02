'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MailDropItem,
  MailDropCopyResult,
  MailDropCopyDuplicate,
  MailDropCopyMode,
  MailDropExisting,
  MailDropPreview,
} from '../MailDropModal';
import { recentFor, type RecentLabelUse } from '../recent-labels';
import { dropFailures } from '../../lib/drop-outcome';
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
  type PickedChip,
} from '../mailbox-rail';
import { filterLabels } from '../label-search';
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
} from '../job-panel';
import {
  type JobEnd,
  type JobLine,
  type JobPanel,
  type CopyProgress,
  type PendingOrphan,
  type PendingJob,
  type StoppedResult,
  type MailDropTree,
} from '../../lib/maildrop-copy';
import { getStrings, type UiStrings } from '../strings';
import {
  TOP_LEVEL,
  MailboxRail,
  LabelPane,
  LabelIcon,
  type AccountLabels,
} from './panel-parts';


//===========================
// Types
//===========================

/** MailDropCopyResult widened with the one field main now adds when the copy itself fully
 * succeeded but writing the record of that (the audit log, or the journal's closing line)
 * did not. */
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
  // that phase belongs to this window's own copy action and is left by the promise it awaits,
  // and the driver's copy has no such promise -- forcing it would leave the panel stuck there
  // with its close button disabled once the job ended. Deliberately not 'picking' either: see
  // previewMayPick. The way out is a job end, which phaseAfterJobEnd turns into 'done' or
  // 'stopped'. 'walking' rather than 'job', which is the orphan-job offer above it.
  | { kind: 'walking'; panel: JobPanel; progress?: CopyProgress };


//===========================
// Constants
//===========================

/** Before the scan has answered, and after one that could not run. The serial is below every
 * drag, so the first real answer always wins. */
const NOTHING_FOUND_YET: MailDropExisting = {
  accounts: [],
  scanned: 0,
  serial: -1,
  answered: 0,
};


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
 * @param S the active string set
 * @returns 'done' or 'stopped' -- never the job phase, which has no close button of its own
 */
function phaseFromJobEnd(end: JobEnd, S: UiStrings): Phase {
  const at = phaseAfterJobEnd(end, S);
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
  const [tree, setTree] = useState<MailDropTree | null>(null);
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
  // This window has no prefs of its own, so the language rides on the preview payload the same
  // way it does for the toast window.
  const [lang, setLang] = useState<{ locale: 'en' | 'nl'; reneMode: boolean }>({
    locale: 'en',
    reneMode: false,
  });
  const S = getStrings(lang.locale, lang.reneMode);
  // The mount-once effect below reaches text through this ref rather than through `S` itself,
  // since its closures are set up once and would otherwise keep speaking whatever language was
  // active when the window opened.
  const sRef = useRef(S);
  useEffect(() => {
    sRef.current = S;
  }, [S]);

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
    void bridge.getMailDropPreview().then((got: MailDropPreview) => {
      const { items: i, tree: t, panel, job, locale, reneMode } = got;
      setLang({ locale: locale ?? 'en', reneMode: reneMode ?? false });
      if (i.length > 0) setItems(i);
      setTree(t ?? null);
      // Reopened halfway through a job: without this the window would come back in its picking
      // phase, offering the copy button for mail the driver has in flight. Refused by main, but
      // the offer itself is the thing that must not be there.
      if (panel) {
        if (job) setJobLine(job);
        setPhase((cur) => (cur.kind === 'picking' ? { kind: 'walking', panel } : cur));
      }
    });
    // Every drop reloads, including the first: skipping it on the assumption that mounting
    // always means a fresh drop left a stale mailbox list on screen whenever a remount fell
    // between two drops instead.
    bridge.onMailDropPreview((p: MailDropPreview) => {
      const { items: i, tree: t, panel, job, locale, reneMode } = p;
      setItems(i);
      setTree(t ?? null);
      setLang({ locale: locale ?? 'en', reneMode: reneMode ?? false });
      // A driven batch is a job showing what it is about to copy itself, not a new drag: its
      // list is still worth updating, but returning to `picking` here would offer the copy
      // button again for mail the driver already has in flight -- see previewMayPick.
      if (!previewMayPick(p)) {
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
    bridge
      .getPendingOrphan()
      .then((orphan) => {
        if (orphan) {
          setPhase((cur) => (cur.kind === 'picking' ? { kind: 'orphan', orphan } : cur));
          return;
        }
        // Only when the run-level offer had nothing waiting: two offers stacked on one modal is
        // a queue nobody asked for, and that one is the more urgent since it holds mail under a
        // marker.
        return bridge.getPendingJob().then((job) => {
          if (job) setPhase((cur) => (cur.kind === 'picking' ? { kind: 'job', job } : cur));
        });
      })
      .catch(() => {});
    bridge.onMailDropExisting((e) => setExisting((cur) => newerExisting(cur, e)));
    bridge.onMailDropCopyProgress((p: CopyProgress) => {
      // Kept beside the phase rather than folded into it. A batch the driver started never puts
      // this window into `copying` -- only its own copy action does that -- so before this,
      // progress for every batch after the first was simply dropped and the window sat on the
      // previous batch's result. Forcing the phase instead would leave it stuck there when the
      // job ends, with the close button disabled and nothing left to send.
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
        setPhase(phaseFromJobEnd(end, sRef.current));
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

  const controlCopy = (action: JobControlAction) => window.desktop?.controlMailDropCopy(action);

  // Awaited and reported instead of fired and forgotten, so a stop the gate refused is visible
  // rather than silent -- what to report is controlFailureText's rule, so that a refused pause
  // between two batches stays the non-event it is.
  const ask = async (action: JobControlAction) => {
    setControlError(null);
    let answer: { ok: boolean; error?: string } | undefined;
    try {
      answer = await controlCopy(action);
    } catch (e) {
      answer = { ok: false, error: (e as Error)?.message };
    }
    setControlError(controlFailureText(action, answer, S));
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
    void window.desktop?.decideOrphanRun(runId, mode);
  };

  const decideJob = (jobId: string, choice: 'continue' | 'keep' | 'rollback') => {
    setPhase({ kind: 'picking' });
    void window.desktop?.decideJobRun(jobId, choice);
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
  const notices = useMemo(
    () => existingNotices(existing.accounts, accounts ?? []),
    [existing.accounts, accounts],
  );
  const rows = useMemo(
    () => mailboxRows(accounts ?? [], picked, existing.accounts, search),
    [accounts, picked, existing.accounts, search],
  );
  const chips = useMemo(() => pickedChips(picked, accounts ?? []), [picked, accounts]);
  const openMailbox = accounts?.find((a) => a.email === active) ?? accounts?.[0] ?? null;
  const shownLabels = useMemo(
    () =>
      openMailbox ? filterLabels(openMailbox.labels, search, picked[openMailbox.email] ?? []) : [],
    [openMailbox, search, picked],
  );

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
      ? S.mdTopLevel
      : accounts?.find((a) => a.email === email)?.labels.find((l) => l.id === labelId)?.name ??
        labelId;

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        // Closing the panel during a job does not stop the job -- the driver owns that copy, and
        // the footer's cancel button is the way to end it. Only this window's own copy holds the
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
              {panelTitle({ items: n, job: shownJob, failed: failures.length > 0 }, S)}
            </h1>
            <button
              // Copying no longer disables this: it pauses and asks instead of doing nothing.
              // Once the dialog itself is open a second click has nowhere new to go, so it is
              // disabled only for that one moment.
              onClick={phase.kind === 'copying' ? requestStop : close}
              disabled={phase.kind === 'copying' && stopDialogOpen}
              // 'Close' is the wrong word here while copying -- this pauses and asks, it does
              // not close anything. Named the same as the button below it, since it does exactly
              // what that button does.
              aria-label={phase.kind === 'copying' ? S.mdCancel : S.close}
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
              <LabelSearch value={search} onChange={setSearch} S={S} />
            </div>
          )}

          {phase.kind === 'picking' && failures.length === 0 && notices.length > 0 && (
            <div className="shrink-0 border-b border-black/5 px-5 pt-3 dark:border-white/10">
              <ExistingWarning notices={notices} scanned={existing.scanned} S={S} />
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
                S={S}
              />
            </div>
          ) : phase.kind === 'walking' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <JobRunning panel={phase.panel} line={jobLine} S={S} />
            </div>
          ) : phase.kind === 'stopped' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {phase.result.job ? (
                <JobReport end={phase.result.job} S={S} />
              ) : (
                <StoppedReport result={phase.result} S={S} />
              )}
            </div>
          ) : phase.kind === 'done' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {phase.result.job ? (
                <JobReport end={phase.result.job} S={S} />
              ) : (
                <CopyReport result={phase.result} S={S} />
              )}
            </div>
          ) : phase.kind === 'confirm' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DuplicateWarning
                duplicates={phase.duplicates}
                newCount={phase.newCount}
                labelName={labelName}
                S={S}
              />
            </div>
          ) : phase.kind === 'orphan' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <OrphanDecision orphan={phase.orphan} onDecide={decideOrphan} S={S} />
            </div>
          ) : phase.kind === 'job' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <JobDecision job={phase.job} onDecide={decideJob} S={S} />
            </div>
          ) : failures.length > 0 ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DropFailure reasons={failures} S={S} />
            </div>
          ) : accounts === null ? (
            <div className="flex min-h-0 flex-1">
              <RailPlaceholder />
              <p className="flex-1 px-5 py-4 text-sm text-neutral-500">{S.mdLoadingLabels}</p>
            </div>
          ) : accounts.length === 0 ? (
            <p className="flex-1 px-5 py-4 text-sm text-neutral-500">{S.mdNoOtherAccount}</p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <MailboxRail rows={rows} active={openMailbox?.email ?? ''} onSelect={setActive} S={S} />
              {openMailbox && (
                <LabelPane
                  account={openMailbox}
                  shown={shownLabels}
                  search={search}
                  recent={recentFor(recent, openMailbox.email, openMailbox.labels)}
                  picked={picked[openMailbox.email] ?? []}
                  disabled={phase.kind === 'copying'}
                  tree={takesTree(openMailbox.email) ? tree : null}
                  treeOffered={tree !== null}
                  onFlatMode={(off) => {
                    setFlatMode((cur) => ({ ...cur, [openMailbox.email]: off }));
                    setPicked((p) => ({ ...p, [openMailbox.email]: [] }));
                  }}
                  countExisting={(labelId) =>
                    existingCount(existing.accounts, openMailbox.email, labelId)
                  }
                  onToggle={(labelId) => toggle(openMailbox.email, labelId)}
                  S={S}
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
                aria-label={S.mdDismissNotice}
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
              S={S}
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
                {S.mdCancel}
              </button>
            ) : phase.kind === 'done' || phase.kind === 'stopped' || failures.length > 0 ? (
              <button
                onClick={close}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                {S.close}
              </button>
            ) : phase.kind === 'orphan' || phase.kind === 'job' ? null : phase.kind === 'confirm' ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setPhase({ kind: 'picking' })}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
                >
                  {S.mdCancel}
                </button>
                <button
                  onClick={() => void copy('all')}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
                >
                  {S.mdCopyAll}
                </button>
                {phase.newCount > 0 && (
                  <button
                    onClick={() => void copy('new')}
                    className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                  >
                    {S.mdCopyNew(phase.newCount)}
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
                {S.mdCopy}
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
 * The box that narrows the labels of every mailbox at once
 *
 * One box rather than one per mailbox: the rail counts the matches per mailbox, so a search
 * says where the label you mean lives instead of only filtering what is already open.
 *
 * @param value
 * @param onChange
 * @param S the active string set
 */
function LabelSearch({
  value,
  onChange,
  S,
}: {
  value: string;
  onChange: (v: string) => void;
  S: UiStrings;
}) {
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
        placeholder={S.mdSearchPlaceholder}
        aria-label={S.mdSearchAria}
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
          aria-label={S.mdSearchClear}
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
  S,
}: {
  phase: Phase;
  jobLine: CopyProgress['job'] | null;
  pickedCount: number;
  savedCount: number;
  failures: string[];
  chips: PickedChip[];
  S: UiStrings;
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
        {S.mdBatchRunning(jobLine.batch, jobLine.batches, jobLine.done, jobLine.total)}
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
          {S.mdPaused(phase.job ? phase.job.done : phase.done)}
        </span>
      );
    }
    const doing =
      phase.phase === 'check' ? S.mdPhaseCheck : phase.phase === 'rollback' ? S.mdPhaseRollback : S.mdPhaseCopy;
    const text = phase.total > 0 ? S.mdPhaseProgress(doing, phase.done, phase.total) : S.mdPhaseWorking(doing);
    return (
      <span className="text-xs text-neutral-500">
        {phase.job && S.mdBatchPrefix(phase.job.batch, phase.job.batches)}
        {text}
        {phase.job && S.mdJobTotalSuffix(phase.job.done, phase.job.total)}
      </span>
    );
  }
  if (phase.kind === 'stopped') {
    const r = phase.result;
    if (r.job) {
      return <span className="text-xs text-neutral-500">{jobEndText(r.job, S)}</span>;
    }
    if (r.error) {
      return <span className="text-xs text-red-600 dark:text-red-500">{r.error}</span>;
    }
    return (
      <span className="text-xs text-neutral-500">
        {r.mode === 'keep'
          ? S.mdStoppedKept(r.copied)
          : r.rollback?.complete
            ? S.mdStoppedUndone
            : S.mdStoppedUndonePartial}
      </span>
    );
  }
  if (phase.kind === 'confirm') {
    const n = phase.duplicates.reduce((s, d) => s + d.count, 0);
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        {S.mdDupAlready(n)}
        {phase.newCount > 0 && S.mdDupNewSuffix(phase.newCount)}
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
          {jobEndText(r.job, S)}
        </span>
      );
    }
    const bad = !r.ok || r.accounts.some((a) => a.error);
    const skipped = r.skipped > 0 ? S.mdSkippedSuffix(r.skipped) : '';
    return (
      <span className={`text-xs ${bad ? 'text-red-600 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
        {r.ok ? `${S.mdCopiedCount(r.copied)}${skipped}` : (r.error ?? S.mdNothingCopied)}
        {r.warnings && r.warnings.length > 0 && (
          <span className="text-amber-700 dark:text-amber-500"> — {S.mdWarningCount(r.warnings.length)}</span>
        )}
      </span>
    );
  }

  if (phase.kind === 'orphan') {
    return <span className="text-xs text-amber-700 dark:text-amber-500">{S.mdOrphanPending}</span>;
  }

  if (phase.kind === 'job') {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        {S.mdJobPending(phase.job.label)}
      </span>
    );
  }

  if (failures.length > 0) return <span />;
  if (savedCount === 0) {
    return <span className="text-xs text-neutral-500">{S.mdNothingSaved}</span>;
  }
  if (pickedCount === 0) {
    return <span className="text-xs text-neutral-500">{S.mdChooseDestination}</span>;
  }
  // A chip per mailbox rather than one total: with a rail there is always a mailbox out of
  // sight, and a total label alone does not say which ones are in it.
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs text-neutral-500">
      <span className="shrink-0">{S.mdMessagesTo(savedCount)}</span>
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

/**
 * Why a drop saved nothing, in place of the label picker
 *
 * @param reasons one per distinct failure, as dropFailures collected them
 * @param S the active string set
 */
function DropFailure({ reasons, S }: { reasons: string[]; S: UiStrings }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {S.mdDropFailedTitle}
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
 * @param S the active string set
 */
function ExistingWarning({
  notices,
  scanned,
  S,
}: {
  notices: ExistingNotice[];
  scanned: number;
  S: UiStrings;
}) {
  const found = notices.filter((n) => !n.error);
  const unchecked = notices.filter((n) => n.error);
  return (
    <div className="mb-3 flex flex-col gap-2">
      {found.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {scanned === 1 ? S.mdExistingOne : S.mdExistingSome}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {found.map((n) => (
              <li key={n.email} className="truncate text-xs text-amber-700 dark:text-amber-500">
                <span className="font-medium">{n.email}</span>
                {n.labels.length > 0 ? ` — ${n.labels.join(', ')}` : ` — ${S.mdExistingAlready}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unchecked.length > 0 && (
        <p className="text-xs text-neutral-500">
          {S.mdExistingUnchecked(unchecked.map((n) => `${n.email} (${n.error})`).join(', '))}
        </p>
      )}
    </div>
  );
}

function DuplicateWarning({
  duplicates,
  newCount,
  labelName,
  S,
}: {
  duplicates: MailDropCopyDuplicate[];
  newCount: number;
  labelName: (email: string, labelId: string) => string;
  S: UiStrings;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {newCount > 0 ? S.mdDupIntroNew(newCount) : S.mdDupIntroAll}
      </p>
      <ul className="flex flex-col gap-3">
        {duplicates.map((d) => (
          <li
            key={`${d.email}:${d.labelId}`}
            className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              <LabelIcon id={d.labelId} S={S} />
              <span className="truncate">
                {labelName(d.email, d.labelId)}
                <span className="font-normal text-neutral-500"> · {d.email}</span>
              </span>
            </div>
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
              {S.mdDupCount(d.count)}
            </div>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {d.subjects.map((s, i) => (
                <li key={i} className="truncate text-xs text-neutral-600 dark:text-neutral-400" title={s}>
                  {s}
                </li>
              ))}
              {d.count > d.subjects.length && (
                <li className="text-xs text-neutral-500">{S.mdAndMore(d.count - d.subjects.length)}</li>
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
 * makes moving it to the trash a safe thing to offer: it is not gone, it is recoverable from
 * Gmail's own trash for another 30 days.
 *
 * @param phase the paused copying phase, for its counts
 * @param job the batched job this copy is one batch of, absent for a plain drag
 * @param onKeepCopying resumes exactly where the copy paused
 * @param onStopAndKeep stops and leaves what already landed where it is
 * @param onStopAndTrashBatch stops and undoes what this batch landed
 * @param onStopAndTrashJob stops and undoes every batch of the job
 * @param S the active string set
 */
function StopConfirm({
  phase,
  job,
  onKeepCopying,
  onStopAndKeep,
  onStopAndTrashBatch,
  onStopAndTrashJob,
  S,
}: {
  phase: CopyProgress;
  /** Present only during a batched job, which is the only case where the two rollback scopes
   * mean different things. A plain drag is one batch and gets the two buttons it always had. */
  job?: { batch: number; batches: number; done: number; total: number };
  onKeepCopying: () => void;
  onStopAndKeep: () => void;
  onStopAndTrashBatch: () => void;
  onStopAndTrashJob: () => void;
  S: UiStrings;
}) {
  const rows = phase.byMailbox ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {S.mdPausedTitle}
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {phase.done === 0 ? S.mdPausedNone : S.mdPausedSoFar(phase.done)}
        </p>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => (
            <li key={r.email} className="truncate text-sm text-neutral-700 dark:text-neutral-300">
              <span className="font-medium">{r.email}</span>: {S.mdMessages(r.copied)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={onKeepCopying}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          {S.mdResume}
        </button>
        <button
          onClick={onStopAndKeep}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          {S.mdStopKeep}
        </button>
        <button
          onClick={onStopAndTrashBatch}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          {job ? S.mdStopTrashBatch(job.batch) : S.mdStopTrash}
        </button>
        {job && job.batch > 1 && (
          <button
            onClick={onStopAndTrashJob}
            className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
          >
            {S.mdStopTrashJob(job.done)}
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-500">{S.mdTrashNote}</p>
      {job && job.batch > 1 && <p className="text-xs text-neutral-500">{S.mdRollbackSlow(job.done)}</p>}
    </div>
  );
}

/**
 * The same keep-or-rollback choice a live stop dialog asks, for a copy this app never heard
 * the end of -- the app was closed or crashed before the question was answered
 *
 * @param orphan
 * @param onDecide
 * @param S the active string set
 */
function OrphanDecision({
  orphan,
  onDecide,
  S,
}: {
  orphan: PendingOrphan;
  onDecide: (runId: string, mode: 'keep' | 'rollback') => void;
  S: UiStrings;
}) {
  const total = orphan.byMailbox.reduce((s, m) => s + m.inserted, 0);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {S.mdInterruptedTitle}
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {total === 0 ? S.mdOrphanNone : S.mdOrphanSoFar(total)}
        </p>
      </div>
      {orphan.byMailbox.some((m) => m.inserted > 0) && (
        <ul className="flex flex-col gap-0.5">
          {orphan.byMailbox
            .filter((m) => m.inserted > 0)
            .map((m) => (
              <li key={m.email} className="truncate text-sm text-neutral-700 dark:text-neutral-300">
                <span className="font-medium">{m.email}</span>: {S.mdMessages(m.inserted)}
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onDecide(orphan.runId, 'keep')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          {S.mdKeep}
        </button>
        <button
          onClick={() => onDecide(orphan.runId, 'rollback')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          {S.mdMoveToTrash}
        </button>
      </div>
      <p className="text-xs text-neutral-500">{S.mdTrashNoteBackground}</p>
    </div>
  );
}

/**
 * What a job this app never heard the end of asks the user to decide
 *
 * @param job
 * @param onDecide
 * @param S the active string set
 */
function JobDecision({
  job,
  onDecide,
  S,
}: {
  job: PendingJob;
  onDecide: (jobId: string, choice: 'continue' | 'keep' | 'rollback') => void;
  S: UiStrings;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {S.mdInterruptedTitle}
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          {S.mdJobInterrupted(job.label, job.done, job.total, job.batch, job.batches)}
        </p>
      </div>
      {job.mode === 'all' && (
        <p className="text-sm text-amber-700 dark:text-amber-500">
          {S.mdJobDuplicateWarning(job.batch)}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onDecide(job.jobId, 'continue')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-left text-sm font-medium text-white transition hover:bg-blue-700"
        >
          {S.mdJobContinue(job.batch)}
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'keep')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-neutral-700 transition hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
        >
          {S.mdJobKeep}
        </button>
        <button
          onClick={() => onDecide(job.jobId, 'rollback')}
          className="rounded-lg px-4 py-2 text-left text-sm font-medium text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-500"
        >
          {S.mdJobTrash(job.done)}
        </button>
      </div>
      <p className="text-xs text-neutral-500">{S.mdTrashNote}</p>
    </div>
  );
}

/**
 * What became of a stopped run
 *
 * @param result
 * @param S the active string set
 */
function StoppedReport({ result, S }: { result: StoppedResult; S: UiStrings }) {
  if (result.error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {result.mode === 'keep' ? S.mdStoppedIncomplete : S.mdRollbackFailed}
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
          {S.mdStoppedKeptSentence(result.copied)}
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
        {rollback?.complete ? S.mdRollbackDone : S.mdRollbackPartial}
      </p>
      <WarningsList warnings={result.warnings} />
      {refusedMailboxes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {refusedMailboxes.map((m) => (
            <li key={m.email} className="text-sm text-amber-700 dark:text-amber-500">
              <span className="font-medium">{m.email}</span>:{' '}
              {m.refused === 'permission' ? S.mdRefusedPermission : S.mdRefusedAuth}
            </li>
          ))}
        </ul>
      )}
      {pendingMailboxes.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
            {S.mdSweepPending(pendingMailboxes.length)}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {pendingMailboxes.map((m) => (
              <li key={m.email} className="text-xs text-amber-700 dark:text-amber-500">
                {m.email}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-500">{S.mdSweepResumes}</p>
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
 * @param S the active string set
 */
function JobRunning({ panel, line, S }: { panel: JobPanel; line: JobLine | null; S: UiStrings }) {
  const { into, progress } = panelBody({ job: line, targets: panel.targets }, S);
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {panel.label}
      </p>
      {into && <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">{into}</p>}
      <p className="text-sm text-blue-700 dark:text-blue-400">{progress || S.mdWorking}</p>
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
 * @param S the active string set
 */
function JobReport({ end, S }: { end: JobEnd; S: UiStrings }) {
  const { into } = panelBody({ job: null, targets: end.targets }, S);
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
        {jobEndText(end, S)}
      </p>
      <p className="text-xs text-neutral-500">{S.mdBatchesCopied(end.copiedBatches, end.batches)}</p>
    </div>
  );
}

function CopyReport({ result, S }: { result: DoneResult; S: UiStrings }) {
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
                ? S.mdAccountFailed(a.copied, a.total, a.error)
                : S.mdAccountCopied(a.copied) + (a.skipped > 0 ? S.mdAccountSkipped(a.skipped) : '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
