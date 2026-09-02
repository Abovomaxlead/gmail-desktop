// Clicking a notification opened the right conversation and the wrong mail in it. A thread
// is opened by an id, and that id belongs to the thread's *first* message, so what Gmail
// unfolds is not the mail the card was about — and where Gmail instead unfolds the oldest
// unread reply, a thread holding several of them lands just as far back.
//
// So the view is told both: the conversation to go to, and the message to show once it is
// there. This file runs the second step against a fake conversation, the way the browser
// would: the script the app hands to Gmail's page is executed, not read.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AccountRef } from '../renderer/lib/account-ref';

const { FakeWebContentsView, views, FakeMessage } = vi.hoisted(() => {
  const views: FakeWebContentsView[] = [];

  /** One message block of the conversation on screen, as Gmail draws it. */
  class FakeMessage {
    clicks = 0;
    scrolls = 0;
    constructor(
      readonly id: string,
      private openBody: boolean,
    ) {}
    /** Folded, a message is a header row; open, it is as tall as the mail. */
    get offsetHeight(): number {
      return this.openBody ? 520 : 44;
    }
    parentElement: null = null;
    getAttribute(): null {
      return null;
    }
    querySelector(sel: string): { offsetParent: unknown; offsetHeight: number } | null {
      if (!sel.includes('.a3s') || !this.openBody) return null;
      return { offsetParent: {}, offsetHeight: 300 };
    }
    /** Clicking a folded message is what opens it, which is the whole point of the
     * click — and what the try after it is there to confirm. */
    click(): void {
      this.clicks++;
      this.openBody = true;
    }
    scrollIntoView(): void {
      this.scrolls++;
    }
  }

  class FakeWebContents {
    hash = '#inbox';
    scripts: string[] = [];
    /** The conversation Gmail draws once it has navigated. */
    conversation: FakeMessage[] = [];
    /** How many asks Gmail takes to arrive. Until then the page is still the inbox. */
    rendersAfter = 0;
    anchorAsks = 0;
    on() {
      return this;
    }
    once() {
      return this;
    }
    removeListener() {
      return this;
    }
    executeJavaScript(code: string): Promise<unknown> {
      this.scripts.push(code);
      if (code === 'location.hash') return Promise.resolve(this.hash);
      const set = /^location\.hash = (.*)$/.exec(code);
      if (set) {
        this.hash = JSON.parse(set[1]) as string;
        return Promise.resolve(undefined);
      }
      if (code.includes('data-legacy-message-id')) {
        this.anchorAsks++;
        const arrived = this.hash.startsWith('#inbox/') && this.anchorAsks > this.rendersAfter;
        const doc = {
          querySelectorAll: (sel: string) => {
            const m = /^\[data-legacy-message-id="([^"]+)"\]$/.exec(sel);
            if (!m || !arrived) return [];
            return this.conversation.filter((msg) => msg.id === m[1]);
          },
        };
        return Promise.resolve(new Function('document', `return ${code}`)(doc));
      }
      return Promise.resolve(undefined);
    }
    setWindowOpenHandler(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    /** Keyboard focus, which the manager hands to whatever is on screen. */
    focus(): void {}
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
      return 'Postvak IN - luca@example.com - Gmail';
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
  return { FakeWebContentsView, views, FakeMessage };
});

vi.mock('electron', () => ({
  WebContentsView: FakeWebContentsView,
  shell: { openExternal: () => {} },
}));

const { ProfileViewManager } = await import('../electron/windows/profile-view-manager');
const { accountKey } = await import('../renderer/lib/account-ref');

function fakeWin() {
  return {
    isDestroyed: () => false,
    on: () => {},
    isFocused: () => true,
    webContents: { focus: () => {}, isDestroyed: () => false },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: () => [1024, 768],
  };
}

function openMailView() {
  const m = new ProfileViewManager(
    fakeWin() as never,
    'preload.js',
    () => {},
    () => {},
    () => {},
    () => {},
    () => 0,
    () => false,
    () => 'app',
  );
  m.show({ kind: 'authuser', index: 0 } as AccountRef, 'mail');
  return { m, wc: views[views.length - 1].webContents };
}

/** The id of the thread is the id of its first message — the mail nobody was notified
 * about. The reply is what the card named. */
const THREAD = '1a01f12d2ec28372';
const REPLY = '1a01f14e87dea294';

const makeMessage = (id: string, open: boolean) => new FakeMessage(id, open);


afterEach(() => {
  views.length = 0;
  vi.useRealTimers();
});

describe('openMailThread points at the mail, not just the conversation', () => {
  it('unfolds the message the notification was about', async () => {
    const { m, wc } = openMailView();
    wc.conversation = [makeMessage(THREAD, true), makeMessage(REPLY, false)];

    m.openMailThread(accountKey({ kind: 'authuser', index: 0 }), THREAD, REPLY);
    await vi.waitFor(() => expect(wc.conversation[1].clicks).toBe(1));

    expect(wc.hash).toBe(`#inbox/${THREAD}`);
    expect(wc.conversation[1].scrolls).toBe(1);
    // The oldest message is left exactly as Gmail drew it.
    expect(wc.conversation[0].clicks).toBe(0);
  });

  it('leaves the page alone when no message is known', async () => {
    const { m, wc } = openMailView();
    wc.conversation = [makeMessage(THREAD, true)];

    m.openMailThread(accountKey({ kind: 'authuser', index: 0 }), THREAD);
    await new Promise((r) => setTimeout(r, 10));

    expect(wc.hash).toBe(`#inbox/${THREAD}`);
    expect(wc.anchorAsks).toBe(0);
    expect(wc.conversation[0].clicks).toBe(0);
  });

  it('keeps asking while Gmail is still navigating', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.conversation = [makeMessage(THREAD, true), makeMessage(REPLY, false)];
    wc.rendersAfter = 3;

    m.openMailThread(accountKey({ kind: 'authuser', index: 0 }), THREAD, REPLY);
    await vi.advanceTimersByTimeAsync(3000);

    // Three tries with nothing on screen, the fourth clicks, the fifth sees it open.
    expect(wc.anchorAsks).toBe(5);
    expect(wc.conversation[1].clicks).toBe(1);
  });

  it('gives up rather than clicking into a conversation that never arrived', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    wc.conversation = [makeMessage(REPLY, false)];
    wc.rendersAfter = 99;

    m.openMailThread(accountKey({ kind: 'authuser', index: 0 }), THREAD, REPLY);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(wc.conversation[0].clicks).toBe(0);
    // Twelve tries and no more: a later arrival is a different conversation by then.
    expect(wc.anchorAsks).toBe(12);
  });

  it('never puts an id Gmail did not write into the page', async () => {
    const { m, wc } = openMailView();

    m.openMailThread(accountKey({ kind: 'authuser', index: 0 }), THREAD, 'msg-f:187404');
    await new Promise((r) => setTimeout(r, 10));

    expect(wc.anchorAsks).toBe(0);
    expect(wc.scripts.some((s) => s.includes('msg-f'))).toBe(false);
  });
});

// Two cards for one conversation. The first anchor is still waiting for Gmail when the
// second click lands, and if it is left running it unfolds the older reply after the newer
// one — the bug arriving a second time, from behind.
describe('a later click owns the view', () => {
  it('drops the anchor that was still looking', async () => {
    vi.useFakeTimers();
    const { m, wc } = openMailView();
    const older = makeMessage(THREAD, false);
    const newer = makeMessage(REPLY, false);
    wc.conversation = [older, newer];
    wc.rendersAfter = 4;
    const key = accountKey({ kind: 'authuser', index: 0 });

    m.openMailThread(key, THREAD, THREAD);
    await vi.advanceTimersByTimeAsync(500);
    m.openMailThread(key, THREAD, REPLY);
    await vi.advanceTimersByTimeAsync(5000);

    expect(newer.clicks).toBe(1);
    expect(older.clicks).toBe(0);
  });
});
