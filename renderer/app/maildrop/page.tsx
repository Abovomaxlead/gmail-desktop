'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MailDropExisting,
  MailDropPreview,
  MailDropPreviewItem,
} from '../../../electron/core/ipc';
import type { CopyMode } from '../../../electron/mail/copy/mail-copy';
import { recentFor, type RecentLabelUse } from '../../lib/recent-labels';
import { dropFailures } from '../../lib/drop-outcome';
import { failedRowIndexes } from '../../lib/failure-list';
import {
  existingCount,
  existingNotices,
  newerExisting,
} from '../existing-labels';
import {
  mailboxRows,
  pickedChips,
  firstPickable,
} from '../mailbox-rail';
import { filterLabels } from '../../lib/label-search';
import { parentInsideTree } from '../../../electron/mail/copy/label-tree';
import { treeTopPlace } from '../tree-place';
import { labelKind } from '../label-kind';
import {
  previewMayPick,
  panelBelongsToJob,
  panelMayWalk,
  phaseAfterJobEnd,
  controlFailureText,
  type JobControlAction,
  panelTitle,
} from '../job-panel';
import {
  type JobEnd,
  type JobLine,
  type CopyProgress,
  type StoppedResult,
  type MailDropTree,
} from '../../lib/maildrop-copy';
import { getStrings, type UiStrings } from '../strings';
import {
  TOP_LEVEL,
  MailboxRail,
  LabelPane,
  type AccountLabels,
} from './panel-parts';
import {
  RailPlaceholder,
  LabelSearch,
  Status,
  DropFailure,
  ExistingWarning,
  DuplicateWarning,
  StopConfirm,
  OrphanDecision,
  JobDecision,
  StoppedReport,
  JobRunning,
  JobReport,
  CopyReport,
  PullMisses,
  type Phase,
  type DoneResult,
  type RetryKind,
} from './report-parts';


//===========================
// Types
//===========================
/** What copyMailDrop actually resolves to now. `stopped?: false` is added purely so the two
 * halves of the union share a discriminant -- DoneResult itself carries no such flag -- which
 * is what lets `if (result.stopped)` narrow cleanly below. */
