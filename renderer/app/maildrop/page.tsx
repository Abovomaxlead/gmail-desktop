'use client';

import { useEffect, useState } from 'react';
import type {
  MailDropItem,
  MailDropCopyProgress,
  MailDropCopyResult,
  MailDropCopyDuplicate,
  MailDropCopyMode,
} from '../MailDropModal';
import { labelKind, type LabelKind } from '../label-kind';
import { filterLabels } from '../label-search';
import { dropFailures } from '../drop-outcome';

// The mail-drop modal, on its own page because it is shown in its own view on top of
// Gmail; sharing a page with the bar meant recognising from a flag which view it was
// running in, and that did not hold up. A drag that saved nothing shows the reason instead
// of the picker: there is nothing to copy, so labels would be a form that cannot be
// submitted. A mailbox has hundreds of labels, so the picker opens with a search box that
// narrows every account's column at once. Copying takes visibly long - a search and then
// an insert per message per account - so the modal runs through phases: picking,
// copying, confirming when mail already sits at the destination, done. 'check' looks
// first and asks, 'new' skips what is there, 'all' adds it anyway. Labels are fetched
// again per drag, since this view survives between drags and which accounts are
// possible targets depends on where you dragged from. The transparent background is
// set in the rendered html rather than from an effect - one frame with an opaque
// background flashes Gmail away.


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
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'picking' });

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    const loadLabels = () => {
      setAccounts(null);
      void bridge
        .getLabels()
        .then(({ accounts: a }) => setAccounts(a))
        .catch(() => setAccounts([]));
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
      if (seenPreview) loadLabels();
      seenPreview = true;
    });
    loadLabels();
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
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
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

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {phase.kind === 'done' ? (
              <CopyReport result={phase.result} />
            ) : phase.kind === 'confirm' ? (
              <DuplicateWarning
                duplicates={phase.duplicates}
                newCount={phase.newCount}
                labelName={labelName}
              />
            ) : failures.length > 0 ? (
              <DropFailure reasons={failures} />
            ) : accounts === null ? (
              <p className="text-sm text-neutral-500">Labels ophalen…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-neutral-500">Geen ander gekoppeld account.</p>
            ) : (
              <div
                className="grid gap-x-5 gap-y-2"
                style={{ gridTemplateColumns: `repeat(${accounts.length}, minmax(0, 1fr))` }}
              >
                {accounts.map((acc) => (
                  <AccountColumn
                    key={acc.email}
                    account={acc}
                    search={search}
                    picked={picked[acc.email] ?? []}
                    disabled={phase.kind === 'copying'}
                    onToggle={(labelId) => toggle(acc.email, labelId)}
                  />
                ))}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-black/10 px-5 py-3 dark:border-white/10">
            <Status
              phase={phase}
              pickedCount={pickedCount}
              savedCount={savedCount}
              failures={failures}
            />
            {phase.kind === 'done' || failures.length > 0 ? (
              <button
                onClick={close}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
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
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
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
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
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
 * One account's labels to tick, narrowed by what is in the search box
 *
 * @param account
 * @param search
 * @param picked the labels ticked for this account
 * @param disabled while a copy is running
 * @param onToggle
 */
function AccountColumn({
  account,
  search,
  picked,
  disabled,
  onToggle,
}: {
  account: AccountLabels;
  search: string;
  picked: string[];
  disabled: boolean;
  onToggle: (labelId: string) => void;
}) {
  const shown = filterLabels(account.labels, search, picked);
  return (
    <div className="flex min-w-0 flex-col">
      <div
        className="mb-2 truncate border-b border-black/5 pb-1.5 text-xs font-semibold text-neutral-900 dark:border-white/10 dark:text-neutral-100"
        title={account.email}
      >
        {account.email}
      </div>
      {account.error ? (
        <span className="text-xs text-red-600 dark:text-red-500">{account.error}</span>
      ) : account.labels.length === 0 ? (
        <span className="text-xs text-neutral-400">Geen labels</span>
      ) : shown.length === 0 ? (
        <span className="text-xs text-neutral-400">Geen label gevonden</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {shown.map((label) => {
            const on = picked.includes(label.id);
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
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The box that narrows every account's label column
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
}: {
  phase: Phase;
  pickedCount: number;
  savedCount: number;
  failures: string[];
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
  // The body already names every reason a drop saved nothing; saying it again here is noise,
  // and the empty span is what keeps the Sluiten button on its own side of the footer.
  if (failures.length > 0) return <span />;
  if (savedCount === 0) {
    return <span className="text-xs text-neutral-500">Niets opgeslagen om te kopiëren</span>;
  }
  return (
    <span className="text-xs text-neutral-500">
      {pickedCount === 0
        ? 'Kies waar de mail naartoe moet'
        : `${savedCount} ${savedCount === 1 ? 'bericht' : 'berichten'} naar ${pickedCount} ${
            pickedCount === 1 ? 'label' : 'labels'
          }`}
    </span>
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
