'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStrings } from '../strings';
import { HAIRLINE } from '../settings/tokens';
import {
  TOAST_WIDTH,
  type Toast,
  type ToastAction,
  type ToastKind,
  type ToastState,
} from '../../lib/toast';

// The notification stack, one card per notification, anchored to the bottom-right of the
// screen by main and growing upward. It is its own frameless transparent window, so as in
// compose-account/page.tsx the card is the window and the html background must be
// transparent or Chromium paints an opaque rectangle around the rounded corners.
//
// The theme arrives resolved, in the state, and the dark class is put on this document
// from it. That indirection is the whole point: the class the rest of the app reads is
// only ever put on the main document, and a second window cannot see it. Reading the
// system preference here instead would ignore an explicit light or dark choice, which is
// two thirds of the setting.
//
// The card's height must not change on hover. The stack grows upward from a fixed bottom
// edge, so a card that got taller when hovered would push the cards above it up under the
// pointer, and the pointer would then be over a different card, and the height would
// change again. The third line therefore holds the account address at rest and swaps it
// in place for the action buttons — same row, same height, nothing moves. The close box
// is absolutely positioned for the same reason.
//
// Hover is read from a document-level mousemove rather than onMouseEnter per card. Main
// keeps the window click-through so the transparent gaps between cards do not swallow
// clicks meant for the desktop, and a click-through window gets mouse moves but no enter
// or leave events; elementFromPoint is what still works under that.
//
// Which card is lit is therefore state here and not a `:hover` variant, for the same
// reason. CSS hover is Chromium's own idea of where the pointer is, and Chromium updates
// that from the events this window does not get: move the pointer off the stack in one
// go — off the edge, not into a gap — and there is no leave to clear it, so the card that
// was last under the pointer keeps its close box and its buttons showing over an app the
// pointer left entirely. Nothing on this side can notice, since the giveaway is the
// absence of an event. Main watches the cursor for us and says so on onToastHoverEnd,
// which is the only signal that ends a hover nobody saw end.

// Windows at a fractional display scale rounds the content size and then divides the CSS
// viewport by the zoom factor, so an exact fit can land a pixel short and clip a shadow.
const ROUNDING_SLACK = 2;

