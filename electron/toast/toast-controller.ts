// Holds the stack, pushes it to the window, and turns what the page reports back into the
// callbacks main already has.
//
// It owns the only clock in the feature. A toast that stays until dismissed is the default,
// so the interval runs only for accounts whose persist switch is off — and a hovered stack
// does not count down at all, the paused time being added back when the pointer leaves.
//
// The height guard is the second reason a stack collapses: a size that does not fit the
// screen folds the stack into its summary, which is why applySize can push a new state.
//
// Every assignment to `stack` goes through setStack, which diffs the two and reports what
// left. Main pins things per card, and a card can leave in five ways of which only one is
// a click — the one always forgotten being the collapse, where five cards leave inside
// addToast without a dismiss. show() hands its new toast to the diff for the same reason:
// a toast arriving into a collapse never lands, and nothing else would ever release it.

import { IPC } from '../core/ipc';
import { notifyLog } from '../notify/notify-log';
import {
  EMPTY_STACK,
  addToast,
  collapse,
  delayExpiries,
  dismissToast,
  expireToasts,
} from './toast-model';
import type { ToastWindow } from './toast-window';
import type { Toast, ToastAction, ToastStack, ToastState } from '../../renderer/lib/toast';


//===========================
// Types
//===========================

export type ToastInput = Omit<Toast, 'id' | 'expiresAt'> & { persist: boolean };

export interface ToastControllerHooks {
  window: ToastWindow;
  locale: () => 'en' | 'nl';
  reneMode: () => boolean;
  dark: () => boolean;
  now: () => number;
  onActivate: (toast: Toast) => void;
  onActivateSummary: (accountKey: string | null) => void;
  onAction: (toast: Toast, action: ToastAction) => void;
  onDiscard?: (toast: Toast) => void;
}


//===========================
// Constants
//===========================

/** How long a toast lives when its account has the persist switch turned off. */
export const TOAST_LIFETIME_MS = 6000;

const TICK_MS = 500;

// runs only while something is hovered and stops itself when it is not, so this is a
// handful of cursor reads around a real hover rather than a background poll
export const HOVER_WATCH_MS = 120;


//===========================
// Controller
//===========================

export class ToastController {
  private stack: ToastStack = EMPTY_STACK;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hoverWatch: ReturnType<typeof setInterval> | null = null;
  private hoveredSince: number | null = null;
  private darkSince: number | null = null;
  private ready = false;

  constructor(private readonly hooks: ToastControllerHooks) {}

  /**
   * Called by main when the window has finished loading, so a queued state is not lost
   */
  markReady(): void {
    this.ready = true;
    notifyLog(
      `[toast] window ready, pushing ${this.stack.toasts.length} card(s)` +
        `${this.stack.summary ? ` and a summary of ${this.stack.summary.count}` : ''}`,
    );
    this.push();
  }

  /**
   * Puts a card on the stack
   *
   * @param input the card, plus whether its account keeps it until dismissed
   */
  show(input: ToastInput): void {
    const { persist, ...rest } = input;
    // This card starts its life unseen when nothing is on screen to put it beside: an empty
    // stack means the window is hidden, and a window that has not painted since it was built
    // means the page behind it is new. What ends the blackout is a size report, which is the
    // page saying it drew something -- without this a card landing on a non-empty stack right
    // after a rebuild counts down against a window that never measured itself.
    if (this.darkSince === null && (this.isEmpty() || !this.hooks.window.hasPainted())) {
      this.darkSince = this.hooks.now();
    }
    this.seq += 1;
    const toast: Toast = {
      ...rest,
      id: `t${this.seq}`,
      ...(persist ? {} : { expiresAt: this.hooks.now() + TOAST_LIFETIME_MS }),
    };
    // a sixth arrival collapses the five below it, which leave with no dismiss called; the
    // new toast is handed to the diff too, since a collapse can swallow it outright
    this.setStack(addToast(this.stack, toast), { arrived: toast });
    this.push();
    this.retime();
  }

