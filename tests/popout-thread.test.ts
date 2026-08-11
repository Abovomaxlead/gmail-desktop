// "Open in a new window" for a clicked notification cannot be done without touching the
// mail view: only Gmail can produce a working pop-out, and its button only exists while
// the thread is open. So the app opens the thread in the view, clicks the button, and —
// what this file is about — puts the view back where it was. Without that last step the
// message is left sitting in the main window too, which is the one thing "open in a new
// window" promises it will not do.
//
// 'electron' is faked down to what popOutThread touches: a webContents that runs scripts
// (the hash read, the hash write, the button click) and emits did-create-window when the
// click opens the pop-out.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AccountRef } from '../renderer/lib/account-ref';

const { FakeWebContentsView, views } = vi.hoisted(() => {
  const views: FakeWebContentsView[] = [];
  class FakeWebContents {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    hash = '#inbox';
    scripts: string[] = [];
    buttonAppears = true;
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      return this.on(event, cb);
    }
    removeListener(event: string, cb: (...args: unknown[]) => void) {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb));
      return this;
    }
    emit(event: string): void {
      for (const cb of this.handlers.get(event) ?? []) cb();
    }
    executeJavaScript(code: string): Promise<unknown> {
      this.scripts.push(code);
      if (code === 'location.hash') return Promise.resolve(this.hash);
      if (code.includes('170693')) {
        if (!this.buttonAppears) return Promise.resolve(false);
        // The click is what opens the pop-out, so the window appears now.
        this.emit('did-create-window');
        return Promise.resolve(true);
      }
      const set = /^location\.hash = (.*)$/.exec(code);
      if (set) this.hash = JSON.parse(set[1]) as string;
      return Promise.resolve(undefined);
    }
    setWindowOpenHandler(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    setZoomLevel(): void {}
    setAudioMuted(): void {}
    isDestroyed(): boolean {
      return false;
    }
    isLoading(): boolean {
      return false;
    }
    getURL(): string {
      return 'https://mail.google.com/mail/u/0/';
    }
    getTitle(): string {
      return '';
    }
    close(): void {}
  }
  class FakeWebContentsView {
    webContents = new FakeWebContents();
    visible = false;
    constructor() {
      views.push(this);
    }
    setVisible(v: boolean): void {
      this.visible = v;
    }
    setBounds(): void {}
  }
  return { FakeWebContentsView, views };
});

vi.mock('electron', () => ({
  WebContentsView: FakeWebContentsView,
  shell: { openExternal: () => {} },
}));

const { ProfileViewManager } = await import('../electron/profile-view-manager');
const { accountKey } = await import('../renderer/lib/account-ref');

function fakeWin() {
  return {
    isDestroyed: () => false,
    on: () => {},
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1024, 768],
  };
}

function manager(win: ReturnType<typeof fakeWin>) {
  return new ProfileViewManager(
    win as never,
    'preload.js',
    () => {},
    () => {},
    () => {},
    () => {},
    () => 0,
    () => false,
    () => 'window',
  );
}

const owned: AccountRef = { kind: 'authuser', index: 0 };

function openMailView() {
  const win = fakeWin();
  const m = manager(win);
  m.show(owned, 'mail');
  return { m, wc: views[views.length - 1].webContents };
}

/** The pop-out cannot happen without this: Gmail's button only exists on an open thread. */
function openedTheThread(wc: { scripts: string[] }): boolean {
  return wc.scripts.some((s) => s.includes('#inbox/abc123'));
}

afterEach(() => {
  views.length = 0;
  vi.useRealTimers();
});

describe('popOutThread leaves the mail view where it found it', () => {
  it('opens the thread only long enough to click, then restores the hash', async () => {
    const { m, wc } = openMailView();
    wc.hash = '#inbox';

    const ok = await m.popOutThread(accountKey(owned), 'abc123');

    expect(ok).toBe(true);
    expect(openedTheThread(wc)).toBe(true);
    // But the view is not left on it.
    expect(wc.hash).toBe('#inbox');
  });

  it('restores the label the user was actually on, not just the inbox', async () => {
    const { m, wc } = openMailView();
    wc.hash = '#label/Facturen';

    await m.popOutThread(accountKey(owned), 'abc123');

    expect(openedTheThread(wc)).toBe(true);
    expect(wc.hash).toBe('#label/Facturen');
  });

  it('restores the view even when the pop-out button never appears', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox';
    wc.buttonAppears = false;

    const pending = m.popOutThread(accountKey(owned), 'abc123');
    await vi.advanceTimersByTimeAsync(5000);
    const ok = await pending;

    expect(ok).toBe(false);
    expect(openedTheThread(wc)).toBe(true);
    expect(wc.hash).toBe('#inbox');
  });

  it('leaves a view that was already on the thread alone', async () => {
    const { m, wc } = openMailView();
    wc.hash = '#inbox/abc123';

    await m.popOutThread(accountKey(owned), 'abc123');

    expect(wc.hash).toBe('#inbox/abc123');
  });

  it('falls back to the inbox when the view had no hash at all', async () => {
    const { m, wc } = openMailView();
    wc.hash = '';

    await m.popOutThread(accountKey(owned), 'abc123');

    expect(openedTheThread(wc)).toBe(true);
    expect(wc.hash).toBe('#inbox');
  });
});
