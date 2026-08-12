// The controller's onDiscard hook. Main pins two things for as long as a card is up — the
// WebContents that raised a relayed notification, and the path a download card would open —
// and only a click ever released them. Every other way off the stack left the entry behind,
// which for the relayed ones means a live WebContents reference kept alive by a card nobody
// can reach any more, in a map Gmail's page can grow in a loop.
//
// The hook is computed by diffing the stack rather than called from each mutator, so the
// test that matters is that it covers the paths nobody remembered: not just dismiss, but the
// expiry timer and the collapse into a summary — collapsed cards are especially easy to miss
// because the summary's click goes to activateSummary, which never looks at webNotifyId, so
// their sources become unreachable without ever passing through activate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastController, TOAST_LIFETIME_MS } from '../electron/toast-controller';
import type { ToastInput } from '../electron/toast-controller';
import type { ToastWindow } from '../electron/toast-window';
import type { Toast } from '../renderer/lib/toast';

function fakeWindow(overrides: Partial<ToastWindow> = {}): ToastWindow {
  return {
    send: () => undefined,
    setInteractive: () => undefined,
    wouldOverflow: () => false,
    applySize: () => undefined,
    reposition: () => undefined,
    hide: () => undefined,
    destroy: () => undefined,
    applyZoom: () => undefined,
    isBroken: () => false,
    noteAlive: () => undefined,
    ...overrides,
  } as unknown as ToastWindow;
}

function mailInput(n: number, persist = true): ToastInput {
  return {
    kind: 'mail',
    title: `Sender ${n}`,
    body: `Subject ${n}`,
    webNotifyId: `src-${n}`,
    persist,
  };
}

interface Harness {
  controller: ToastController;
  discarded: Toast[];
  activated: Toast[];
  acted: Toast[];
  setNow: (ms: number) => void;
}

function harness(window: ToastWindow = fakeWindow()): Harness {
  const discarded: Toast[] = [];
  const activated: Toast[] = [];
  const acted: Toast[] = [];
  let clock = 0;
  const controller = new ToastController({
    window,
    locale: () => 'en',
    reneMode: () => false,
    dark: () => false,
    now: () => clock,
    onActivate: (t) => activated.push(t),
    onActivateSummary: () => undefined,
    onAction: (t) => acted.push(t),
    onDiscard: (t) => discarded.push(t),
  });
  return { controller, discarded, activated, acted, setNow: (ms) => (clock = ms) };
}

const ids = (toasts: Toast[]): string[] => toasts.map((t) => t.webNotifyId ?? t.id);