  /**
   * Takes one card off the stack
   *
   * @param id
   */
  dismiss(id: string): void {
    this.setStack(dismissToast(this.stack, id));
    this.push();
    this.retime();
  }

  dismissAll(): void {
    this.setStack(EMPTY_STACK);
    this.push();
    this.retime();
  }

  /**
   * A card was clicked
   *
   * @param id
   */
  activate(id: string): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.setStack(dismissToast(this.stack, id), { handled: toast });
    this.push();
    this.retime();
    this.hooks.onActivate(toast);
  }

  /**
   * The summary was clicked
   */
  activateSummary(): void {
    if (!this.stack.summary) return;
    const accountKey = this.stack.summary.accountKey;
    this.setStack(EMPTY_STACK);
    this.push();
    this.retime();
    this.hooks.onActivateSummary(accountKey);
  }

  /**
   * A button on a card was clicked
   *
   * @param id
   * @param action
   */
  runAction(id: string, action: ToastAction): void {
    const toast = this.stack.toasts.find((t) => t.id === id);
    if (!toast) return;
    this.setStack(dismissToast(this.stack, id), { handled: toast });
    this.push();
    this.retime();
    this.hooks.onAction(toast, action);
  }

  /**
   * The pointer entered or left the stack
   *
   * @param hovered
   */
  setHovered(hovered: boolean): void {
    this.hooks.window.setInteractive(hovered);
    if (hovered) {
      if (this.hoveredSince === null) this.hoveredSince = this.hooks.now();
      this.startHoverWatch();
      return;
    }
    this.stopHoverWatch();
    if (this.hoveredSince === null) return;
    const paused = this.hooks.now() - this.hoveredSince;
    this.hoveredSince = null;
    this.setStack(delayExpiries(this.stack, paused));
  }

  private startHoverWatch(): void {
    if (this.hoverWatch) return;
    this.hoverWatch = setInterval(() => this.checkHover(), HOVER_WATCH_MS);
  }

  private stopHoverWatch(): void {
    if (!this.hoverWatch) return;
    clearInterval(this.hoverWatch);
    this.hoverWatch = null;
  }

  /**
   * The half of hover the page cannot report
   *
   * A pointer leaving a click-through window generates no event, so the last card stays
   * hovered for good; asking the system where the cursor is settles it. Self-terminating,
   * so no other path has to remember this exists.
   *
   * @private
   */
  private checkHover(): void {
    if (this.hoveredSince === null) return this.stopHoverWatch();
    if (this.hooks.window.containsCursor()) return;
    this.setHovered(false);
    this.hooks.window.send(IPC.TOAST_HOVER_END, null);
  }

  /**
   * The page measured itself
   *
   * @param cssWidth
   * @param cssHeight
   */
  applySize(cssWidth: number, cssHeight: number): void {
    // Before anything is decided about it: the report arriving is what the watchdog waits
    // for, and the two paths in layout() below never reach window.applySize
    this.hooks.window.noteAlive();
    this.notePainted();
    this.layout(cssWidth, cssHeight);
  }

  /**
   * Collapses the stack if it does not fit, otherwise sizes the window to it
   *
   * @param cssWidth
   * @param cssHeight
   * @private
   */
  private layout(cssWidth: number, cssHeight: number): void {
    if (this.isEmpty()) return;
    if (this.hooks.window.wouldOverflow(cssHeight)) {
      const folded = collapse(this.stack);
      if (folded !== this.stack) {
        this.setStack(folded);
        this.push();
        this.retime();
        return;
      }
    }
    this.hooks.window.applySize(cssWidth, cssHeight);
  }

  /**
   * Hands the stack over and empties it
   *
   * For an owner that has to get these out another way, the window having gone broken with
   * cards queued. One call does both halves, so a second finds nothing and raises nothing
   * twice; the cards leave for good, releasing what they pinned.
   *
   * @returns {ToastStack} what the stack held
   */
  drain(): ToastStack {
    const held = this.stack;
    if (this.isEmpty()) return held;
    this.stopTimer();
    this.stopHoverWatch();
    this.hoveredSince = null;
    this.darkSince = null;
    this.setStack(EMPTY_STACK);
    this.push();
    return held;
  }

  /**
   * Re-sends the current stack, for a language, theme or Rene-mode change
   */
  refresh(): void {
    this.push();
  }

  reposition(): void {
    this.hooks.window.reposition();
  }

  destroy(): void {
    this.stopTimer();
    this.stopHoverWatch();
    this.setStack(EMPTY_STACK);
    this.ready = false;
    this.hooks.window.destroy();
  }

  /**
   * The only place `stack` is assigned
   *
   * What left is worked out here rather than remembered at seven call sites, so the next
   * mutator cannot forget to release what its cards held. Everything in play — the previous
   * cards plus `arrived` — is compared against the next stack; absent means gone, whether
   * it left or never landed. A throwing hook must not stop the stack updating.
   *
   * @param next
   * @param opts.handled the card the caller is itself passing to onActivate or onAction,
   *   which consume what it pinned, so it is not discarded here
   * @param opts.arrived the toast this assignment is adding
   * @private
   */
  private setStack(next: ToastStack, opts: { handled?: Toast; arrived?: Toast } = {}): void {
    const prev = this.stack;
    this.stack = next;
    const onDiscard = this.hooks.onDiscard;
    if (!onDiscard || prev === next) return;
    const kept = new Set(next.toasts.map((t) => t.id));
    const inPlay = opts.arrived ? [...prev.toasts, opts.arrived] : prev.toasts;
    for (const toast of inPlay) {
      if (kept.has(toast.id) || toast.id === opts.handled?.id) continue;
      try {
        onDiscard(toast);
      } catch (e) {
        console.warn('[toast] onDiscard failed:', e);
      }
    }
  }

  /**
   * Sends the stack to the page, or hides the window when there is none
   *
   * @private
   */
  private push(): void {
    if (this.isEmpty()) {
      this.hoveredSince = null;
      this.darkSince = null;
      this.hooks.window.hide();
      if (this.ready) this.hooks.window.send(IPC.TOAST_STATE, this.state());
      return;
    }

    notifyLog(
      `[toast] -> page: ${this.stack.toasts.length} card(s)` +
        `${this.stack.summary ? ` + summary of ${this.stack.summary.count}` : ''}` +
        `${this.ready ? '' : ' (window not ready yet)'}`,
    );
    this.hooks.window.send(IPC.TOAST_STATE, this.state());
  }

  private state(): ToastState {
    return {
      toasts: this.stack.toasts,
      summary: this.stack.summary,
      locale: this.hooks.locale(),
      reneMode: this.hooks.reneMode(),
      dark: this.hooks.dark(),
    };
  }

  /**
   * Runs the clock only while a card on the stack can expire
   *
   * @private
   */
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

  private isEmpty(): boolean {
    return this.stack.toasts.length === 0 && this.stack.summary === null;
  }

  /**
   * The page drew something, so whatever was waiting to be seen has now been seen
   *
   * The blackout is added back to every expiry, or a card that spent its whole life inside
   * a window being rebuilt is expired by a clock nobody could read.
   *
   * @private
   */
  private notePainted(): void {
    if (this.darkSince === null) return;
    const paused = this.hooks.now() - this.darkSince;
    this.darkSince = null;
    if (paused > 0) this.setStack(delayExpiries(this.stack, paused));
  }

  private tick(): void {
    if (this.darkSince !== null) return;
    if (this.hoveredSince !== null) return;
    const next = expireToasts(this.stack, this.hooks.now());
    if (next === this.stack) return;
    this.setStack(next);
    this.push();
    this.retime();
  }
}
