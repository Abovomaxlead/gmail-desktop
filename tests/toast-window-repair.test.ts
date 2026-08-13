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

const { ToastWindow, TOAST_LOAD_TIMEOUT_MS, TOAST_REBUILD_ATTEMPTS } = await import(
  '../electron/toast/toast-window'
);

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
