'use client';

import { useCallback, useEffect, useState } from 'react';
import { getStrings } from '../strings';
import { BUTTON, ACCENT_BUTTON, CHECKBOX, DIVIDER, HAIRLINE, HINT } from '../settings/tokens';
import type { DelegatedPickerAsk } from '../../lib/delegated-picker';

// The panel behind "add a delegated mailbox": every mailbox the relay says you may reach and
// that is not in the bar yet, with a tick box each.
//
// Nothing is added by opening this. That is the whole point of it existing — discovery used to
// write straight into the sidebar, so asking what was available and taking all of it were the
// same act. Here the payload is a list and the send is a choice.
//
// It arrives twice: `scanning` first, then the answer. The list is drawn from whatever the
// last payload said, and ticks are dropped when the candidates change so nothing is added that
// the user cannot see.
export default function DelegatedPickerPage() {
  const [ask, setAsk] = useState<DelegatedPickerAsk | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);

  useEffect(() => {
    window.desktop?.onDelegatedPickerAsk((next) => {
      setAsk(next);
      setTicked((cur) => cur.filter((e) => next.candidates.includes(e)));
    });
  }, []);

  const close = useCallback(() => window.desktop?.closeDelegatedPicker(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!ask) return <style>{'html,body{background:transparent}'}</style>;

  const S = getStrings(ask.locale, ask.reneMode);
  const note = ask.scanning
    ? S.delegatedPickerScanning
    : ask.answered
      ? S.delegatedPickerEmpty
      : S.delegatedPickerNoAnswer;

  return (
    <>
      <style>{'html,body{background:transparent}'}</style>

      <div
        onClick={close}
        className="flex h-screen w-full items-start justify-center bg-black/40 px-6 pt-16"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border ${HAIRLINE} bg-white shadow-2xl dark:bg-neutral-900`}
        >
          <div className="shrink-0 px-5 pt-4 pb-3">
            <p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {S.delegatedPickerTitle}
            </p>
            <p className={`mt-0.5 ${HINT}`}>{S.delegatedPickerSubtitle}</p>
          </div>

          {ask.candidates.length === 0 ? (
            <p className={`shrink-0 border-t ${HAIRLINE} px-5 py-4 text-[13px] text-neutral-500 dark:text-neutral-400`}>
              {note}
            </p>
          ) : (
            <div className={`min-h-0 flex-1 overflow-y-auto border-t ${HAIRLINE} divide-y ${DIVIDER}`}>
              {ask.candidates.map((email) => (
                <label
                  key={email}
                  className="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition hover:bg-black/[0.04] dark:hover:bg-white/5 motion-reduce:transition-none"
                >
                  <input
                    type="checkbox"
                    checked={ticked.includes(email)}
                    onChange={() =>
                      setTicked((cur) =>
                        cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email],
                      )
                    }
                    className={CHECKBOX}
                  />
                  <span
                    className="truncate text-[13.5px] text-neutral-900 dark:text-neutral-100"
                    title={email}
                  >
                    {email}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div
            className={`flex shrink-0 items-center justify-between gap-3 border-t ${HAIRLINE} px-5 py-3`}
          >
            <p className={HINT}>{S.delegatedPickerEsc}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={close} className={BUTTON}>
                {S.delegatedPickerCancel}
              </button>
              <button
                type="button"
                onClick={() => window.desktop?.pickDelegated(ticked)}
                disabled={ticked.length === 0}
                className={ACCENT_BUTTON}
              >
                {S.delegatedPickerAdd}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
