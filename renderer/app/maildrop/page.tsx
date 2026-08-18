'use client';

import { useEffect, useState } from 'react';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyDuplicate,
  MailDropCopyMode,
  MailDropExisting,
} from '../MailDropModal';
import { labelKind, type LabelKind } from '../label-kind';
import { filterLabels } from '../label-search';
import { dropFailures } from '../drop-outcome';
import { existingCount, existingNotices, type ExistingNotice } from '../existing-labels';
import {
  mailboxRows,
  pickedChips,
  firstPickable,
  localPart,
  type MailboxRow,
  type PickedChip,
} from '../mailbox-rail';


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

/** Before the scan has answered, and after one that could not run. */
const NOTHING_FOUND_YET: MailDropExisting = { accounts: [], scanned: 0 };

type Phase =
  | { kind: 'picking' }
  | { kind: 'copying'; phase: 'check' | 'copy'; done: number; total: number; email: string }
  | { kind: 'confirm'; duplicates: MailDropCopyDuplicate[]; newCount: number }
  | { kind: 'done'; result: MailDropCopyResult };


//===========================
// Page
//===========================

export default function MailDropModalPage() {
  const [items, setItems] = useState<MailDropItem[]>([]);
  const [accounts, setAccounts] = useState<AccountLabels[] | null>(null);
  const [active, setActive] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'picking' });
  const [existing, setExisting] = useState<MailDropExisting>(NOTHING_FOUND_YET);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    const loadLabels = () => {
      setAccounts(null);
      void bridge
        .getLabels()
        .then(({ accounts: a }) => {
          setAccounts(a);
          setActive(firstPickable(a));
        })
        .catch(() => setAccounts([]));
    };

    let run = 0;
    const loadExisting = () => {
      const mine = (run += 1);
      setExisting(NOTHING_FOUND_YET);
      void bridge
        .getMailDropExisting()
        .then((e) => {
          if (mine === run) setExisting(e);
        })
        .catch(() => {
          if (mine === run) setExisting(NOTHING_FOUND_YET);
        });
    };
    void bridge.getMailDropPreview().then(({ items: i }) => {
      if (i.length > 0) setItems(i);
    });
    let seenPreview = false;
    bridge.onMailDropPreview(({ items: i }) => {
      setItems(i);
      setPicked({});
      setSearch('');
      setPhase({ kind: 'picking' });
      if (seenPreview) {
        loadLabels();
        loadExisting();
      }
      seenPreview = true;
    });
    loadLabels();
    loadExisting();
    bridge.onMailDropCopyProgress((p: MailDropCopyProgress) =>
      setPhase((cur) => (cur.kind === 'copying' ? { kind: 'copying', ...p } : cur)),
    );
  }, []);

  const n = items.length;
  const close = () => window.desktop?.closeMailDropPreview();

  const toggle = (email: string, labelId: string) => {
    setPicked((cur) => {
      const mine = cur[email] ?? [];
      return {
        ...cur,
        [email]: mine.includes(labelId) ? mine.filter((l) => l !== labelId) : [...mine, labelId],
      };
    });
  };

  const targets = Object.entries(picked)
    .map(([email, labelIds]) => ({ email, labelIds }))
    .filter((t) => t.labelIds.length > 0);
  const pickedCount = targets.reduce((s, t) => s + t.labelIds.length, 0);

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
      email: targets[0].email,
    });
    try {
      const result = await bridge.copyMailDrop(targets, mode);
      setPhase(
        result.needsConfirm
          ? {
              kind: 'confirm',
              duplicates: result.duplicates ?? [],
              newCount: result.newCount ?? 0,
            }
          : { kind: 'done', result },
      );
    } catch (e) {
      setPhase({
        kind: 'done',
        result: {
          ok: false,
          copied: 0,
          skipped: 0,
          total: 0,
          accounts: [],
          error: (e as Error).message,
        },
      });
    }
  };

  const labelName = (email: string, labelId: string) =>
    accounts?.find((a) => a.email === email)?.labels.find((l) => l.id === labelId)?.name ?? labelId;

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
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
              {failures.length > 0
                ? 'Slepen mislukt'
                : n === 1
                  ? 'Kopieer 1 conversatie'
                  : `Kopieer ${n} conversaties`}
            </h1>
            <button
              onClick={close}
              disabled={phase.kind === 'copying'}
              aria-label="Sluiten"
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

          {phase.kind === 'done' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <CopyReport result={phase.result} />
            </div>
          ) : phase.kind === 'confirm' ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <DuplicateWarning
                duplicates={phase.duplicates}
                newCount={phase.newCount}
                labelName={labelName}
              />
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
                  picked={picked[openMailbox.email] ?? []}
                  disabled={phase.kind === 'copying'}
                  countExisting={(labelId) =>
                    existingCount(existing.accounts, openMailbox.email, labelId)
                  }
                  onToggle={(labelId) => toggle(openMailbox.email, labelId)}
                />
              )}
            </div>
          )}

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/10 px-5 py-3 dark:border-white/10">
            <Status
              phase={phase}
              pickedCount={pickedCount}
              savedCount={savedCount}
              failures={failures}
              chips={chips}
            />
            {phase.kind === 'done' || failures.length > 0 ? (
              <button
                onClick={close}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Sluiten
              </button>
            ) : phase.kind === 'confirm' ? (
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
                disabled={pickedCount === 0 || savedCount === 0 || phase.kind === 'copying'}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {phase.kind === 'copying' ? 'Bezig…' : 'Kopieer'}
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
 * @param account
 * @param search
 * @param picked the labels ticked for this account
 * @param disabled while a copy is running
 * @param countExisting how much of the drag a label already holds
 * @param onToggle
 */
function LabelPane({
  account,
  search,
  picked,
  disabled,
  countExisting,
  onToggle,
}: {
  account: AccountLabels;
  search: string;
  picked: string[];
  disabled: boolean;
  countExisting: (labelId: string) => number;
  onToggle: (labelId: string) => void;
}) {
  const shown = filterLabels(account.labels, search, picked);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-black/5 px-4 py-2 dark:border-white/10">
        <p
          className="truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"
          title={account.email}
        >
          {account.email}
        </p>
      </div>
      {account.error ? (
        <span className="px-4 py-3 text-xs text-red-600 dark:text-red-500">{account.error}</span>
      ) : account.labels.length === 0 ? (
        <span className="px-4 py-3 text-xs text-neutral-400">Geen labels</span>
      ) : shown.length === 0 ? (
        <span className="px-4 py-3 text-xs text-neutral-400">Geen label gevonden</span>
      ) : (
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {shown.map((label) => {
            const on = picked.includes(label.id);
            const already = countExisting(label.id);
            return (
              <label
                key={label.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition ${
                  on
                    ? 'bg-blue-50 text-neutral-900 dark:bg-blue-500/15 dark:text-neutral-100'
                    : 'text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/5'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onToggle(label.id)}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                <LabelIcon id={label.id} />
                <span className="truncate" title={label.name}>
                  {label.name}
                </span>
                {already > 0 && (
                  <span className="ml-auto shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/40 dark:text-amber-500">
                    {already === 1 ? 'staat er al' : `${already} staan er al`}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
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
  pickedCount,
  savedCount,
  failures,
  chips,
}: {
  phase: Phase;
  pickedCount: number;
  savedCount: number;
  failures: string[];
  chips: PickedChip[];
}) {
  if (phase.kind === 'copying') {
    const doing = phase.phase === 'check' ? 'Controleren' : 'Kopiëren';
    const text =
      phase.total > 0
        ? `${doing}: ${phase.done} van ${phase.total} — ${phase.email}`
        : `${doing} bij ${phase.email}…`;
    return <span className="text-xs text-neutral-500">{text}</span>;
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
    const bad = !r.ok || r.accounts.some((a) => a.error);
    const skipped = r.skipped > 0 ? `, ${r.skipped} overgeslagen` : '';
    return (
      <span className={`text-xs ${bad ? 'text-red-600 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
        {r.ok ? `${r.copied} gekopieerd${skipped}` : (r.error ?? 'Niets gekopieerd')}
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

function CopyReport({ result }: { result: MailDropCopyResult }) {
  if (result.error) {
    return <p className="text-sm text-red-600 dark:text-red-500">{result.error}</p>;
  }
  return (
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
