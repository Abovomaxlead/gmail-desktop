'use client';

import type {
  MailDropCopyDuplicate,
  MailDropCopyResult,
  MailDropPreviewItem,
} from '../../../electron/core/ipc';
import { cutList } from '../../lib/failure-list';
import { type ExistingNotice } from '../existing-labels';
import { localPart, type PickedChip } from '../mailbox-rail';
import { panelBody, jobEndText } from '../job-panel';
import {
  type JobEnd,
  type JobLine,
  type JobPanel,
  type CopyProgress,
  type PendingOrphan,
  type PendingJob,
  type StoppedResult,
} from '../../lib/maildrop-copy';
import { type UiStrings } from '../strings';
import { LabelIcon } from './panel-parts';


//===========================
// Types
//===========================

/** MailDropCopyResult widened with the one field main now adds when the copy itself fully
 * succeeded but writing the record of that (the audit log, or the journal's closing line)
 * did not. */
export type DoneResult = MailDropCopyResult & { warnings?: string[]; job?: JobEnd; retryKind?: RetryKind };

/** Which offer a report's retry belongs to: part 1's copy offer or a finished job's */
export type RetryKind = 'copy' | 'job';

export type Phase =
  | { kind: 'picking' }
  | ({ kind: 'copying' } & CopyProgress)
  | { kind: 'confirm'; duplicates: MailDropCopyDuplicate[]; newCount: number }
  | { kind: 'stopped'; result: StoppedResult }
  // `note` is a refused retry, drawn above the button of the report it was pressed from
  | { kind: 'done'; result: DoneResult; note?: string }
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
// Exported functions
//===========================

/** The rail's own shape while the label lists are still on their way, so the panel does not
 * jump sideways once they land. */
export function RailPlaceholder() {
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
export function LabelSearch({
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

export function Status({
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
          className={`text-xs ${jobEndColour(r.job, 'text-red-600 dark:text-red-500')}`}
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
export function DropFailure({ reasons, S }: { reasons: string[]; S: UiStrings }) {
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
export function ExistingWarning({
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

export function DuplicateWarning({
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
export function StopConfirm({
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
export function OrphanDecision({
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
export function JobDecision({
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
export function StoppedReport({ result, S }: { result: StoppedResult; S: UiStrings }) {
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
export function WarningsList({ warnings }: { warnings?: string[] }) {
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
export function JobRunning({ panel, line, S }: { panel: JobPanel; line: JobLine | null; S: UiStrings }) {
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
 * @param note why the last retry was refused
 * @param onRetry absent when the job left nothing to retry
 * @param S the active string set
 */
export function JobReport({
  end,
  note,
  onRetry,
  S,
}: {
  end: JobEnd;
  note?: string;
  onRetry?: () => void;
  S: UiStrings;
}) {
  const { into } = panelBody({ job: null, targets: end.targets }, S);
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {end.label}
      </p>
      {into && <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">{into}</p>}
      <p className={`text-sm ${jobEndColour(end, 'text-neutral-700 dark:text-neutral-300')}`}>
        {jobEndText(end, S)}
      </p>
      <p className="text-xs text-neutral-500">{S.mdBatchesCopied(end.copiedBatches, end.batches)}</p>
      {note && <p className="mt-2 text-sm text-red-600 dark:text-red-500">{note}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 self-start rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
        >
          {S.mdRetryCopy}
        </button>
      )}
    </div>
  );
}

/**
 * The body of the panel once its own copy is over
 *
 * @param result
 * @param busy true while a retry is starting
 * @param note why the last retry was refused
 * @param onRetry absent when there is nothing to retry
 * @param S
 */
export function CopyReport({
  result,
  busy,
  note,
  onRetry,
  S,
}: {
  result: DoneResult;
  busy: boolean;
  note?: string;
  onRetry?: () => void;
  S: UiStrings;
}) {
  if (result.error) {
    return <p className="text-sm text-red-600 dark:text-red-500">{result.error}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <WarningsList warnings={result.warnings} />
      {result.unfetched && result.unfetched.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2.5 dark:bg-red-500/10">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {S.mdStillUnfetched(result.unfetched.length)}
          </p>
          <FailureList lines={result.unfetched} S={S} />
        </div>
      )}
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
            {a.failures && a.failures.length > 0 && (
              <FailureList lines={a.failures} S={S} />
            )}
          </li>
        ))}
      </ul>
      {note && <p className="text-sm text-red-600 dark:text-red-500">{note}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {S.mdRetryCopy}
        </button>
      )}
    </div>
  );
}

/**
 * The mails one mailbox did not receive
 *
 * @param lines
 * @param S
 */
export function FailureList({ lines, S }: { lines: { subject: string; error: string; maybeLanded: boolean }[]; S: UiStrings }) {
  const { shown, more } = cutList(lines);
  return (
    <ul className="flex flex-col gap-0.5 pl-1">
      {shown.map((l, i) => (
        <li key={i} className="truncate text-xs text-red-700 dark:text-red-400">
          ✕ {l.subject || S.mdNoSubject} — {l.error}
          {l.maybeLanded && <span className="text-amber-700 dark:text-amber-500"> · {S.mdMaybeLanded}</span>}
        </li>
      ))}
      {more > 0 && <li className="text-xs text-red-700 dark:text-red-400">{S.mdMoreFailures(more)}</li>}
    </ul>
  );
}

/**
 * The conversations a pull could not fetch, above the label choice
 *
 * @param misses
 * @param total conversations in the drag
 * @param busy
 * @param error why the last retry was refused
 * @param onRetry absent when there is nothing to retry
 * @param S
 */
export function PullMisses({
  misses,
  total,
  busy,
  error,
  onRetry,
  S,
}: {
  misses: MailDropPreviewItem[];
  total: number;
  busy: boolean;
  error: string | null;
  onRetry?: () => void;
  S: UiStrings;
}) {
  const { shown, more } = cutList(misses);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2.5 dark:bg-red-500/10">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{S.mdPullMissed(misses.length, total)}</p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((m, i) => (
          <li key={`${m.threadId}-${i}`} className="truncate text-xs text-red-700 dark:text-red-400">
            ✕ {m.subject || S.mdNoSubject} — {m.error}
          </li>
        ))}
        {more > 0 && <li className="text-xs text-red-700 dark:text-red-400">{S.mdMoreFailures(more)}</li>}
      </ul>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="self-start rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? S.mdRetrying : S.mdRetryPull}
        </button>
      )}
    </div>
  );
}


//===========================
// Helper functions
//===========================

/**
 * The colour a finished job's line is drawn in
 *
 * @param end
 * @param otherwise for an outcome that is neither completed nor stuck
 * @returns green only for a job that lost nothing
 * @private
 */
function jobEndColour(end: JobEnd, otherwise: string): string {
  if (end.outcome === 'completed') {
    return (end.failed ?? 0) > 0 ? 'text-amber-700 dark:text-amber-500' : 'text-green-700 dark:text-green-500';
  }
  return end.outcome === 'stuck' ? 'text-red-600 dark:text-red-500' : otherwise;
}
