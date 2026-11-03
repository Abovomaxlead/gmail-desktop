'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { getStrings } from '../strings';
import { hoverAt } from '../toast-hover';
import { Avatar } from '../Avatar';
import { HAIRLINE } from '../settings/tokens';
import {
  TOAST_WIDTH,
  type Toast,
  type ToastAction,
  type ToastKind,
  type ToastState,
} from '../../lib/toast';



//===========================
// Constants
//===========================

const ROUNDING_SLACK = 2;

const CARD = `relative flex overflow-hidden rounded-2xl border ${HAIRLINE} bg-white dark:bg-neutral-900`;

const ACTION =
  'flex h-5 w-6 items-center justify-center rounded-md text-neutral-600 transition hover:bg-black/6 hover:text-neutral-900 motion-reduce:transition-none dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white';

const ACTION_ICON: Record<ToastAction, string> = {
  reply: 'M6.5 4L2.5 8l4 4M2.5 8h7a4 4 0 0 1 4 4v1',
  archive: 'M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M3.8 4.5l.7 9h7l.7-9M6.7 7v4.5M9.3 7v4.5',
  read: 'M3 8.5l3 3 7-7',
};

const SUMMARY_ID = 'summary';


//===========================
// Page
//===========================

export default function ToastsPage() {
  const [state, setState] = useState<ToastState | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef(false);
  /** Where the pointer last was, in this window's own coordinates. Null while it is elsewhere.
   * Kept because hover has to be worked out again whenever the stack moves, and the stack
   * moving is not something the mouse reports. */
  const pointRef = useRef<{ x: number; y: number } | null>(null);

  /**
   * Works out which card the pointer is on, from where it last was
   *
   * @private
   */
  const resolveHover = useCallback((): void => {
    const at = pointRef.current;
    if (!at) return;
    const { id, overStack } = hoverAt(document.elementFromPoint(at.x, at.y));
    setHoveredId(id);
    if (overStack === hoveredRef.current) return;
    hoveredRef.current = overStack;
    window.desktop?.setToastHovered(overStack);
  }, []);

  useEffect(() => {
    window.desktop?.onToastState((next) => {
      if (next.toasts.length === 0 && next.summary === null) {
        hoveredRef.current = false;
        setHoveredId(null);
      }
      setState(next);
    });

    window.desktop?.onToastHoverEnd(() => {
      // Main watched the cursor leave a click-through window, which generates no event here.
      // The last position goes with it, or the next change of stack would resolve against a
      // point the pointer is no longer at.
      pointRef.current = null;
      hoveredRef.current = false;
      setHoveredId(null);
    });

    window.desktop?.toastReady();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state?.dark === true);
  }, [state?.dark]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const report = (): void => {
      const box = el.getBoundingClientRect();
      const size = {
        width: Math.ceil(box.width),
        height: Math.ceil(box.height) + ROUNDING_SLACK,
      };
      window.desktop?.reportToastSize(size);
      // The stack just changed height, so a card may have slid under or out from under a
      // pointer that never moved -- the same reason the state effect asks again.
      resolveHover();
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, [state, resolveHover]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      pointRef.current = { x: e.clientX, y: e.clientY };
      resolveHover();
    };
    const onLeave = (): void => {
      // Cleared, not merely ignored: a stack that changes after the pointer has gone would
      // otherwise resolve against where it last was and put the cross back.
      pointRef.current = null;
      setHoveredId(null);
      if (!hoveredRef.current) return;
      hoveredRef.current = false;
      window.desktop?.setToastHovered(false);
    };

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
  }, [resolveHover]);

  // A card arriving or leaving moves the rest of the stack under a pointer that has not moved,
  // and nothing about that is a mouse event. Asked again once React has put the new stack on
  // screen, or the cross stays on a card the pointer has left -- or on no card at all -- until
  // the mouse is moved again. Which is exactly what it did.
  useLayoutEffect(resolveHover, [state, resolveHover]);

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
                  className={`rounded-full border ${HAIRLINE} bg-white/95 px-3 py-1 text-xs text-neutral-600 backdrop-blur-sm hover:bg-white dark:bg-neutral-900/95 dark:text-neutral-300 dark:hover:bg-neutral-900`}
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
                  trashLabel={S.toastTrash}
                  replyLabel={S.toastReply}
                  inboxLabel={S.toastInbox}
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


//===========================
// Cards
//===========================

