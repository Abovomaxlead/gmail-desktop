// A stack that cannot paint used to be permanent: isBroken() stayed true for the rest of
// the session, every later notification took the Windows-shelf route instead, and nothing
// ever asked the page to try again — the one signal that clears the flag is a size report,
// and a window that is being routed around is never given a card to measure. So a single
// slow load poisoned every notification that came after it. Rebuilding is the way out, and
// it is bounded: a page broken for a reason a rebuild cannot fix must not turn every
// notification into a new window.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { created, FakeBrowserWindow } = vi.hoisted(() => {
  const created: FakeBrowserWindow[] = [];
  class FakeWebContents {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }
    send(): void {}
    setZoomFactor(): void {}
    isDestroyed(): boolean {
      return false;
    }
  }
  class FakeBrowserWindow {
    webContents = new FakeWebContents();
    destroyed = false;
    visible = false;
    constructor() {
      created.push(this);
    }
    setIgnoreMouseEvents(): void {}
    setBounds(): void {}
    setAlwaysOnTop(): void {}
    isVisible(): boolean {
      return this.visible;
    }
    showInactive(): void {
      this.visible = true;
    }
    getBounds() {
      return { x: 0, y: 0, width: 380, height: 100 };
    }
    hide(): void {}
    on(): void {}
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { created, FakeBrowserWindow };
});

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
}));

const {
  ToastWindow,
  TOAST_LOAD_TIMEOUT_MS,
  TOAST_REBUILD_ATTEMPTS,
  TOAST_REBUILD_RECOVER_AFTER_MS,
} = await import('../electron/toast/toast-window');

function toastWindow() {
  const broken = vi.fn();
  const w = new ToastWindow('preload.js', 'app://bundle/toasts.html', () => 1, () => {}, broken);
  return { w, broken };
}

/** Builds the window and lets the load watchdog trip, which is how it goes broken. */
async function breakIt(w: InstanceType<typeof ToastWindow>) {
  w.send('toast:state', {});
  await vi.advanceTimersByTimeAsync(TOAST_LOAD_TIMEOUT_MS + 10);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  created.length = 0;
  vi.useFakeTimers();
});

describe('a stack that cannot paint repairs itself', () => {
  it('is broken once the page never reports a size, and says so once', async () => {
    const { w, broken } = toastWindow();
    await breakIt(w);
    expect(w.isBroken()).toBe(true);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it('throws the dead window away and builds a fresh one', async () => {
    const { w } = toastWindow();
    await breakIt(w);
    const dead = created[0];

    expect(w.rebuild()).toBe(true);
    expect(dead.destroyed).toBe(true);
    expect(w.isBroken()).toBe(false);

    w.send('toast:state', {});
    expect(created).toHaveLength(2);
  });

  it('reports a size on the new window and is healthy again', async () => {
    const { w } = toastWindow();
    await breakIt(w);
    w.rebuild();
    w.applySize(380, 120);
    expect(w.isBroken()).toBe(false);
    // And the attempts it spent are given back, so a later hiccup is not the last straw.
    await breakIt(w);
    for (let i = 0; i < TOAST_REBUILD_ATTEMPTS; i++) expect(w.rebuild()).toBe(true);
  });

  it('gives up after a bounded number of attempts rather than loop', async () => {
    const { w } = toastWindow();
    for (let i = 0; i < TOAST_REBUILD_ATTEMPTS; i++) {
      await breakIt(w);
      expect(w.rebuild()).toBe(true);
    }
    await breakIt(w);
    expect(w.rebuild()).toBe(false);
    expect(w.isBroken()).toBe(true);
  });

  it('refuses to rebuild once destroyed', async () => {
    const { w } = toastWindow();
    await breakIt(w);
    w.destroy();
    expect(w.rebuild()).toBe(false);
  });
});

// Giving up used to be for the rest of the session, which put the original bug back one
// layer down: the attempts are spent in a single burst -- three render timeouts is eleven
// seconds -- and nothing ever gave them back, because the one signal that does is a size
// report and a stack being routed around is never asked to measure. So eleven bad seconds
// cost every notification until the app was restarted. The budget is about the rate of
// rebuilding, not a session total, exactly as the quota ceiling in gmail/quota.ts is.
describe('the rebuild budget refills', () => {
  /**
   * Spends every attempt, leaving the stack given up on
   *
   * @returns when the last attempt was spent, which is what the spell is counted from
   */
  const spendBudget = async (w: InstanceType<typeof ToastWindow>): Promise<number> => {
    let spentAt = 0;
    for (let i = 0; i < TOAST_REBUILD_ATTEMPTS; i++) {
      await breakIt(w);
      w.rebuild();
      spentAt = Date.now();
    }
    await breakIt(w);
    expect(w.rebuild()).toBe(false);
    return spentAt;
  };

  /** Moves the clock to a given point inside or past the spell. */
  const advanceToSpellAge = async (spentAt: number, age: number) => {
    await vi.advanceTimersByTimeAsync(spentAt + age - Date.now());
  };

  it('is willing to try again after a quiet spell', async () => {
    const { w } = toastWindow();
    const spentAt = await spendBudget(w);

    await advanceToSpellAge(spentAt, TOAST_REBUILD_RECOVER_AFTER_MS + 10);

    expect(w.rebuild()).toBe(true);
  });

  // The bound still has to hold within the spell, or a page that cannot be fixed turns
  // every notification into a new window -- which is what the bound was put there for.
  it('stays given up on while the spell is still running', async () => {
    const { w } = toastWindow();
    const spentAt = await spendBudget(w);

    await advanceToSpellAge(spentAt, TOAST_REBUILD_RECOVER_AFTER_MS - 10);

    expect(w.rebuild()).toBe(false);
  });

  // And a refilled budget is a whole one: the next bad patch gets the same three tries,
  // or the second spell would be over after one.
  it('gives back the whole budget, not one attempt', async () => {
    const { w } = toastWindow();
    const spentAt = await spendBudget(w);
    await advanceToSpellAge(spentAt, TOAST_REBUILD_RECOVER_AFTER_MS + 10);

    for (let i = 0; i < TOAST_REBUILD_ATTEMPTS; i++) {
      await breakIt(w);
      expect(w.rebuild()).toBe(true);
    }
    await breakIt(w);
    expect(w.rebuild()).toBe(false);
  });

  // A stack that came back to life is not on a cooldown at all -- noteAlive already gives
  // the attempts back, and that path must not start depending on the clock.
  it('still recovers immediately on a size report', async () => {
    const { w } = toastWindow();
    const spentAt = await spendBudget(w);
    await advanceToSpellAge(spentAt, TOAST_REBUILD_RECOVER_AFTER_MS + 10);
    w.rebuild();
    w.applySize(380, 120);

    await breakIt(w);
    expect(w.rebuild()).toBe(true);
  });
});