describe('ToastController onDiscard', () => {
  it('fires for a card removed by its close box', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.dismiss('t1');
    expect(ids(h.discarded)).toEqual(['src-1']);
  });

  it('fires for every card cleared by Dismiss all', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.show(mailInput(3));
    h.controller.dismissAll();
    expect(ids(h.discarded)).toEqual(['src-1', 'src-2', 'src-3']);
  });

  it('fires for a card that reached its expiry', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mailInput(1, false));
    h.controller.show(mailInput(2));
    // The page drew them. Nothing expires before that, on purpose — see the blackout
    // tests below — so an expiry test has to say so.
    h.controller.applySize(380, 184);
    h.setNow(TOAST_LIFETIME_MS + 1);
    vi.advanceTimersByTime(TOAST_LIFETIME_MS + 1000);
    expect(ids(h.discarded)).toEqual(['src-1']);
  });

  // The one nobody would have written by hand at a call site: the stack collapses inside
  // addToast, so the five cards leave without any dismiss ever being called on them. The
  // sixth is one of them — it never lands on the stack it collapsed, so a diff that only
  // looks at what was there before never sees it leave.
  it('fires for every card the sixth arrival collapsed into the summary, the sixth included', () => {
    const h = harness();
    for (let n = 1; n <= 6; n += 1) h.controller.show(mailInput(n));
    expect(ids(h.discarded)).toEqual(['src-1', 'src-2', 'src-3', 'src-4', 'src-5', 'src-6']);
  });

  // And the map keeps growing for as long as the stack stays collapsed: every arrival after
  // the sixth goes straight into the count, so nothing about it is ever on the stack. This
  // is the unbounded one — Gmail's page can raise these in a loop.
  it('fires for every arrival into an already collapsed stack', () => {
    const h = harness();
    for (let n = 1; n <= 9; n += 1) h.controller.show(mailInput(n));
    expect(ids(h.discarded)).toEqual([
      'src-1', 'src-2', 'src-3', 'src-4', 'src-5', 'src-6', 'src-7', 'src-8', 'src-9',
    ]);
  });

  // The claim activateSummary's comment makes: by the time the summary is clicked, nothing
  // it stands for is still pinned. The click itself looks at no webNotifyId, so anything
  // still held here would never be released by anything.
  it('has released everything the summary stands for before the summary is clicked', () => {
    const h = harness();
    for (let n = 1; n <= 7; n += 1) h.controller.show(mailInput(n));
    expect(ids(h.discarded)).toHaveLength(7);
    h.controller.activateSummary();
    expect(ids(h.discarded)).toHaveLength(7);
  });

  it('fires for every card the height guard collapsed into the summary', () => {
    const h = harness(fakeWindow({ wouldOverflow: () => true }));
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.applySize(380, 4000);
    expect(ids(h.discarded)).toEqual(['src-1', 'src-2']);
  });

  // Activate and runAction hand the toast to a callback that consumes what it pinned, so
  // firing the hook as well would delete the source before the click could travel back
  // through it — the bug the leak fix must not introduce.
  it('does not fire for a card that was clicked', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.activate('t1');
    expect(h.discarded).toEqual([]);
    expect(ids(h.activated)).toEqual(['src-1']);
  });

  it('does not fire for a card whose action button was used', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.runAction('t1', 'archive');
    expect(h.discarded).toEqual([]);
    expect(ids(h.acted)).toEqual(['src-1']);
  });

  it('leaves the other cards alone when one is clicked', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.activate('t1');
    expect(h.discarded).toEqual([]);
    h.controller.dismiss('t2');
    expect(ids(h.discarded)).toEqual(['src-2']);
  });

  it('is optional, so a controller without one still runs every path', () => {
    const controller = new ToastController({
      window: fakeWindow(),
      locale: () => 'en',
      reneMode: () => false,
      dark: () => false,
      now: () => 0,
      onActivate: () => undefined,
      onActivateSummary: () => undefined,
      onAction: () => undefined,
    });
    controller.show(mailInput(1));
    expect(() => controller.dismissAll()).not.toThrow();
  });

  // A throwing hook is main's problem, not a reason for the stack to stop updating.
  it('survives a hook that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = new ToastController({
      window: fakeWindow(),
      locale: () => 'en',
      reneMode: () => false,
      dark: () => false,
      now: () => 0,
      onActivate: () => undefined,
      onActivateSummary: () => undefined,
      onAction: () => undefined,
      onDiscard: () => {
        throw new Error('boom');
      },
    });
    controller.show(mailInput(1));
    expect(() => controller.dismiss('t1')).not.toThrow();
    warn.mockRestore();
  });
});

// What the window's owner needs when the watchdog trips. The toasts that were already in
// the stack when the page went broken were accepted, never drawn, and nothing looks at
// them again — a startup burst across several accounts is lost in full, which is the
// silence decision 8 exists to prevent. They are only recoverable if the controller will
// hand them over, and hand them over in one go: main raises a system notification per
// toast, and a stack that was not emptied first would let that ripple back in.
describe('ToastController drain', () => {
  it('hands back what was queued and leaves nothing behind', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    const held = h.controller.drain();
    expect(ids(held.toasts)).toEqual(['src-1', 'src-2']);
    expect(h.controller.drain().toasts).toEqual([]);
  });

  it('hands back the summary a collapsed stack stands for', () => {
    const h = harness();
    for (let n = 1; n <= 6; n += 1) h.controller.show(mailInput(n));
    const held = h.controller.drain();
    expect(held.toasts).toEqual([]);
    expect(held.summary).toEqual({ count: 6, accountKey: null });
    expect(h.controller.drain().summary).toBeNull();
  });

  it('releases what the drained cards were pinning', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.drain();
    expect(ids(h.discarded)).toEqual(['src-1', 'src-2']);
  });

  it('hides the window and stops the expiry clock', () => {
    vi.useFakeTimers();
    let hidden = 0;
    const h = harness(fakeWindow({ hide: () => (hidden += 1) }));
    h.controller.show(mailInput(1, false));
    h.controller.drain();
    expect(hidden).toBe(1);
    // A surviving interval would tick over an empty stack for the rest of the session.
    expect(vi.getTimerCount()).toBe(0);
  });

  // main raises one system notification per drained toast, so a drain that handed the same
  // toast over twice would be a duplicate notification, not just a wasted call.
  it('hands each toast over once even if the window reports broken again', () => {
    const h = harness();
    h.controller.show(mailInput(1));
    const first = h.controller.drain();
    const second = h.controller.drain();
    expect(ids(first.toasts)).toEqual(['src-1']);
    expect(ids(second.toasts)).toEqual([]);
    expect(ids(h.discarded)).toEqual(['src-1']);
  });

  it('is a no-op on an empty stack rather than a hide and a push', () => {
    let hidden = 0;
    let sent = 0;
    const h = harness(fakeWindow({ hide: () => (hidden += 1), send: () => (sent += 1) }));
    const held = h.controller.drain();
    expect(held.toasts).toEqual([]);
    expect(held.summary).toBeNull();
    expect(hidden).toBe(0);
    expect(sent).toBe(0);
  });
});

