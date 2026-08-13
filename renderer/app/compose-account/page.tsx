'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStrings } from '../strings';
import { HAIRLINE, DIVIDER, BUTTON } from '../settings/tokens';
import {
  nextFocusIndex,
  rowForKey,
  shortcutFor,
  type ComposeAccountAsk,
  type ComposeAccountChoice,
} from '../../lib/compose-account';

// The picker shown for a mailto: link when more than one account is signed in. It fills
// its own frameless window rather than covering the app, so there is nothing behind it to
// dim and no scrim: the card is the window. It replaces a native message box that could
// only carry account labels — it leads with the recipient and subject parseMailto already
// extracted, and renders each account as the from-line it is about to become, with the
// leading numeral doubling as its keyboard shortcut. The transparent background is set in
// the rendered html rather than from an effect, because with a transparent window it is
// what stops Chromium painting an opaque rectangle around the rounded corners. Strings
// come from the locale carried IN the payload rather than from prefs: a short-lived dialog
// that waited on a prefs round trip would risk rendering its first frame in the wrong
// language.
//
// The card reports its own measured height to main, which resizes the still-hidden window
// to it and only then shows it. That is why the card is auto-height until it has been
// measured: capping it to the viewport first would make the row list shrink to whatever
// size main guessed, and the measurement would then just echo the guess back. Once the
// size is reported the cap goes on, so a clamped window (many accounts on a short screen)
// keeps the footer — and so the cancel button — on screen with the list scrolling inside.
//
// Focus is drawn from the focusIndex the component tracks, not from :focus-visible, which
// Chromium will not match for the programmatic .focus() that gives row one the keyboard on
// open. It uses the row's own account colour — a thicker colour edge plus a wash of the
// same hue at about 8% — because that edge is already this design's identity marker and the
// account colours are the only colour the design allows. Hover stays a neutral grey so the
// two states cannot be mistaken for each other. A frameless window has no close box, so
// Esc is not the only way out: the footer carries a real cancel button. Note that dark:
// variants are inert here — darkMode is class-based and the class is only toggled on the
// main document — so this card always renders light, as maildrop and reconnect also do.


//===========================
// Constants
//===========================

const LIST_MAX_HEIGHT = 504;
// Windows at a fractional display scale rounds the content size, and the CSS viewport is
// then divided by the zoom factor, so an exact fit can land a pixel short and show a
// scrollbar for that one pixel. Two pixels of slack costs nothing and removes the class.
const ROUNDING_SLACK = 2;


//===========================
// Page
//===========================

export default function ComposeAccountPage() {
  const [ask, setAsk] = useState<ComposeAccountAsk | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [sized, setSized] = useState(false);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge) return;
    bridge.onComposeAccountAsk((arg) => {
      setAsk(arg as ComposeAccountAsk);
      setFocusIndex(0);
      setSized(false);
    });
  }, []);

  useEffect(() => {
    if (ask) rowRefs.current[0]?.focus();
  }, [ask]);

  useEffect(() => {
    if (!ask) return;
    let cancelled = false;
    let frame = 0;
    const measure = (): void => {
      frame = requestAnimationFrame(() => {
        const el = cardRef.current;
        if (cancelled || !el) return;
        const box = el.getBoundingClientRect();
        window.desktop?.reportComposeAccountSize({
          width: Math.ceil(box.width),
          height: Math.ceil(box.height) + ROUNDING_SLACK,
        });
        setSized(true);
      });
    };
    const fonts = document.fonts;
    if (fonts) void fonts.ready.then(measure, measure);
    else measure();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [ask]);

  const cancel = useCallback(() => window.desktop?.pickComposeAccount(null), []);
  const pick = useCallback(
    (row: number) => {
      const account = ask?.accounts[row];
      if (account) window.desktop?.pickComposeAccount(account.index);
    },
    [ask],
  );

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
        const next = nextFocusIndex(focusIndex, count, e.key === 'ArrowDown' ? 1 : -1);
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
  }, [ask, focusIndex, cancel, pick]);

  if (!ask) return <style>{'html,body{background:transparent}'}</style>;

  const S = getStrings(ask.locale, ask.reneMode);

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        ref={cardRef}
        className={`flex w-full flex-col overflow-hidden rounded-2xl border ${HAIRLINE} bg-white shadow-2xl dark:bg-neutral-900 ${
          sized ? 'max-h-screen' : ''
        }`}
      >
        <div className="shrink-0 px-5 pt-4 pb-3">
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

        <p className="shrink-0 px-5 pb-1.5 text-xs text-neutral-500">{S.composePickerFrom}</p>

        <div
          style={{ maxHeight: LIST_MAX_HEIGHT }}
          className={`min-h-0 flex-1 overflow-y-auto border-t ${HAIRLINE} divide-y ${DIVIDER}`}
        >
          {ask.accounts.map((a, i) => (
            <button
              key={a.email}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              type="button"
              onClick={() => pick(i)}
              onFocus={() => setFocusIndex(i)}
              style={i === focusIndex ? { backgroundColor: `${a.color}14` } : undefined}
              className="flex w-full items-center gap-3 py-2.5 pr-4 text-left outline-none transition hover:bg-black/[0.04] dark:hover:bg-white/5 motion-reduce:transition-none"
            >
              <span aria-hidden className="flex h-9 w-[5px] shrink-0 items-center">
                <span
                  className={`h-9 rounded-r ${i === focusIndex ? 'w-[5px]' : 'w-[3px]'}`}
                  style={{ backgroundColor: a.color }}
                />
              </span>
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

        <div
          className={`flex shrink-0 items-center justify-between gap-3 border-t ${HAIRLINE} px-5 py-3`}
        >
          <p className="text-xs text-neutral-500">{S.composePickerEsc}</p>
          <button type="button" onClick={() => cancel()} className={BUTTON}>
            {S.composePickerCancel}
          </button>
        </div>
      </div>
    </>
  );
}


//===========================
// Helper components
//===========================

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
