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
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      return this.on(event, cb);
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
    () => 'app',
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
