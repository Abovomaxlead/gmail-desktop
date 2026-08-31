// The one funnel every caller of ensureView/show/warm passes through before a view is
// built: a (ref, surface) pair outside surfacesForRef must never reach
// SURFACE_CONFIG[surface].url(ref), or it throws inside a synchronous Electron callback
// and takes the main process down with it. tests/surfaces.test.ts already proves
// surfacesForRef itself is correct; that is not what broke — the wiring that was
// supposed to consult it before opening a view did not, at three different call sites.
// This file proves the wiring, not just the predicate, by driving the real
// ProfileViewManager and checking a view is (or is not) actually produced.
//
// 'electron' cannot run outside an Electron process, so it is faked down to the shape
// ProfileViewManager and external-links.ts actually touch: a WebContentsView with a
// webContents that supports on/once/loadURL/setZoomLevel/setAudioMuted/setWindowOpenHandler,
// and a host window with a contentView that can add and remove children.

import { describe, it, expect, vi } from 'vitest';
import type { AccountRef } from '../renderer/lib/account-ref';

const { FakeWebContentsView } = vi.hoisted(() => {
  class FakeWebContents {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    /** What main pushed into the page, in order. */
    sent: Array<{ channel: string; args: unknown[] }> = [];
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      return this.on(event, cb);
    }
    /** Drives what the real WebContents raises, so a test can act as the page. */
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }
    send(channel: string, ...args: unknown[]): void {
      this.sent.push({ channel, args });
    }
    setWindowOpenHandler(): void {}
    /** Where the page is, so a test can act as a redirect Google performed. */
    url = '';
    /** Every deliberate navigation in order, with a reload recorded as 'reload'. */
    navigations: string[] = [];
    loadURL(u: string): Promise<void> {
      this.url = u;
      this.navigations.push(u);
      return Promise.resolve();
    }
    getURL(): string {
      return this.url;
    }
    reload(): void {
      this.navigations.push('reload');
    }
    setZoomLevel(): void {}
    setAudioMuted(): void {}
    isDestroyed(): boolean {
      return false;
    }
    getTitle(): string {
      return '';
    }
    close(): void {}
  }
  class FakeWebContentsView {
    webContents = new FakeWebContents();
    visible = false;
    setVisible(v: boolean): void {
      this.visible = v;
    }
    setBounds(): void {}
  }
  return { FakeWebContentsView };
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
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getContentSize: () => [1024, 768],
  };
}

function manager(win: ReturnType<typeof fakeWin>, mayDragToSave?: (accountKey: string) => boolean | null) {
  return new ProfileViewManager(
    win as never,
    'preload.js',
    () => {},
    () => {},
    () => {},
    () => {},
    () => 0,
    () => false,
    () => 'app',
    () => 1,
    () => {},
    () => {},
    mayDragToSave,
  );
}

const urlLess: AccountRef = { kind: 'delegated', email: 'stub@example.nl', mailUrl: null, calendarUrl: null };
const withUrl: AccountRef = {
  kind: 'delegated',
  email: 'stub@example.nl',
  mailUrl: 'https://mail.google.com/mail/u/3/d/xyz/',
  calendarUrl: null,
};
const owned: AccountRef = { kind: 'authuser', index: 0 };

/** The fake page behind a view, as the reload tests need to see it. */
interface FakePage {
  url: string;
  navigations: string[];
}

/** The page of the nth view the manager built. */
function pageOf(win: ReturnType<typeof fakeWin>, n = 0): FakePage {
  return (win.contentView.addChildView.mock.calls[n][0] as { webContents: FakePage }).webContents;
}

describe('ProfileViewManager funnel guard', () => {
  it('ensureView refuses a delegated ref with no mailUrl for mail', () => {
    const win = fakeWin();
    const m = manager(win);
    m.ensureView(urlLess, 'mail', true);
    expect(win.contentView.addChildView).not.toHaveBeenCalled();
    expect(m.isShowing(accountKey(urlLess), 'mail')).toBe(false);
  });

  it('ensureView builds a view once a delegated ref has a mailUrl', () => {
    const win = fakeWin();
    const m = manager(win);
    m.ensureView(withUrl, 'mail', true);
    expect(win.contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(m.isShowing(accountKey(withUrl), 'mail')).toBe(true);
  });

  it('show() refuses silently rather than crash for a URL-less delegated ref', () => {
    const win = fakeWin();
    const m = manager(win);
    expect(() => m.show(urlLess, 'mail')).not.toThrow();
    expect(win.contentView.addChildView).not.toHaveBeenCalled();
    expect(m.activeKey()).toBeNull();
  });

  it('warm() refuses silently rather than crash for a URL-less delegated ref', () => {
    const win = fakeWin();
    const m = manager(win);
    expect(() => m.warm(urlLess, 'mail')).not.toThrow();
    expect(win.contentView.addChildView).not.toHaveBeenCalled();
  });

  it('an authuser ref is never refused, whatever the surface', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(owned, 'mail');
    expect(m.isShowing(accountKey(owned), 'mail')).toBe(true);
  });
});

