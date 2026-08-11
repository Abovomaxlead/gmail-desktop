// Two ways a notification failed the moment the app was not the window you were looking
// at — which is the only moment a notification is worth anything.
//
// The first is delivery. Gmail's page is what notices new mail and raises the
// notification; Chromium throttles a page whose window is covered by another one, and a
// throttled Gmail does not notice. So the mail surface must not be throttled, for the same
// reason Calendar already is not: a reminder that arrives when you look at it is not a
// reminder. Until now the service worker's own notification covered this up by going
// straight to the Windows shelf, outside the app entirely; that route is closed, so this
// one has to work.
//
// The second is the click. Opening the thread and clicking Gmail's pop-out button are two
// separate steps, and Gmail navigates between them asynchronously — so the button found
// first may still belong to the conversation that was open before, and clicking it pops
// out a completely different mail. The click therefore waits until the page is actually
// showing the thread it was asked for.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SURFACE_CONFIG } from '../renderer/lib/surfaces';
import type { AccountRef } from '../renderer/lib/account-ref';

describe('mail is not throttled while the window is in the background', () => {
  it('keeps the mail page running, like Calendar', () => {
    expect(SURFACE_CONFIG.mail.backgroundThrottling).toBe(false);
    expect(SURFACE_CONFIG.calendar.backgroundThrottling).toBe(false);
  });

  it('leaves the surfaces that raise nothing throttled', () => {
    for (const surface of ['drive', 'docs', 'sheets'] as const) {
      expect(SURFACE_CONFIG[surface].backgroundThrottling).toBe(true);
    }
  });
});

const { FakeWebContentsView, views } = vi.hoisted(() => {
  const views: FakeWebContentsView[] = [];
  class FakeWebContents {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    /** What the page is showing. Set by a hash write only after `navigationDelay` polls,
     * which is how Gmail behaves: the hash lands, the conversation follows. */
    hash = '#inbox/oldthread';
    pendingHash: string | null = null;
    navigationDelay = 0;
    scripts: string[] = [];
    clicked: string[] = [];
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
      const set = /^location\.hash = (.*)$/.exec(code);
      if (set) {
        const target = JSON.parse(set[1]) as string;
        if (this.navigationDelay <= 0) this.hash = target;
        else this.pendingHash = target;
        return Promise.resolve(undefined);
      }
      // The pop-out click script. It only clicks when the page is on the thread it was
      // given, so what it does depends on the hash right now.
      const wanted = /wantedHash = "([^"]*)"/.exec(code)?.[1];
      if (this.navigationDelay > 0) {
        this.navigationDelay -= 1;
        if (this.navigationDelay === 0 && this.pendingHash !== null) {
          this.hash = this.pendingHash;
          this.pendingHash = null;
        }
      }
      if (wanted !== undefined && wanted !== this.hash) return Promise.resolve(false);
      this.clicked.push(this.hash);
      this.emit('did-create-window');
      return Promise.resolve(true);
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

const owned: AccountRef = { kind: 'authuser', index: 0 };

function openMailView() {
  const win = {
    isDestroyed: () => false,
    on: () => {},
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1024, 768],
  };
  const m = new ProfileViewManager(
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
  m.show(owned, 'mail');
  return { m, wc: views[views.length - 1].webContents };
}

beforeEach(() => {
  views.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the pop-out waits for the thread it was asked for', () => {
  it('does not click the button belonging to the conversation already open', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox/oldthread';
    // Gmail takes two polls to follow the hash, and the old conversation — with its own
    // pop-out button — is on screen until it does.
    wc.navigationDelay = 2;

    const pending = m.popOutThread(accountKey(owned), 'newthread');
    await vi.advanceTimersByTimeAsync(3000);
    const ok = await pending;

    expect(ok).toBe(true);
    // The one thing that must never happen: popping out the mail that happened to be open.
    expect(wc.clicked).toEqual(['#inbox/newthread']);
  });

  it('clicks straight away when the page is already there', async () => {
    const { m, wc } = openMailView();
    wc.hash = '#inbox';

    await m.popOutThread(accountKey(owned), 'newthread');

    expect(wc.clicked).toEqual(['#inbox/newthread']);
  });

  it('gives up rather than click the wrong thread when the page never arrives', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox/oldthread';
    wc.navigationDelay = 999;

    const pending = m.popOutThread(accountKey(owned), 'newthread');
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toBe(false);
    expect(wc.clicked).toEqual([]);
  });
});