// The window's watchdog declares the page broken unless a size report reaches it, and the
// report reaches it through the controller. Two of the controller's own paths never call
// window.applySize — an empty stack drops the report, and a stack that does not fit
// collapses and re-lays out instead of resizing — so if either of them swallowed the proof
// of life as well, a healthy page would be declared dead and every later notification
// would go out as a degraded system toast for the rest of the session.
describe('ToastController — a size report is proof of life', () => {
  it('notes the window alive even when the report is for an empty stack', () => {
    let alive = 0;
    const h = harness(fakeWindow({ noteAlive: () => (alive += 1) }));
    h.controller.applySize(380, 0);
    expect(alive).toBe(1);
  });

  it('notes the window alive when the measurement collapses the stack instead of sizing it', () => {
    let alive = 0;
    let sized = 0;
    const h = harness(
      fakeWindow({
        wouldOverflow: () => true,
        noteAlive: () => (alive += 1),
        applySize: () => (sized += 1),
      }),
    );
    h.controller.show(mailInput(1));
    h.controller.show(mailInput(2));
    h.controller.applySize(380, 4000);
    expect(sized).toBe(0);
    expect(alive).toBe(1);
  });
});

// A card that fades is given six seconds of being readable, and until the page reports a
// size there is nothing to read: no window yet, a dev server still compiling the route, or
// a stack being thrown away and built again. Counting those seconds against the card is how
// mail went missing entirely — the log that produced these tests shows three rebuilds, nine
// seconds, and a stack that was already empty by the second one, so nothing was ever drawn
// and nothing was ever fallen back to either.
describe('ToastController — nothing fades before it has been seen', () => {
  it('does not expire a card while the page has drawn nothing', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mailInput(1, false));

    h.setNow(TOAST_LIFETIME_MS * 3);
    vi.advanceTimersByTime(TOAST_LIFETIME_MS * 3);

    expect(h.discarded).toEqual([]);
  });

  it('gives the card its full life once the page finally draws it', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mailInput(1, false));

    // Nine seconds of rebuilding, then the page reports a size at last.
    h.setNow(9000);
    vi.advanceTimersByTime(9000);
    h.controller.applySize(380, 92);

    // Five seconds after that it is still up: the blackout was added back, so the six
    // start from here rather than from a card nobody could see.
    h.setNow(9000 + TOAST_LIFETIME_MS - 1000);
    vi.advanceTimersByTime(TOAST_LIFETIME_MS - 1000);
    expect(h.discarded).toEqual([]);

    h.setNow(9000 + TOAST_LIFETIME_MS + 1000);
    vi.advanceTimersByTime(2000);
    expect(ids(h.discarded)).toEqual(['src-1']);
  });

  it('does not hold a later card back once the stack is painting', () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.show(mailInput(1, false));
    h.controller.applySize(380, 92);

    h.setNow(TOAST_LIFETIME_MS + 1000);
    vi.advanceTimersByTime(TOAST_LIFETIME_MS + 1000);

    expect(ids(h.discarded)).toEqual(['src-1']);
  });
});

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