// The dropzone is the way work mail is filed, so a mailbox outside the work domain must not
// be offered one: what it would file is private mail, into a mailbox the restriction exists
// to keep private mail out of. The view asks before it builds the strip, and the answer has
// to reach it — an answer that never arrives leaves no strip, which is the safe side, but a
// wrong `true` would put one in a private mailbox.
describe('who may offer drag-to-save', () => {
  const askFrom = (win: ReturnType<typeof fakeWin>, m: ReturnType<typeof manager>) => {
    m.ensureView(owned, 'mail', true);
    const view = win.contentView.addChildView.mock.calls[0][0] as {
      webContents: { emit(e: string, ...a: unknown[]): void; sent: Array<{ channel: string; args: unknown[] }> };
    };
    view.webContents.emit('ipc-message', {}, 'maildrop:allowed-get');
    return view.webContents.sent.filter((s) => s.channel === 'maildrop:allowed');
  };

  it('answers a work mailbox with yes', () => {
    const win = fakeWin();
    expect(askFrom(win, manager(win, () => true))).toEqual([{ channel: 'maildrop:allowed', args: [true] }]);
  });

  it('answers a mailbox outside the work domain with no', () => {
    const win = fakeWin();
    expect(askFrom(win, manager(win, () => false))).toEqual([{ channel: 'maildrop:allowed', args: [false] }]);
  });

  // Not passing the hook is what every caller with no opinion does, and it must not turn into
  // a silent refusal: that would take drag-to-save away from everyone at once.
  it('permits when no rule was wired', () => {
    const win = fakeWin();
    expect(askFrom(win, manager(win))).toEqual([{ channel: 'maildrop:allowed', args: [true] }]);
  });

  // The case that broke it the first time. A view is built before its account is registered,
  // so the first ask lands while nobody can name the mailbox. Answering that with false took
  // the dropzone away from the work mailboxes too, and answering true would hand one to a
  // private mailbox for the length of the gap. Neither: say nothing, and be asked again.
  it('says nothing while the mailbox behind the view is unknown', () => {
    const win = fakeWin();
    expect(askFrom(win, manager(win, () => null))).toEqual([]);
  });

  it('answers once the address arrives, having said nothing before', () => {
    const win = fakeWin();
    let email: string | null = null;
    const m = manager(win, () => (email === null ? null : email.endsWith('@work.nl')));
    m.ensureView(owned, 'mail', true);
    const view = win.contentView.addChildView.mock.calls[0][0] as {
      webContents: { emit(e: string, ...a: unknown[]): void; sent: Array<{ channel: string; args: unknown[] }> };
    };
    const sent = () => view.webContents.sent.filter((s) => s.channel === 'maildrop:allowed');

    view.webContents.emit('ipc-message', {}, 'maildrop:allowed-get');
    expect(sent()).toEqual([]);

    email = 'someone@work.nl';
    view.webContents.emit('ipc-message', {}, 'maildrop:allowed-get');
    expect(sent()).toEqual([{ channel: 'maildrop:allowed', args: [true] }]);
  });
});

// A pull locks every Gmail view, not the one that was dragged from: the drop handler is one
// module-level pull, so switching accounts mid-pull was the way to start a second one. The
// broadcast is what makes the lock true everywhere, and it has to stay off the other
// surfaces -- a veil over Calendar would be a bug nobody could explain.
describe('the pull lock reaches every Gmail view', () => {
  const second: AccountRef = { kind: 'authuser', index: 1 };
  const sentOn = (win: ReturnType<typeof fakeWin>, channel: string) =>
    win.contentView.addChildView.mock.calls
      .map((c: unknown[]) => c[0] as { webContents: { sent: Array<{ channel: string; args: unknown[] }> } })
      .map((v) => v.webContents.sent.filter((s) => s.channel === channel).length);

  it('locks the mail view of every account and leaves the other surfaces alone', () => {
    const win = fakeWin();
    const m = manager(win);
    m.ensureView(owned, 'mail', true);
    m.ensureView(second, 'mail', true);
    m.ensureView(owned, 'calendar', true);

    m.sendDropLock({ locked: true });

    // In the order the views were built: mail, mail, calendar.
    expect(sentOn(win, 'maildrop:lock')).toEqual([1, 1, 0]);
  });

  it('sends the count to every Gmail view as well, so each says why it is locked', () => {
    const win = fakeWin();
    const m = manager(win);
    m.ensureView(owned, 'mail', true);
    m.ensureView(second, 'mail', true);
    m.ensureView(owned, 'calendar', true);

    m.sendDropProgress({ done: 3, total: 10 });

    expect(sentOn(win, 'maildrop:save-progress')).toEqual([1, 1, 0]);
    const first = win.contentView.addChildView.mock.calls[0][0] as {
      webContents: { sent: Array<{ channel: string; args: unknown[] }> };
    };
    expect(first.webContents.sent.find((s) => s.channel === 'maildrop:save-progress')?.args).toEqual([
      { done: 3, total: 10 },
    ]);
  });
});