export default function ToastsPage() {
  const [state, setState] = useState<ToastState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef(false);

  // Everything this page logs is forwarded into notify.log by the window that owns it, so
  // these lines are not for a console nobody has open — they are the page's half of a
  // handshake whose failures are otherwise completely silent. A missing bridge is the worst
  // of them: every call below is optional-chained, so without it the page renders, measures
  // nothing, reports nothing, and main waits for a size that can never come.
  useEffect(() => {
    console.log(`[toasts] mounted, bridge=${Boolean(window.desktop)}`);
  }, []);

  useEffect(() => {
    window.desktop?.onToastState((next) => {
      console.log(
        `[toasts] state received: ${next.toasts.length} card(s)` +
          `${next.summary ? ` + summary of ${next.summary.count}` : ''}`,
      );
      // Mirrors the controller clearing its own hoveredSince when the stack empties: with
      // no cards left there is nothing to be hovered over, and leaving this set would make
      // the next toast arrive with the page believing the pointer is still parked on a
      // card that no longer exists.
      if (next.toasts.length === 0 && next.summary === null) {
        hoveredRef.current = false;
        setHoveredId(null);
      }
      setState(next);
    });
    // Main saw the cursor leave the window. Both halves are cleared, not just the lit
    // card: the pointer is gone, so the ref has to agree or the next real move over a
    // card reads as no change and main is never told the hover started again.
    window.desktop?.onToastHoverEnd(() => {
      hoveredRef.current = false;
      setHoveredId(null);
    });
    // Last, and only now: the listener above exists, so a state sent in answer to this
    // cannot land in the gap. Main used to push on did-finish-load, which is a loaded
    // document and not a mounted tree — the push arrived before this effect ran and was
    // simply gone, leaving a window with no cards, nothing to measure, and a watchdog
    // correctly concluding the stack was dead. Asking from here also covers every reload,
    // fast refresh and renderer crash for free: whatever brings this component back asks
    // again.
    console.log('[toasts] listening, asking main for the stack');
    window.desktop?.toastReady();
  }, []);

  // Declared before the size report below, and that order is load-bearing: effects run in
  // the order they are declared, main only shows this window once a size has been reported,
  // so the class is on the document before anything is on screen. The other way round, the
  // first card of a dark session would be painted light for the frame between the two.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state?.dark === true);
  }, [state?.dark]);

  // Rebuilt on every state change rather than attached once: the wrap div does not exist
  // until the first card renders, so an empty dependency array would observe nothing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      // Not nothing: main is waiting on a size, and there is no element to measure. With
      // cards in the state this is the page failing to render them.
      const cards = state ? state.toasts.length : 0;
      if (cards > 0 || state?.summary) console.log('[toasts] nothing to measure yet');
      return;
    }
    const report = (): void => {
      const box = el.getBoundingClientRect();
      const size = {
        width: Math.ceil(box.width),
        height: Math.ceil(box.height) + ROUNDING_SLACK,
      };
      console.log(`[toasts] measured ${size.width}x${size.height}, reporting`);
      window.desktop?.reportToastSize(size);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [state]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el instanceof Element ? el.closest('[data-toast-card]') : null;
      // Same lookup, two answers: whether anything is hovered, which main needs for the
      // click-through and the expiry pause, and which card it is, which only the page
      // needs. Setting the id to what it already is does not re-render.
      setHoveredId(card?.getAttribute('data-toast-id') ?? null);
      const over = card !== null;
      if (over === hoveredRef.current) return;
      hoveredRef.current = over;
      window.desktop?.setToastHovered(over);
    };
    const onLeave = (): void => {
      setHoveredId(null);
      if (!hoveredRef.current) return;
      hoveredRef.current = false;
      window.desktop?.setToastHovered(false);
    };
    // mouseleave does not bubble, so a listener on document itself is not reliably in the
    // dispatch path; the documentElement is the node the pointer actually leaves. mouseout
    // with a null relatedTarget is a second net for the same event, since it does bubble.
    const onOut = (e: MouseEvent): void => {
      if (e.relatedTarget !== null) return;
      onLeave();
    };
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseout', onOut);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseout', onOut);
    };
  }, []);

  const transparent = <style>{'html,body{background:transparent;overflow:hidden}'}</style>;
  if (!state) return transparent;

  const S = getStrings(state.locale, state.reneMode);
  const empty = state.toasts.length === 0 && state.summary === null;

  return (
    <>
      {transparent}
      <div
        ref={wrapRef}
        style={{ width: TOAST_WIDTH }}
        className="flex flex-col items-stretch gap-2"
      >
        {empty ? null : (
          <>
            {state.toasts.length > 1 ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-toast-card
                  onClick={() => window.desktop?.dismissAllToasts()}
                  className={`rounded-full border ${HAIRLINE} bg-white/95 px-3 py-1 text-xs text-neutral-600 backdrop-blur hover:bg-white dark:bg-neutral-900/95 dark:text-neutral-300 dark:hover:bg-neutral-900`}
                >
                  {S.toastDismissAll}
                </button>
              </div>
            ) : null}

            {state.summary ? (
              <SummaryCard
                count={state.summary.count}
                label={S.toastSummary(state.summary.count)}
                dismissLabel={S.toastDismiss}
                hovered={hoveredId === SUMMARY_ID}
              />
            ) : (
              state.toasts.map((t) => (
                <ToastCard
                  key={t.id}
                  toast={t}
                  archiveLabel={S.toastArchive}
                  readLabel={S.toastMarkRead}
                  dismissLabel={S.toastDismiss}
                  hovered={hoveredId === t.id}
                />
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

const CARD = `relative flex overflow-hidden rounded-2xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;
const ACTION =
  'rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 transition hover:bg-black/[0.06] motion-reduce:transition-none dark:text-neutral-200 dark:hover:bg-white/10';

/** The summary has no toast id of its own; it needs one to be hovered like the rest. */
const SUMMARY_ID = 'summary';

function ToastCard({
  toast,
  archiveLabel,
  readLabel,
  dismissLabel,
  hovered,
}: {
  toast: Toast;
  archiveLabel: string;
  readLabel: string;
  dismissLabel: string;
  hovered: boolean;
}) {
  const color = toast.account?.color ?? '#5f6368';
  const hasActions = Boolean(toast.messageId);
  const run = useCallback(
    (action: ToastAction) => window.desktop?.runToastAction({ id: toast.id, action }),
    [toast.id],
  );

  const showActions = hasActions && hovered;

  return (
    <div data-toast-card data-toast-id={toast.id} className={CARD}>
      <span aria-hidden className="w-[5px] shrink-0" style={{ backgroundColor: color }} />

      <button
        type="button"
        onClick={() => window.desktop?.activateToast(toast.id)}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left outline-none"
      >
        <Avatar toast={toast} color={color} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate pr-6 text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {toast.title}
          </span>
          <span className="truncate text-[13px] text-neutral-600 dark:text-neutral-400">
            {toast.body}
          </span>
          <span className="mt-1 flex h-5 items-center gap-1">
            <span
              className={`truncate text-xs text-neutral-400 dark:text-neutral-500 ${showActions ? 'hidden' : ''}`}
            >
              {toast.account?.email ?? ''}
            </span>
            {showActions ? (
              <span className="flex gap-1">
                <span
                  role="button"
                  tabIndex={0}
                  className={ACTION}
                  onClick={(e) => {
                    e.stopPropagation();
                    run('archive');
                  }}
                >
                  {archiveLabel}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className={ACTION}
                  onClick={(e) => {
                    e.stopPropagation();
                    run('read');
                  }}
                >
                  {readLabel}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </button>

      <CloseBox
        label={dismissLabel}
        hovered={hovered}
        onClick={() => window.desktop?.dismissToast(toast.id)}
      />
    </div>
  );
}

function SummaryCard({
  count,
  label,
  dismissLabel,
  hovered,
}: {
  count: number;
  label: string;
  dismissLabel: string;
  hovered: boolean;
}) {
  return (
    <div data-toast-card data-toast-id={SUMMARY_ID} className={CARD}>
      <span aria-hidden className="w-[5px] shrink-0 bg-neutral-800 dark:bg-neutral-300" />
      <button
        type="button"
        onClick={() => window.desktop?.activateToast('summary')}
        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left outline-none"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold tabular-nums text-white dark:bg-neutral-200 dark:text-neutral-900"
        >
          {count > 99 ? '99+' : count}
        </span>
        <span className="truncate pr-6 text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
          {label}
        </span>
      </button>
      <CloseBox
        label={dismissLabel}
        hovered={hovered}
        onClick={() => window.desktop?.dismissAllToasts()}
      />
    </div>
  );
}

function CloseBox({
  label,
  hovered,
  onClick,
}: {
  label: string;
  hovered: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/[0.06] hover:text-neutral-700 motion-reduce:transition-none dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-200 ${hovered ? 'opacity-100' : 'opacity-0'}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  );
}

// A toast with no mailbox behind it gets a glyph where the avatar would be, because the
// initial it would fall back to is the first letter of a sentence main wrote: a finished
// download showed "D" for "Download complete" and "D" again for "Download voltooid", and
// an update showed "U" or "N" depending on the language. A letter that changes meaning
// with the locale is worse than no letter. Drawn in the card's own language - currentColor
// on a 16-unit box with thin round strokes, the same as the close box.
function statusIconPath(kind: ToastKind): string | null {
  if (kind === 'download') return 'M8 2.8v7.4M4.9 7.5L8 10.6l3.1-3.1M3.6 13.2h8.8';
  if (kind === 'update') return 'M8 13.2V3.6M4.4 7.2L8 3.6l3.6 3.6';
  if (kind === 'error') return 'M8 2.6L1.5 13.4h13L8 2.6zM8 6.6v3.2M8 11.7v.3';
  return null;
}

function Avatar({ toast, color }: { toast: Toast; color: string }) {
  const [broken, setBroken] = useState(false);
  const url = toast.account?.avatarUrl;
  const status = toast.account ? null : statusIconPath(toast.kind);
  const initial =
    (toast.account?.label || toast.account?.email || toast.title || '?').trim().charAt(0).toUpperCase() ||
    '?';
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : status ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4">
          <path
            d={status}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : (
        initial
      )}
    </span>
  );
}
