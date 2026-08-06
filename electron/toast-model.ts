// What the stack contains, as a pure function of what it contained and what arrived.
// Every function returns a new stack, or the same object when it changed nothing, so a
// caller can skip a re-render on identity. Time is a parameter, never Date.now(), which
// is what makes expiry testable.
//
// Collapsing is deliberately all-or-nothing: a sixth arrival does not push a "+1 more"
// row under five cards, it replaces them with a single number. Five cards is already the
// most that can arrive without the corner of the screen becoming a wall, and past that
// the useful information is the count, not the five oldest senders. The summary keeps the
// account key only while every toast behind it came from the same mailbox, because that
// is the only case where clicking it can sensibly pick one.

import type { Toast, ToastStack, ToastSummary } from '../renderer/lib/toast';

export const MAX_CARDS = 5;

export const EMPTY_STACK: ToastStack = { toasts: [], summary: null };

function sharedAccountKey(toasts: Toast[]): string | null {
  const first = toasts[0]?.account?.key ?? null;
  if (first === null) return null;
  return toasts.every((t) => t.account?.key === first) ? first : null;
}

function summarise(toasts: Toast[]): ToastSummary {
  return { count: toasts.length, accountKey: sharedAccountKey(toasts) };
}

/** Adds a toast, collapsing the stack into a counting summary past MAX_CARDS. */
export function addToast(stack: ToastStack, toast: Toast): ToastStack {
  if (stack.summary) {
    const sameAccount =
      stack.summary.accountKey !== null && stack.summary.accountKey === toast.account?.key;
    return {
      toasts: [],
      summary: {
        count: stack.summary.count + 1,
        accountKey: sameAccount ? stack.summary.accountKey : null,
      },
    };
  }
  const toasts = [...stack.toasts, toast];
  if (toasts.length > MAX_CARDS) return { toasts: [], summary: summarise(toasts) };
  return { toasts, summary: null };
}

/** Removes one card. A collapsed stack has no cards to remove, so it is left as it is. */
export function dismissToast(stack: ToastStack, id: string): ToastStack {
  if (stack.summary) return stack;
  const toasts = stack.toasts.filter((t) => t.id !== id);
  if (toasts.length === stack.toasts.length) return stack;
  return { toasts, summary: null };
}

/** Clears everything, cards or summary alike. */
export function dismissAll(_stack: ToastStack): ToastStack {
  return EMPTY_STACK;
}

/** Drops the cards that have reached their expiry. The summary never expires. */
export function expireToasts(stack: ToastStack, now: number): ToastStack {
  if (stack.summary) return stack;
  const toasts = stack.toasts.filter((t) => t.expiresAt === undefined || t.expiresAt > now);
  if (toasts.length === stack.toasts.length) return stack;
  return { toasts, summary: null };
}

/** Pushes every expiry forward, which is how a hover pauses the countdown. */
export function delayExpiries(stack: ToastStack, ms: number): ToastStack {
  if (stack.summary || ms <= 0) return stack;
  return {
    toasts: stack.toasts.map((t) =>
      t.expiresAt === undefined ? t : { ...t, expiresAt: t.expiresAt + ms },
    ),
    summary: null,
  };
}

/** Forces a collapse the arrival count did not trigger — the stack outgrew the screen. */
export function collapse(stack: ToastStack): ToastStack {
  if (stack.summary || stack.toasts.length < 2) return stack;
  return { toasts: [], summary: summarise(stack.toasts) };
}

/** How many notifications the stack stands for, collapsed or not. */
export function stackCount(stack: ToastStack): number {
  return stack.summary ? stack.summary.count : stack.toasts.length;
}