// A view's identity is the URL it was opened with, and reload used to forget it: reload()
// reloads wherever the page has since ended up. Signed out, a delegated /d/<id>/ url answers
// with a login page and, once the user signs back in, continues into the signed-in account's
// own inbox -- so Ctrl+R cemented the wrong mailbox in the delegated view instead of
// recovering it. See electron/windows/view-home.ts for what counts as having left home.
describe('reloading a view that was redirected away', () => {

  it('reloads in place while the view is still on its own mailbox', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(owned, 'mail');
    const wc = pageOf(win);
    wc.url = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbfWxH';
    wc.navigations.length = 0;

    m.reloadActive();

    expect(wc.navigations).toEqual(['reload']);
  });

  it('sends a delegated view left on the own inbox back to its mailbox', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(withUrl, 'mail');
    const wc = pageOf(win);
    // What signing back in leaves behind: the delegated segment is gone.
    wc.url = 'https://mail.google.com/mail/u/3/';
    wc.navigations.length = 0;

    m.reloadActive();

    expect(wc.navigations).toEqual(['https://mail.google.com/mail/u/3/d/xyz/']);
  });

  it('sends a view sitting on a login page back to its mailbox', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(withUrl, 'mail');
    const wc = pageOf(win);
    wc.url = 'https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/';
    wc.navigations.length = 0;

    m.reloadActive();

    expect(wc.navigations).toEqual(['https://mail.google.com/mail/u/3/d/xyz/']);
  });

  // A link the app itself routed into another surface becomes that view's home, so a reload
  // of an opened document reloads the document and does not jump back to My Drive.
  it('treats a navigation the app performed as the new home', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(owned, 'drive');
    const wc = pageOf(win);
    m.openInOwningSurface(owned, 'drive', 'https://drive.google.com/file/d/abc/view');
    wc.navigations.length = 0;

    m.reloadActive();

    expect(wc.navigations).toEqual(['reload']);
  });
});

// What the delegated health watch needs to put a redirected view right without waiting for the
// user to press Ctrl+R: the app knows where the view belongs, so it can simply send it back.
describe('sending a view back where it belongs', () => {

  it('reports where a view currently sits', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(withUrl, 'mail');
    pageOf(win).url = 'https://mail.google.com/mail/u/3/';

    expect(m.urlOf(accountKey(withUrl), 'mail')).toBe('https://mail.google.com/mail/u/3/');
  });

  it('navigates a drifted view back to the url it was opened with', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(withUrl, 'mail');
    const wc = pageOf(win);
    wc.url = 'https://mail.google.com/mail/u/3/';
    wc.navigations.length = 0;

    expect(m.sendHome(accountKey(withUrl), 'mail')).toBe(true);
    expect(wc.navigations).toEqual(['https://mail.google.com/mail/u/3/d/xyz/']);
  });

  // Nothing to send back is not a failure to hide: the caller logs off this answer, and a view
  // that is already home must not be reloaded out from under the user.
  it('leaves a view that is already home alone', () => {
    const win = fakeWin();
    const m = manager(win);
    m.show(withUrl, 'mail');
    const wc = pageOf(win);
    wc.navigations.length = 0;

    expect(m.sendHome(accountKey(withUrl), 'mail')).toBe(false);
    expect(wc.navigations).toEqual([]);
  });

  it('answers false for a view that does not exist', () => {
    const win = fakeWin();
    const m = manager(win);

    expect(m.sendHome(accountKey(withUrl), 'mail')).toBe(false);
    expect(m.urlOf(accountKey(withUrl), 'mail')).toBeNull();
  });
});