function ToastCard({
  toast,
  archiveLabel,
  readLabel,
  trashLabel,
  replyLabel,
  inboxLabel,
  dismissLabel,
  hovered,
}: {
  toast: Toast;
  archiveLabel: string;
  readLabel: string;
  trashLabel: string;
  replyLabel: string;
  inboxLabel: string;
  dismissLabel: string;
  hovered: boolean;
}) {
  const color = toast.account?.color ?? '#5f6368';
  // A card relayed from Gmail's page may not have its message yet; main looks it up on use.
  // `inbox` is only set when that page was Gmail, which keeps Calendar and Chat cards bare.
  const hasActions = Boolean(toast.messageId || (toast.webNotifyId && toast.inbox));
  const run = useCallback(
    (action: ToastAction) => window.desktop?.runToastAction({ id: toast.id, action }),
    [toast.id],
  );

  // The actions are spans because a <button> cannot nest inside the card's own activation
  // button, so the key half of a button has to be written out.
  const keyRun = (action: ToastAction) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  const showActions = hasActions && hovered;

  return (
    <div data-toast-card data-toast-id={toast.id} className={CARD}>
      <span aria-hidden className="w-[5px] shrink-0" style={{ backgroundColor: color }} />

      <button
        type="button"
        onClick={() => window.desktop?.activateToast(toast.id)}
        className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left outline-hidden"
      >
        {/* A mail card shows who sent it; the account is already the colour edge and the address
            line, and its own face here reads as mail from yourself. */}
        <Avatar
          url={toast.kind === 'mail' ? toast.senderAvatarUrl : toast.account?.avatarUrl}
          color={color}
          name={
            toast.kind === 'mail'
              ? toast.title
              : toast.account?.label || toast.account?.email || toast.title
          }
          fallback={statusFallback(toast)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate pr-6 text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {toast.title}
          </span>
          <span className="truncate text-[13px] text-neutral-600 dark:text-neutral-400">
            {toast.body}
          </span>
          {toast.preview ? (
            <span className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
              {toast.preview}
            </span>
          ) : null}
          <span className="mt-1 flex h-5 items-center gap-1">
            <span
              className={`truncate text-xs text-neutral-400 dark:text-neutral-500 ${showActions ? 'hidden' : ''}`}
            >
              {toast.inbox ? `${inboxLabel}: ${toast.inbox}` : toast.account?.email ?? ''}
            </span>
            {showActions ? (
              <span className="flex gap-0.5">
                {(
                  [
                    ['reply', replyLabel],
                    ['archive', archiveLabel],
                    ['trash', trashLabel],
                    ['read', readLabel],
                  ] as const
                ).map(([action, label]) => (
                  <span
                    key={action}
                    role="button"
                    tabIndex={0}
                    title={label}
                    aria-label={label}
                    className={ACTION}
                    onClick={(e) => {
                      e.stopPropagation();
                      run(action);
                    }}
                    onKeyDown={keyRun(action)}
                  >
                    <ActionIcon action={action} />
                  </span>
                ))}
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
        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left outline-hidden"
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
      className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/6 hover:text-neutral-700 motion-reduce:transition-none dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-200 ${hovered ? 'opacity-100' : 'opacity-0'}`}
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

/**
 * The glyph a card without an account carries in place of an avatar
 *
 * @param toast
 * @returns undefined for a card that has an account, which then falls back to its letter
 */
function statusFallback(toast: Toast): ReactNode | undefined {
  const status = toast.account ? null : statusIconPath(toast.kind);
  if (!status) return undefined;
  return (
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
  );
}

/**
 * The glyph on a quick-action button, drawn in the same 16-unit stroke style as the rest
 *
 * @param action
 * @returns the icon
 */
function ActionIcon({ action }: { action: ToastAction }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <path
        d={ACTION_ICON[action]}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}


//===========================
// Helper functions
//===========================

/**
 * The glyph a toast with no mailbox behind it shows where the avatar would be
 *
 * The initial it would fall back to is the first letter of a sentence main wrote, so it
 * changes meaning with the locale — worse than no letter.
 *
 * @param kind
 * @returns the path, or null for a kind that has an avatar of its own
 */
function statusIconPath(kind: ToastKind): string | null {
  if (kind === 'download') return 'M8 2.8v7.4M4.9 7.5L8 10.6l3.1-3.1M3.6 13.2h8.8';
  if (kind === 'update') return 'M8 13.2V3.6M4.4 7.2L8 3.6l3.6 3.6';
  if (kind === 'error') return 'M8 2.6L1.5 13.4h13L8 2.6zM8 6.6v3.2M8 11.7v.3';
  if (kind === 'maildrop') return 'M2.4 4.2h11.2v7.6H2.4zM2.4 4.2L8 8.6l5.6-4.4';
  return null;
}
