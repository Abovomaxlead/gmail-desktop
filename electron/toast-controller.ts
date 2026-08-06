// Holds the stack, pushes it to the window, and turns what the page reports back into the
// callbacks main already has. It owns the only clock in the feature: a toast that stays
// until dismissed is the default, and the interval below exists solely for the accounts
// whose per-account persist switch is off. It runs only while such a toast is up, and a
// hovered stack does not count down at all — the paused time is added back to every
// expiry when the pointer leaves, so a card you were reading does not vanish a tenth of a
// second after you look away.
//
// The height guard is the second reason a stack collapses. The page reports the size it
// laid out to; if that does not fit the screen the stack folds into its summary and the
// page is asked to lay out again. That is why applySize can push a new state rather than
// only resizing.

import { IPC } from './ipc';
import {
  EMPTY_STACK,
  addToast,
  collapse,
  delayExpiries,
  dismissAll,
  dismissToast,
  expireToasts,
} from './toast-model';
import type { ToastWindow } from './toast-window';
import type { Toast, ToastAction, ToastStack, ToastState } from '../renderer/lib/toast';

/** How long a toast lives when its account has the persist switch turned off. */
export const TOAST_LIFETIME_MS = 6000;

const TICK_MS = 500;

export type ToastInput = Omit<Toast, 'id' | 'expiresAt'> & { persist: boolean };

export interface ToastControllerHooks {
  window: ToastWindow;
  locale: () => 'en' | 'nl';
  reneMode: () => boolean;
  now: () => number;
  /** A card was clicked: open the mail, the settings panel, the download — whatever it stands for. */
  onActivate: (toast: Toast) => void;
  /** The summary was clicked: bring the app forward, on that account when there is one. */
  onActivateSummary: (accountKey: string | null) => void;
  onAction: (toast: Toast, action: ToastAction) => void;
}

export class ToastController {
  private stack: ToastStack = EMPTY_STACK;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hoveredSince: number | null = null;
  private ready = false;

  constructor(private readonly hooks: ToastControllerHooks) {}

  /** Called by main when the window has finished loading, so a queued state is not lost. */
  markReady(): void {
    this.ready = true;
    this.push();
  }

  show(input: ToastInput): void {
    const { persist, ...rest } = input;
    this.seq += 1;
    const toast: Toast = {
      ...rest,
      id: `t${this.seq}`,
      ...(persist ? {} : { expiresAt: this.hooks.now() + TOAST_LIFETIME_MS }),
    };
    this.stack = addToast(this.stack, toast);
    this.push();
    this.retime();
  }

  dismiss(id: string): void {
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
  }

  dismissAll(): void {
    this.stack = dismissAll(this.stack);
    this.push();
    this.retime();
  }

  activate(id: string): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
    this.hooks.onActivate(toast);
  }

  activateSummary(): void {
    const accountKey = this.stack.summary?.accountKey ?? null;
    if (!this.stack.summary) return;
    this.stack = dismissAll(this.stack);
    this.push();
    this.retime();
    this.hooks.onActivateSummary(accountKey);
  }

  runAction(id: string, action: ToastAction): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.stack = dismissToast(this.stack, id);
    this.push();
    this.retime();
    this.hooks.onAction(toast, action);
  }

  setHovered(hovered: boolean): void {
    this.hooks.window.setInteractive(hovered);
    if (hovered) {
      if (this.hoveredSince === null) this.hoveredSince = this.hooks.now();
      return;
    }
    if (this.hoveredSince === null) return;
    const paused = this.hooks.now() - this.hoveredSince;
    this.hoveredSince = null;
    this.stack = delayExpiries(this.stack, paused);
  }

  /** The page measured itself. Collapse if it does not fit, otherwise size the window to it. */
  applySize(cssWidth: number, cssHeight: number): void {
    if (this.hooks.window.wouldOverflow(cssHeight)) {
      const folded = collapse(this.stack);
      if (folded !== this.stack) {
        this.stack = folded;
        this.push();
        return;
      }
    }
    this.hooks.window.applySize(cssWidth, cssHeight);
  }

  /** Re-sends the current stack, for a language or Rene-mode change. */
  refresh(): void {
    this.push();
  }

  reposition(): void {
    this.hooks.window.reposition();
  }

  destroy(): void {
    this.stopTimer();
    this.stack = EMPTY_STACK;
    this.hooks.window.destroy();
  }

  private push(): void {
    if (this.stack.toasts.length === 0 && this.stack.summary === null) {
      this.hoveredSince = null;
      this.hooks.window.hide();
      if (this.ready) this.hooks.window.send(IPC.TOAST_STATE, this.state());
      return;
    }
    this.hooks.window.send(IPC.TOAST_STATE, this.state());
  }

  private state(): ToastState {
    return {
      toasts: this.stack.toasts,
      summary: this.stack.summary,
      locale: this.hooks.locale(),
      reneMode: this.hooks.reneMode(),
    };
  }

  private retime(): void {
    const needed = this.stack.toasts.some((t) => t.expiresAt !== undefined);
    if (needed && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!needed) this.stopTimer();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.hoveredSince !== null) return;
    const next = expireToasts(this.stack, this.hooks.now());
    if (next === this.stack) return;
    this.stack = next;
    this.push();
    this.retime();
  }
}
