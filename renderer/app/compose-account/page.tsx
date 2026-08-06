'use client';

import { useEffect, useRef, useState } from 'react';
import { getStrings } from '../strings';
import { HAIRLINE, DIVIDER } from '../settings/tokens';
import { rowForKey, shortcutFor, type ComposeAccountAsk, type ComposeAccountChoice } from '../../lib/compose-account';

// The overlay-driven picker shown for a mailto: link when more than one account is
// signed in. It replaces a native message box that could only carry account labels: it
// leads with the recipient and subject parseMailto already extracted, and renders each
// account as the from-line it is about to become — its own colour, avatar and address —
// with the leading numeral doubling as its keyboard shortcut. The transparent
// background is set in the rendered html rather than from an effect, so Gmail never
// flashes behind it for a frame. Strings come from the locale carried IN the payload
// rather than from prefs: a short-lived dialog that waited on a prefs round trip would
// risk rendering its first frame in the wrong language. The view is reused between
// opens (main only toggles its visibility), so the asked-for account list is cleared by
// nothing but the next ask.

export default function ComposeAccountPage() {
  const [ask, setAsk] = useState<ComposeAccountAsk | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onComposeAccountAsk((arg) => {
      setAsk(arg as ComposeAccountAsk);
      setFocusIndex(0);
    });
  }, []);

  useEffect(() => {
    if (ask) rowRefs.current[0]?.focus();
  }, [ask]);

  const cancel = () => window.desktop?.pickComposeAccount(null);
  const pick = (row: number) => {
    const account = ask?.accounts[row];
    if (account) window.desktop?.pickComposeAccount(account.index);
  };

  useEffect(() => {
    if (!ask) return;
    const count = ask.accounts.length;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (focusIndex + (e.key === 'ArrowDown' ? 1 : count - 1)) % count;
        setFocusIndex(next);
        rowRefs.current[next]?.focus();
        return;
      }
      const row = rowForKey(e.key, count);
      if (row !== null) {
        e.preventDefault();
        pick(row);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ask, focusIndex]);

  if (!ask) return <style>{'html,body{background:transparent}'}</style>;

  const S = getStrings(ask.locale, ask.reneMode);

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        className="flex h-screen w-full items-start justify-center bg-black/20 pt-[12vh]"
        onClick={cancel}
      >
        <div
          className={`w-[420px] overflow-hidden rounded-2xl border ${HAIRLINE} bg-white shadow-2xl dark:bg-neutral-900`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-4 pb-3">
            <p className="text-xs text-neutral-500">{S.composePickerTo}</p>
            <p className="mt-0.5 truncate text-[20px] font-semibold leading-7" title={ask.to}>
              {ask.to}
            </p>
            {ask.subject ? (
              <p className="mt-1 truncate text-[13px] text-neutral-500" title={ask.subject}>
                {S.composePickerSubject} {ask.subject}
              </p>
            ) : null}
          </div>

          <p className="px-5 pb-1.5 text-xs text-neutral-500">{S.composePickerFrom}</p>

          <div className={`border-t ${HAIRLINE} divide-y ${DIVIDER}`}>
            {ask.accounts.map((a, i) => (
              <button
                key={a.email}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                type="button"
                onClick={() => pick(i)}
                onFocus={() => setFocusIndex(i)}
                className="flex w-full items-center gap-3 py-2.5 pr-4 text-left transition hover:bg-black/[0.04] focus-visible:bg-black/[0.04] focus-visible:outline-none dark:hover:bg-white/5 motion-reduce:transition-none"
              >
                <span
                  aria-hidden
                  className="h-9 w-[3px] shrink-0 rounded-r"
                  style={{ backgroundColor: a.color }}
                />
                <span
                  aria-hidden
                  className="w-4 shrink-0 text-center text-[15px] font-semibold tabular-nums"
                  style={{ color: a.color }}
                >
                  {shortcutFor(i)}
                </span>
                <Avatar account={a} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
                    {a.label}
                  </span>
                  <span className="truncate text-xs text-neutral-500">{a.email}</span>
                </span>
              </button>
            ))}
          </div>

          <p className="px-5 py-2.5 text-right text-xs text-neutral-500">{S.composePickerEsc}</p>
        </div>
      </div>
    </>
  );
}

function Avatar({ account }: { account: ComposeAccountChoice }) {
  const [broken, setBroken] = useState(false);
  const showImg = account.avatarUrl && !broken;
  const initial = (account.label || account.email || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: account.color }}
    >
      {showImg ? (
        <img
          src={account.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
