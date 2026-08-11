// The hover that never ends. The stack window is click-through so the transparent strips
// between the cards do not swallow clicks meant for the desktop, and `forward: true` keeps
// mouse moves arriving — but nothing forwards a leave. Move the pointer off the stack in
// one movement, off the window edge rather than into a gap, and the page's last word on
// the subject is that a card is hovered. It has no way to find out otherwise: the giveaway
// is an event that does not arrive.
//
// What that cost was visible as: the close box and the action buttons of whichever card
// the pointer was last over stayed lit over an app nobody was pointing at, until the next
// notification happened to arrive. What it cost invisibly is in here too — a hovered stack
// does not count down, so every card with an expiry was frozen for as long as the phantom
// hover lasted.
//
// So main watches the cursor itself for as long as something is hovered. These tests are
// about that watch: that it ends the hover the page could not end, that it gives back the
// time the phantom hover paused, that it stops itself, and that it does not run when there
// is nothing to watch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOVER_WATCH_MS, ToastController, TOAST_LIFETIME_MS } from '../electron/toast-controller';
import type { ToastInput } from '../electron/toast-controller';
import type { ToastWindow } from '../electron/toast-window';
import { IPC } from '../electron/ipc';
import type { Toast } from '../renderer/lib/toast';

interface Harness {
  controller: ToastController;
  interactive: boolean[];
  sent: string[];
  cursorInside: (inside: boolean) => void;
  cursorReads: () => number;
  setNow: (ms: number) => void;
  discarded: Toast[];
}

function harness(): Harness {
  const interactive: boolean[] = [];
  const sent: string[] = [];
  const discarded: Toast[] = [];
  let inside = true;
  let reads = 0;
  let clock = 0;

  const window = {
    send: (channel: string) => sent.push(channel),
    setInteractive: (on: boolean) => interactive.push(on),
    containsCursor: () => {
      reads += 1;
      return inside;
    },
    wouldOverflow: () => false,
    applySize: () => undefined,
    reposition: () => undefined,
    hide: () => undefined,
    destroy: () => undefined,
    applyZoom: () => undefined,
    isBroken: () => false,
    noteAlive: () => undefined,
  } as unknown as ToastWindow;

  const controller = new ToastController({
    window,
    locale: () => 'en',
    reneMode: () => false,
    dark: () => false,
    now: () => clock,
    onActivate: () => undefined,
    onActivateSummary: () => undefined,
    onAction: () => undefined,
    onDiscard: (t) => discarded.push(t),
  });
  controller.markReady();

  return {
    controller,
    interactive,
    sent,
    discarded,
    cursorInside: (v) => (inside = v),
    cursorReads: () => reads,
    setNow: (ms) => (clock = ms),
  };
}

function mail(n: number, persist = true): ToastInput {
  return { kind: 'mail', title: `Sender ${n}`, body: `Subject ${n}`, persist };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the hover main has to end itself', () => {
  it('ends a hover the page never reported the end of, once the cursor is off the window', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));
    h.controller.setHovered(true);
    expect(h.interactive).toEqual([true]);

    // The pointer goes off the edge. No mousemove, no leave, nothing from the page.
    h.cursorInside(false);
    vi.advanceTimersByTime(HOVER_WATCH_MS);

    expect(h.interactive).toEqual([true, false]);
    expect(h.sent).toContain(IPC.TOAST_HOVER_END);
  });

  it('leaves a hover alone while the cursor is still over the stack', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));
    h.controller.setHovered(true);

    vi.advanceTimersByTime(HOVER_WATCH_MS * 10);

    expect(h.interactive).toEqual([true]);
    expect(h.sent).not.toContain(IPC.TOAST_HOVER_END);
  });

  // The reason this is not only cosmetic: a hovered stack does not count down, so a card
  // frozen by a phantom hover has to be given that time back exactly as a real one is,
  // or it disappears the instant the hover is noticed to be over.
  it('gives back the time the phantom hover paused, so no card vanishes on release', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1, false));
    h.controller.setHovered(true);

    h.setNow(5000);
    h.cursorInside(false);
    vi.advanceTimersByTime(HOVER_WATCH_MS);

    // Would have expired at TOAST_LIFETIME_MS without the 5s of paused time added back.
    h.setNow(TOAST_LIFETIME_MS + 4000);
    vi.advanceTimersByTime(1000);
    expect(h.discarded).toHaveLength(0);

    h.setNow(TOAST_LIFETIME_MS + 5001);
    vi.advanceTimersByTime(1000);
    expect(h.discarded).toHaveLength(1);
  });

  it('stops watching once the hover is over, rather than reading the cursor forever', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));
    h.controller.setHovered(true);
    h.cursorInside(false);
    vi.advanceTimersByTime(HOVER_WATCH_MS);

    const settled = h.cursorReads();
    vi.advanceTimersByTime(HOVER_WATCH_MS * 20);
    expect(h.cursorReads()).toBe(settled);
  });

  it('stops watching when the page reports the end of the hover first', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));
    h.controller.setHovered(true);
    h.controller.setHovered(false);

    const settled = h.cursorReads();
    vi.advanceTimersByTime(HOVER_WATCH_MS * 20);
    expect(h.cursorReads()).toBe(settled);
    // Nothing to tell the page: it is the one that said so.
    expect(h.sent).not.toContain(IPC.TOAST_HOVER_END);
  });

  it('does not read the cursor at all while nothing is hovered', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));

    vi.advanceTimersByTime(HOVER_WATCH_MS * 20);
    expect(h.cursorReads()).toBe(0);
  });

  it('stops watching when the stack is torn down under a live hover', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mail(1));
    h.controller.setHovered(true);
    h.controller.destroy();

    const settled = h.cursorReads();
    vi.advanceTimersByTime(HOVER_WATCH_MS * 20);
    expect(h.cursorReads()).toBe(settled);
  });
});
