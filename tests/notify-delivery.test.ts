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
//
// What "actually showing" means was wrong here before, and this file said so in a way that
// passed while the app shipped the bug. The fake below used to hold the hash back along
// with the conversation, as if the two moved together. They do not: the app writes
// `location.hash` itself, so it reads back as the target immediately — 81 milliseconds
// before a click that popped out a two-day-old mail, in the log that produced this note —
// while the page has not moved at all. The hash proves nothing, and the fake now behaves
// like the browser: the hash lands at once, and the title follows when Gmail arrives.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SURFACE_CONFIG } from '../renderer/lib/surfaces';
import type { AccountRef } from '../renderer/lib/account-ref';

describe('the mail view keeps its visibility signal', () => {
  // Turning throttling off for mail looks like the fix for "no notification while the
  // window is covered" and is the opposite: it also pins the Page Visibility API at
  // "visible", and Gmail only notifies when it believes you are not looking. Tried once,
  // and every notification in the app stopped. This test is the note that says so.
  it('leaves mail throttled, whatever it costs in liveliness', () => {
    expect(SURFACE_CONFIG.mail.backgroundThrottling).toBe(true);
  });

  it('leaves calendar unthrottled, since a reminder falls due unwatched', () => {
    expect(SURFACE_CONFIG.calendar.backgroundThrottling).toBe(false);
  });
});

const { FakeWebContentsView, views } = vi.hoisted(() => {
  const views: FakeWebContentsView[] = [];
  class FakeWebContents {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    /** Where the page has been told to go. A hash write lands here at once, as it does in
     * a browser. */
    hash = '#inbox/oldthread';
    /** What the page is showing, which is the thing that lags: `navigationDelay` polls
     * long, the conversation that was open before is still on screen with its own pop-out
     * button. The title is how it says so. */
    title = 'Oude mail - luca@example.com - Gmail';
    titleWhenRendered = 'Nieuwe offerte - luca@example.com - Gmail';
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
        this.hash = JSON.parse(set[1]) as string;
        return Promise.resolve(undefined);
      }
      // What the page reports about itself. The conversation catches up with the hash here,
      // a poll at a time, and until it does the title is still the old one.
      if (code.includes('hasButton')) {
        if (this.navigationDelay > 0) this.navigationDelay -= 1;
        else if (this.hash.startsWith('#inbox/')) {
          this.title = this.titleWhenRendered;
          // And Gmail throws away the id it was given for its own permalink one. Modelled
          // here because leaving it out is what let the app ship a click that could never
          // fire: the check it depended on compared the hash to the one it wrote, which is
          // gone by the time the conversation it was waiting for is on screen.
          this.hash = '#inbox/FMfcgzQhVrDqdSFCTfmJlfHgxhKCQwXv';
        }
        return Promise.resolve({ hash: this.hash, title: this.title, hasButton: true });
      }
      // The click, which reaches whichever conversation is on screen — the point being that
      // it must not be reached while that is the wrong one.
      this.clicked.push(this.title);
      this.emit('did-create-window');
      return Promise.resolve(true);
    }
    getTitle(): string {
      return this.title;
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

const { ProfileViewManager } = await import('../electron/windows/profile-view-manager');
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

    const pending = m.popOutThread(accountKey(owned), 'newthread', 'Nieuwe offerte');
    await vi.advanceTimersByTimeAsync(3000);
    const ok = await pending;

    expect(ok).toBe(true);
    // The one thing that must never happen: popping out the mail that happened to be open.
    expect(wc.clicked).toEqual(['Nieuwe offerte - luca@example.com - Gmail']);
  });

  it('clicks straight away when the page is already there', async () => {
    const { m, wc } = openMailView();
    wc.hash = '#inbox';

    await m.popOutThread(accountKey(owned), 'newthread', 'Nieuwe offerte');

    expect(wc.clicked).toEqual(['Nieuwe offerte - luca@example.com - Gmail']);
  });

  it('gives up rather than click the wrong thread when the page never arrives', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox/oldthread';
    wc.navigationDelay = 999;

    const pending = m.popOutThread(accountKey(owned), 'newthread', 'Nieuwe offerte');
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toBe(false);
    expect(wc.clicked).toEqual([]);
  });

  // The other half of "the hash is not evidence": by the time the right conversation is on
  // screen, Gmail has replaced the id we navigated with by its own permalink one. Requiring
  // the hash to still equal what we wrote means never clicking at all, which is what the
  // user saw — every notification opening the app's plain fallback window instead of
  // Gmail's pop-out.
  it('clicks even though Gmail rewrote the hash to its own id', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox';
    wc.navigationDelay = 1;

    const pending = m.popOutThread(accountKey(owned), 'newthread', 'Nieuwe offerte');
    await vi.advanceTimersByTimeAsync(2000);

    expect(await pending).toBe(true);
    expect(wc.clicked).toEqual(['Nieuwe offerte - luca@example.com - Gmail']);
  });

  // The hash is not evidence, and this is the case that proves it: it is the target from
  // the first poll, the button is there from the first poll, and the mail on screen is
  // still the wrong one. Guarding on the hash alone clicks here.
  it('is not fooled by the hash it wrote itself', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.hash = '#inbox/oldthread';
    wc.navigationDelay = 3;

    const pending = m.popOutThread(accountKey(owned), 'newthread', 'Nieuwe offerte');
    // Long enough for four polls; the first three still show the old conversation.
    await vi.advanceTimersByTimeAsync(800);
    await pending;

    expect(wc.clicked).toEqual(['Nieuwe offerte - luca@example.com - Gmail']);
  });
});
