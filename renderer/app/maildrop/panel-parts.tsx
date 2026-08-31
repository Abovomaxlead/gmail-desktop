'use client';

import { labelKind, type LabelKind } from '../label-kind';
import { filterLabels } from '../label-search';
import { type MailboxRow } from '../mailbox-rail';


//===========================
// Types
//===========================

export interface Label {
  id: string;
  name: string;
}
export interface AccountLabels {
  email: string;
  labels: Label[];
  error?: string;
}

/** What a dragged label turned out to carry. Mirrors MailDropTree in electron/core/ipc.ts. */
export interface DropTree {
  dragged: string;
  members: Array<{ name: string; threads: number }>;
}


//===========================
// Constants
//===========================

/** Stands in for "the top of the label list" where a destination label id is expected. Not a
 * label id Gmail could ever hand out, so it can never collide with one.
 *
 * Written as an escape and not as the byte itself. A raw NUL in the source makes this whole file
 * read as binary to grep, ripgrep and every diff viewer, which is how it got missed for a while;
 * the escape is the same eight characters to the compiler and none of that to the tools. */
export const TOP_LEVEL = '\u0000bovenin';


//===========================
// Exported functions
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
export function MailboxRail({
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
export function LabelPane({
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
export function PlaceRow({
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
export function TreeOutline({ tree }: { tree: DropTree }) {
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
export function TopLevelIcon() {
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

export function LabelIcon({ id, className = '' }: { id: string; className?: string }) {
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