type CopyOrStoppedResult = (DoneResult & { stopped?: false }) | StoppedResult;


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
  const [items, setItems] = useState<MailDropPreviewItem[]>([]);
  const [pullRetryId, setPullRetryId] = useState<string | null>(null);
  const [pullRetrying, setPullRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  /** Set while a copy retry is the copy on screen, so the duplicate screen's buttons answer it,
   * with the report it was pressed from, which its Annuleren and a refusal return to */
  const [copyRetryFrom, setCopyRetryFrom] = useState<{ id: string; report: DoneResult; kind: RetryKind } | null>(null);
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
  // This window has no prefs of its own, so the language and the theme ride on the preview
  // payload the same way they do for the toast window.
  const [lang, setLang] = useState<{ locale: 'en' | 'nl'; reneMode: boolean; dark: boolean }>({
    locale: 'en',
    reneMode: false,
    dark: false,
  });
  const S = getStrings(lang.locale, lang.reneMode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', lang.dark);
  }, [lang.dark]);
  // The mount-once effect below reaches text through this ref rather than through `S` itself,
  // since its closures are set up once and would otherwise keep speaking whatever language was
  // active when the window opened.
  const sRef = useRef(S);
  useEffect(() => {
    sRef.current = S;
  }, [S]);

  // The scan runs from the drop, so what it has already found is asked for once here; the
  // mailboxes still being looked up arrive on their own.
  const loadExisting = useCallback(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    setExisting(NOTHING_FOUND_YET);
    void bridge
      .getMailDropExisting()
      .then((e) => setExisting((cur) => newerExisting(cur, e)))
      .catch(() => {
      });
  }, []);

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

    void bridge.getMailDropPreview().then((got: MailDropPreview) => {
      const { items: i, tree: t, panel, job, locale, reneMode, dark } = got;
      setLang({ locale: locale ?? 'en', reneMode: reneMode ?? false, dark: dark === true });
      if (i.length > 0) setItems(i);
      setPullRetryId(got.pullRetryId ?? null);
      setTree(t ?? null);
      // A held job offer, whichever way the panel was opened: its report, never the picker
      if (got.jobEnd) {
        // Main sends no jobId on either channel, and no report reads one
        const end = got.jobEnd as JobEnd;
        setJobLine(null);
        setPhase((cur) => (cur.kind === 'picking' ? phaseFromJobEnd(end, sRef.current) : cur));
        return;
      }
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
      setPullRetryId(p.pullRetryId ?? null);
      setTree(t ?? null);
      setLang({ locale: locale ?? 'en', reneMode: reneMode ?? false, dark: p.dark === true });
      // A toast click on a job offer: the job's report, never a drag to pick for. A copy in
      // flight keeps the panel, since its own answer is what leaves that phase.
      if (p.jobEnd) {
        const end = p.jobEnd as JobEnd;
        setJobLine(null);
        setPhase((cur) => (cur.kind === 'copying' ? cur : phaseFromJobEnd(end, sRef.current)));
        return;
      }
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
      setCopyRetryFrom(null);
      setRetryError(null);
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
  }, [loadExisting]);

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
  const misses = failedRowIndexes(items).map((i) => items[i]);
  const notices = useMemo(
    () => existingNotices(existing.accounts, accounts ?? []),
    [existing.accounts, accounts],
  );
  // The chips and the status line name the place the same way the row does, tree or no tree: a
  // chip reading "Bovenin" beside a row reading "Samenvoegen met Klanten" is two names for one
  // choice.
  const labelName = (email: string, labelId: string) => {
    const mailbox = accounts?.find((a) => a.email === email);
    if (labelId !== TOP_LEVEL) {
      return mailbox?.labels.find((l) => l.id === labelId)?.name ?? labelId;
    }
    return tree ? treeTopPlace(tree.dragged, mailbox?.labels ?? [], S).name : S.mdTopLevel;
  };

  const rows = useMemo(
    () => mailboxRows(accounts ?? [], picked, existing.accounts, search),
    [accounts, picked, existing.accounts, search],
  );
  const chips = pickedChips(picked, accounts ?? [], labelName);
  const openMailbox = accounts?.find((a) => a.email === active) ?? accounts?.[0] ?? null;
  // Two kinds of place a structure cannot go, both left out of the list rather than drawn dead,
  // because neither is a choice that exists:
  //
  // - Gmail's own labels. Nesting is naming, and only a label the user made can carry a name
  //   with a slash in it -- there is no `Postvak IN/Klanten`. Filing a flat drag in the inbox is
  //   fine, which is why this only applies while the structure is on.
  // - The dragged tree's own family: putting `Klanten` under `Klanten` makes `Klanten/Klanten`
  //   and copies the tree into a copy of itself. The place meant by "under the one that is
  //   already there" is the top of the list, which reuses it.
  //
  // Main refuses both once more (planTrees), for a label list that moved on since.
  const placeable = useMemo(() => {
    const labels = openMailbox?.labels ?? [];
    // Read straight off flatMode rather than through takesTree, so the deps below say exactly
    // what this reads.
    if (!tree || !openMailbox || flatMode[openMailbox.email]) return labels;
    return labels.filter(
      (l) => labelKind(l.id) === 'user' && !parentInsideTree(tree.dragged, l.name),
    );
  }, [openMailbox, tree, flatMode]);
  const shownLabels = useMemo(
    () =>
      openMailbox ? filterLabels(placeable, search, picked[openMailbox.email] ?? []) : [],
    [openMailbox, placeable, search, picked],
  );

  /**
   * Runs one copy, a fresh one or a retry, and puts its answer on screen
   *
   * @param call the bridge call that starts it
   * @param initial what the progress line says before main reports anything
   * @param from for a retry, the report it was pressed from
   */
  const runCopy = async (
    call: () => Promise<CopyOrStoppedResult>,
    initial: 'check' | 'copy',
    from?: DoneResult,
  ) => {
    // Before the first await, so a report's retry button is gone before it can be pressed twice
    setPhase({
      kind: 'copying',
      phase: initial,
      done: 0,
      total: 0,
    });
    try {
      const result = await call();
      setStopDialogOpen(false);
      // Batch one's copy answers this window, and the driver takes over in the same breath. Which
      // of the two arrives first is not ours to decide, so a job that has already claimed the
      // panel keeps it: reporting batch one here is exactly the per-batch panel this replaced.
      if (result.stopped) {
        setCopyRetryFrom(null);
        setPhase((cur) => (panelBelongsToJob(cur) ? cur : { kind: 'stopped', result }));
        return;
      }
      // A refused retry sent nothing, so the report and its button stay with the refusal on top
      if (from && result.error && !result.needsConfirm && result.accounts.length === 0) {
        setCopyRetryFrom(null);
        const note = result.error;
        setPhase((cur) => (panelBelongsToJob(cur) ? cur : { kind: 'done', result: from, note }));
        return;
      }
      // A result with a retryId leaves copyRetryFrom alone: the next press passes the new id itself
      if (!result.needsConfirm && !result.retryId) setCopyRetryFrom(null);
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
      setCopyRetryFrom(null);
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

  const copy = async (mode: CopyMode = 'check') => {
    const bridge = window.desktop;
    if (!bridge) return;
    // The duplicate screen's buttons answer whichever copy raised it
    if (copyRetryFrom) {
      const { id, report, kind } = copyRetryFrom;
      await runCopy(
        () =>
          kind === 'job'
            ? retryJobCall(id, mode)
            : (bridge.retryMailDropCopy(id, mode) as Promise<CopyOrStoppedResult>),
        mode === 'all' ? 'copy' : 'check',
        report,
      );
      return;
    }
    if (targets.length === 0) return;
    await runCopy(() => bridge.copyMailDrop(targets, mode) as Promise<CopyOrStoppedResult>, mode === 'all' ? 'copy' : 'check');
  };

  const retryCopy = async (retryId: string, report: DoneResult) => {
    setCopyRetryFrom({ id: retryId, report, kind: 'copy' });
    const bridge = window.desktop;
    if (!bridge) return;
    await runCopy(() => bridge.retryMailDropCopy(retryId, 'check') as Promise<CopyOrStoppedResult>, 'check', report);
  };

  /**
   * Sends a job offer's retry and tags its answer, so the report it draws retries the job too
   *
   * @param retryId the job offer's id
   * @param mode
   * @returns {Promise<CopyOrStoppedResult>}
   */
  const retryJobCall = async (retryId: string, mode: CopyMode): Promise<CopyOrStoppedResult> => {
    const bridge = window.desktop;
    if (!bridge) throw new Error('No bridge');
    const r = (await bridge.retryMailDropJob(retryId, mode)) as CopyOrStoppedResult;
    return r.stopped ? r : { ...r, retryKind: 'job' };
  };

  const retryJob = async (retryId: string, report: DoneResult) => {
    setCopyRetryFrom({ id: retryId, report, kind: 'job' });
    if (!window.desktop) return;
    await runCopy(() => retryJobCall(retryId, 'check'), 'check', report);
  };

  /** Starts a fresh copy of the drag, whatever retry came before it */
  const copyFresh = () => {
    const bridge = window.desktop;
    if (!bridge || targets.length === 0) return;
    setCopyRetryFrom(null);
    return runCopy(() => bridge.copyMailDrop(targets, 'check') as Promise<CopyOrStoppedResult>, 'check');
  };

  const retryPull = async () => {
    const bridge = window.desktop;
    if (!bridge || !pullRetryId || pullRetrying) return;
    setPullRetrying(true);
    setRetryError(null);
    try {
      const r = await bridge.retryMailDropPull(pullRetryId);
      if (!r.ok) {
        setRetryError(r.error);
        return;
      }
      // The labels already picked stay picked: this is the same drag with more of it saved
      setItems(r.items);
      setPullRetryId(r.pullRetryId ?? null);
      loadExisting();
    } catch (e) {
      setRetryError((e as Error).message);
    } finally {
      setPullRetrying(false);
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

          {phase.kind === 'picking' && failures.length === 0 && misses.length > 0 && (
            <div className="shrink-0 border-b border-black/5 px-5 pb-3 pt-3 dark:border-white/10">
              <PullMisses
                misses={misses}
                total={items.filter((i) => i.threadId).length}
                busy={pullRetrying}
                error={retryError}
                onRetry={pullRetryId ? () => void retryPull() : undefined}
                S={S}
              />
            </div>
          )}

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
                <JobReport
                  end={phase.result.job}
                  note={phase.note}
                  onRetry={
                    phase.result.job.outcome === 'completed' && phase.result.job.retryId
                      ? () => void retryJob(phase.result.job!.retryId!, phase.result)
                      : undefined
                  }
                  S={S}
                />
              ) : (
                <CopyReport
                  result={phase.result}
                  busy={false}
                  note={phase.note}
                  onRetry={
                    phase.result.retryId
                      ? () =>
                          void (phase.result.retryKind === 'job' ? retryJob : retryCopy)(
                            phase.result.retryId!,
                            phase.result,
                          )
                      : undefined
                  }
                  S={S}
                />
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
              {misses.length > 0 && (
                <div className="mt-3">
                  <PullMisses
                    misses={misses}
                    total={items.filter((i) => i.threadId).length}
                    busy={pullRetrying}
                    error={retryError}
                    onRetry={pullRetryId ? () => void retryPull() : undefined}
                    S={S}
                  />
                </div>
              )}
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
                  recent={recentFor(recent, openMailbox.email, placeable)}
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
                  onClick={() => {
                    // A retry's screen comes after mail went out, and the picker would offer Kopieer
                    // for the whole drag again: the 717 duplicates of 2026-08-26 were that button
                    setPhase(copyRetryFrom ? { kind: 'done', result: copyRetryFrom.report } : { kind: 'picking' });
                    setCopyRetryFrom(null);
                  }}
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
                onClick={() => void copyFresh()}
                // 'copying' has its own branch above now, with its own button -- this one is
                // never reached while it is, so the disabled/label pair it used to need for
                // that no longer applies here.
                disabled={pickedCount === 0 || savedCount === 0 || pullRetrying}
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
