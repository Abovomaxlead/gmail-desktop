'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DownloadRecord } from '../page';
import type { UiStrings } from '../strings';
import { Section, SettingsGroup } from './Section';
import {
  BUTTON,
  DANGER_BUTTON,
  DANGER_PANEL,
  DIVIDER,
  FOCUS_RING,
  HAIRLINE,
  HINT,
  PANEL,
} from './tokens';

// Download history: what you have fetched, newest first, with the buttons to open a
// file or show it in its folder. Sizes use steps of 1000 to match the kB/MB units
// shown. The change listener is subscribed once per window and fanned out here,
// because the preload bridge offers no way to remove a listener again.

const SIZE_UNITS = ['kB', 'MB', 'GB', 'TB'] as const;

function formatSize(bytes: number, S: UiStrings): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1000) return S.dhBytes(Math.round(safe));
  let value = safe / 1000;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString(S.numberLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ${SIZE_UNITS[unit]}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function formatWhen(
  startedAt: number,
  now: Date,
  time: Intl.DateTimeFormat,
  date: Intl.DateTimeFormat,
): string {
  const d = new Date(startedAt);
  return isSameDay(d, now) ? time.format(d) : date.format(d);
}

const listeners = new Set<() => void>();
let subscribed = false;

function subscribeToChanges(cb: () => void): () => void {
  listeners.add(cb);
  if (!subscribed) {
    subscribed = true;
    window.desktop?.onDownloadHistoryChanged(() => {
      for (const l of listeners) l();
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function OpenIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

const ICON_BUTTON = `flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 dark:text-neutral-400 transition hover:bg-black/5 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-100 motion-reduce:transition-none ${FOCUS_RING}`;

const TH = 'px-2 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400';

function stateLabel(state: DownloadRecord['state'], S: UiStrings): string {
  if (state === 'completed') return S.dhStateCompleted;
  if (state === 'cancelled') return S.dhStateCancelled;
  return S.dhStateInterrupted;
}

export function DownloadHistorySection({ S }: { S: UiStrings }): JSX.Element {
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      window.desktop
        ?.getDownloadHistory()
        .then((r) => {
          if (alive) setRecords(Array.isArray(r) ? r : []);
        })
        .catch(() => {});
    };
    load();
    const off = subscribeToChanges(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const when = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(S.numberLocale, { hour: '2-digit', minute: '2-digit' }),
      date: new Intl.DateTimeFormat(S.numberLocale, { day: 'numeric', month: 'short', year: 'numeric' }),
    }),
    [S.numberLocale],
  );

  const today = new Date();

  return (
    <Section title={S.navDownloadHistory}>
      <SettingsGroup>
        {records.length === 0 ? (
          <p className={`${PANEL} px-4 py-3.5 ${HINT}`}>{S.dhEmpty}</p>
        ) : (
          <div className={`${PANEL} overflow-x-auto`}>
            <table className="w-full min-w-[460px] text-[13px]">
              <thead>
                <tr className={`border-b ${HAIRLINE}`}>
                  <th scope="col" className={`${TH} pl-4 text-left`}>
                    {S.dhFile}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {S.dhSize}
                  </th>
                  <th scope="col" className={`${TH} text-left`}>
                    {S.dhWhen}
                  </th>
                  <th scope="col" className={`${TH} text-left`}>
                    {S.dhState}
                  </th>
                  <th scope="col" className="w-[76px] pr-4" />
                </tr>
              </thead>
              <tbody className={`divide-y ${DIVIDER}`}>
                {records.map((r, i) => {
                  const done = r.state === 'completed';
                  return (
                    <tr
                      key={`${r.startedAt}-${r.path}-${i}`}
                      className={done ? '' : 'text-neutral-500 dark:text-neutral-500'}
                    >
                      <td className="w-full max-w-0 py-2 pl-4 pr-2">
                        <span className="block truncate" title={r.path || r.filename}>
                          {r.filename}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        {formatSize(r.bytes, S)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                        {formatWhen(r.startedAt, today, when.time, when.date)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{stateLabel(r.state, S)}</td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => window.desktop?.revealDownload(r.path)}
                            disabled={!r.path}
                            aria-label={S.dhReveal}
                            title={S.dhReveal}
                            className={ICON_BUTTON}
                          >
                            <FolderIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => window.desktop?.openDownload(r.path)}
                            disabled={!done || !r.path}
                            aria-label={S.dhOpen}
                            title={S.dhOpen}
                            className={ICON_BUTTON}
                          >
                            <OpenIcon className="h-4 w-4" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SettingsGroup>

      {records.length > 0 && (
        <SettingsGroup>
          {confirming ? (
            <div className={`${DANGER_PANEL} flex items-center justify-between gap-3 px-3 py-2`}>
              <span className="text-xs">{S.dhClearConfirm}</span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.desktop?.clearDownloadHistory();
                    setRecords([]);
                    setConfirming(false);
                  }}
                  className={DANGER_BUTTON}
                >
                  {S.remove}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
                  {S.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
                {S.dhClear}
              </button>
            </div>
          )}
        </SettingsGroup>
      )}
    </Section>
  );
}
