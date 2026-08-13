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
//
// Every assignment to `stack` goes through setStack, which diffs the two and reports what
// left. That exists because main pins things per card — the WebContents that raised a
// relayed notification, the path a download card would open — and a card can leave the
// stack in five ways of which only one is a click. Announcing the departure from each
// mutator would mean five places to remember, and the one that was actually forgotten is
// the collapse, where five cards leave inside addToast without any dismiss being called.
//
// A departure is not only a card that was on the stack, which is why show() hands its new
// toast to the diff as well. A toast arriving into a collapse never lands: addToast folds
// it straight into the count, both for the sixth and for every arrival while the stack
// stays collapsed. Diffing only what was there before therefore missed every one of them,
// and since the summary's click looks at no card, nothing would ever have released them —
// an unbounded map of pinned WebContents that Gmail's page can fill in a loop.

import { IPC } from '../core/ipc';
import { notifyLog } from '../notify/notify-log';
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
import type { Toast, ToastAction, ToastStack, ToastState } from '../../renderer/lib/toast';


//===========================
// Types
//===========================

export type ToastInput = Omit<Toast, 'id' | 'expiresAt'> & { persist: boolean };

export interface ToastControllerHooks {
  window: ToastWindow;
  locale: () => 'en' | 'nl';
  reneMode: () => boolean;
  /** Asked per push rather than held, for the same reason locale is: the theme can change
   * while a card is on screen, and refresh() is then all it takes to redraw it. */
  dark: () => boolean;
  now: () => number;
  /** A card was clicked: open the mail, the settings panel, the download — whatever it stands for. */
  onActivate: (toast: Toast) => void;
  /** The summary was clicked: bring the app forward, on that account when there is one. */
  onActivateSummary: (accountKey: string | null) => void;
  onAction: (toast: Toast, action: ToastAction) => void;
  /** A card left the stack without being acted on — the close box, Dismiss all, its expiry,
   * or a collapse into the summary. Whatever main pinned for as long as it was on screen
   * can go. Not called for activate or runAction: those hand the toast to a callback that
   * consumes the same things, and releasing them first would break the click. */
  onDiscard?: (toast: Toast) => void;
}


//===========================
// Constants
//===========================

/** How long a toast lives when its account has the persist switch turned off. */
export const TOAST_LIFETIME_MS = 6000;

const TICK_MS = 500;

/** How often the pointer is checked against the window while the stack is hovered. Runs
 * only while something is hovered and stops itself the moment it is not, so this is a
 * handful of cursor reads around an actual hover rather than a background poll. Fast
 * enough that the close box going out is not seen as a delay. */
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
  /** When the stack got its first card with nothing yet on screen, or null once the page
   * has reported a size for it. A card only fades after it has been seen, and until this
   * clears there is nothing to have seen: the window is still being built, the page is
   * still compiling, or it is being thrown away and built again. Counted down and then
   * added back exactly as a hover is, since it is the same rule — time in which nobody
   * could have read the card does not count against it. */
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
    // An empty stack means no window is up, so this card starts its life unseen. What
    // ends that is a size report, which is the page saying it drew something.
    if (this.isEmpty() && this.darkSince === null) this.darkSince = this.hooks.now();
    this.seq += 1;
    const toast: Toast = {
      ...rest,
      id: `t${this.seq}`,
      ...(persist ? {} : { expiresAt: this.hooks.now() + TOAST_LIFETIME_MS }),
    };
    // A sixth arrival collapses the five below it, and those five leave here without any
    // dismiss being called on them — which is why the departure is diffed rather than
    // announced by each mutator. The new toast is handed to the diff too: when it is the
    // one that caused the collapse, or when it arrives into a stack already collapsed, it
    // is swallowed by the count without ever appearing on either side of the diff.
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
    this.setStack(dismissAll(this.stack));
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
    // Nothing is left to discard here, and that is a property of the collapse rather than
    // of this method: a summary holds no cards, and every toast it counts — the five it
    // replaced, the arrival that replaced them, and each one that has been folded into the
    // count since — was released as it went in. It has to be, because this click looks at
    // no webNotifyId, so anything still pinned when a summary is clicked is pinned for
    // good. dismissAll below therefore has nothing to announce; setStack is left to work
    // that out rather than being told, as everywhere else.
    this.setStack(dismissAll(this.stack));
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
      // The page is the only thing that can say a hover started, and the last thing that
      // can be relied on to say it ended, so the watch starts with every hover.
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
   * A pointer leaving a click-through window generates no event, so the last card the page
   * saw under it stays hovered for good: close box lit, actions showing, expiry paused.
   * Asking the system where the cursor is settles it. Self-terminating — anything that ends
   * a hover by another route (the stack emptying, a drain, the page reporting it first)
   * leaves hoveredSince null and the next tick stops the watch — so no other path has to
   * remember this exists.
   *
   * @private
   */
  private checkHover(): void {
    if (this.hoveredSince === null) return this.stopHoverWatch();
    if (this.hooks.window.containsCursor()) return;
    this.setHovered(false);
    // The page keeps the visual half of the hover — which card is lit — and it has no way
    // of learning this by itself, for exactly the reason the watch exists.
    this.hooks.window.send(IPC.TOAST_HOVER_END, null);
  }

  /**
   * The page measured itself
   *
   * Collapse if it does not fit, otherwise size the window to it.
   *
   * @param cssWidth
   * @param cssHeight
   */
  applySize(cssWidth: number, cssHeight: number): void {
    // Before anything is decided about the measurement: the report arriving at all is what
    // the window's watchdog is waiting for, and the two paths below that never reach
    // window.applySize — an empty stack, a collapse that re-lays out instead of resizing —
    // would otherwise leave a perfectly healthy page counted as broken.
    this.hooks.window.noteAlive();
    this.notePainted();
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
   * For an owner that has to get these notifications out some other way — the window went
   * broken with cards already queued, and a queue nobody will ever draw is the silence
   * decision 8 forbids.
   *
   * One call does both halves on purpose. The caller raises a system notification per
   * toast, which is a good deal of work to do while a stack still holds them; emptying
   * first means anything that ripples back cannot land on toasts that are about to be
   * raised anyway, and a second call finds nothing, so nothing is raised twice. The cards
   * leave the stack for good, so what they pinned is released with them — the notification
   * that stands in for them carries no click back to it.
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
   * What left is worked out once here instead of being remembered at seven call sites — the
   * point being that the next mutator written here cannot forget to release what its cards
   * were holding.
   *
   * What is compared is everything that was in play — the previous cards plus `arrived`,
   * the toast this assignment is adding — against what the next stack still shows. Absent
   * from the next stack means gone, whether it left the stack or never reached it, since a
   * collapse swallows an arrival exactly as thoroughly as it swallows the five below it.
   * A throwing hook is main's problem and must not stop the stack updating.
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
      // Nothing left to be seen, so nothing is waiting to be seen either. Left set, the
      // next card would inherit a blackout that started before it existed.
      this.darkSince = null;
      this.hooks.window.hide();
      if (this.ready) this.hooks.window.send(IPC.TOAST_STATE, this.state());
      return;
    }
    // Paired with the page's own line on the other side of this send. Two lines that do not
    // pair up are the whole diagnosis: main pushed a state the page never received, which
    // is a window that is not there rather than a stack that is not working.
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
   * The blackout is added back to every expiry, which is what stops a card that spent its
   * whole life inside a window being rebuilt from being expired by a clock nobody could
   * read.
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
    // Nothing on screen yet: the countdown has not started, however long ago the card
    // arrived. Without this a stack that takes nine seconds to get a window — three
    // rebuilds in a dev server, in the log this was written from — expires its cards
    // before the first of them is ever drawn, and the mail is lost with no card and no
    // system notification either.
    if (this.darkSince !== null) return;
    if (this.hoveredSince !== null) return;
    const next = expireToasts(this.stack, this.hooks.now());
    if (next === this.stack) return;
    this.setStack(next);
    this.push();
    this.retime();
  }
}
