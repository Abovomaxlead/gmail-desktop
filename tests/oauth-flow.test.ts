// Access tokens and forced refreshes. oauth-flow.ts requires `electron` lazily inside
// postForm, which vi.mock cannot reach, so the test fills Node's CJS cache instead.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import { accessTokenFor, forceRefresh, connectAccount } from '../electron/auth/oauth-flow';
import type { OAuthConfig, StoredToken } from '../electron/auth/google-oauth';
import type { OAuthStore } from '../electron/auth/oauth-store';

const ELECTRON_ID = require.resolve('electron');
let realElectron: NodeJS.Module | undefined;

let respond: ((json: unknown) => void) | null = null;

type Handler = (...args: unknown[]) => void;

let requestCount = 0;

const fakeNet = {
  request: () => {
    requestCount++;
    const reqHandlers = new Map<string, Handler>();
    respond = (json) => {
      const resHandlers = new Map<string, Handler>();
      const res = {
        statusCode: 200,
        on: (event: string, fn: Handler) => resHandlers.set(event, fn),
      };
      reqHandlers.get('response')?.(res);
      resHandlers.get('data')?.(Buffer.from(JSON.stringify(json), 'utf8'));
      resHandlers.get('end')?.();
    };
    return {
      setHeader: () => undefined,
      on: (event: string, fn: Handler) => reqHandlers.set(event, fn),
      write: () => undefined,
      end: () => undefined,
    };
  },
};

// A stand-in for the WebContentsView consentCode attaches over the window; tests reach it
// through `createdViews` and fire the events consentCode listens for.
class FakeWebContents {
  private handlers = new Map<string, Handler[]>();
  loadURL = vi.fn(() => Promise.resolve());
  close = vi.fn();
  private destroyed = false;

  on(event: string, fn: Handler): void {
    const fns = this.handlers.get(event) ?? [];
    fns.push(fn);
    this.handlers.set(event, fns);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeWebContentsView {
  webContents = new FakeWebContents();
  setBounds(): void {}
  constructor() {
    createdViews.push(this);
  }
}

let createdViews: FakeWebContentsView[] = [];


beforeEach(() => {
  realElectron = require.cache[ELECTRON_ID];
  require.cache[ELECTRON_ID] = {
    id: ELECTRON_ID,
    filename: ELECTRON_ID,
    loaded: true,
    exports: { net: fakeNet, WebContentsView: FakeWebContentsView },
  } as unknown as NodeJS.Module;
  respond = null;
  requestCount = 0;
  createdViews = [];
});

afterEach(() => {
  if (realElectron) require.cache[ELECTRON_ID] = realElectron;
  else delete require.cache[ELECTRON_ID];
});

const NOW = 1_800_000_000_000;
const cfg: OAuthConfig = { clientId: 'cid', clientSecret: 'secret' };

const expired = (): StoredToken => ({
  accessToken: 'oud',
  refreshToken: 'RT',
  expiresAt: NOW - 1,
  scopes: ['a'],
});

function fakeStore(initial: Record<string, StoredToken>) {
  const map = new Map(Object.entries(initial));
  const written: string[] = [];
  const store = {
    get: (email: string) => map.get(email),
    set: (email: string, token: StoredToken) => {
      written.push(email);
      map.set(email, token);
    },
    remove: (email: string) => map.delete(email),
  };
  return { store: store as unknown as OAuthStore, map, written };
}

describe('connectAccount', () => {
  // No window is passed on purpose: reaching the consent view at all would throw on it,
  // so returning an answer proves the address was refused before anything was opened.
  const noWindow = null as unknown as BrowserWindow;

  it('refuses an address outside the work domain before opening consent', async () => {
    const { store, written } = fakeStore({});
    const result = await connectAccount(noWindow, 'persist:test', cfg, store, 'luca@gmail.com', NOW);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining('abovomaxlead.nl') });
    expect(written).toEqual([]);
  });

  it('stores nothing for a refused address, even one it already had a token for', async () => {
    const { store, map, written } = fakeStore({ 'luca@gmail.com': expired() });
    await connectAccount(noWindow, 'persist:test', cfg, store, 'luca@gmail.com', NOW);
    expect(written).toEqual([]);
    expect(map.get('luca@gmail.com')?.accessToken).toBe('oud');
  });

  it('settles with an error and detaches the view when the consent page fails to load', async () => {
    const { store, written } = fakeStore({});
    const removeChildView = vi.fn();
    const win = {
      getContentSize: () => [800, 600],
      contentView: { addChildView: vi.fn(), removeChildView },
    } as unknown as BrowserWindow;

    const pending = connectAccount(win, 'persist:test', cfg, store, 'luca@abovomaxlead.nl', NOW);
    expect(createdViews).toHaveLength(1);
    const view = createdViews[0];
    // no network/DNS: the main frame fails before will-navigate or will-redirect ever fire
    view.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://x', true);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(removeChildView).toHaveBeenCalledWith(view);
    expect(view.webContents.close).toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('ignores a sub-frame load failure and still detaches on the real settlement', async () => {
    const { store } = fakeStore({});
    const removeChildView = vi.fn();
    const win = {
      getContentSize: () => [800, 600],
      contentView: { addChildView: vi.fn(), removeChildView },
    } as unknown as BrowserWindow;

    const pending = connectAccount(win, 'persist:test', cfg, store, 'luca@abovomaxlead.nl', NOW);
    const view = createdViews[0];
    view.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://ads.example', false);
    view.webContents.emit('destroyed');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(removeChildView).toHaveBeenCalledWith(view);
  });
});

describe('accessTokenFor', () => {
  it('slaat het verlengde token op zolang het account gekoppeld blijft', async () => {
    const { store, map, written } = fakeStore({ 'a@x.nl': expired() });
    const pending = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    respond!({ access_token: 'nieuw', expires_in: 3600 });
    await expect(pending).resolves.toBe('nieuw');
    expect(written).toEqual(['a@x.nl']);
    expect(map.get('a@x.nl')?.accessToken).toBe('nieuw');
  });

  it('schrijft niets terug als het account tijdens de verlenging verwijderd is', async () => {
    const { store, map, written } = fakeStore({ 'a@x.nl': expired() });
    const pending = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    store.remove('a@x.nl');
    respond!({ access_token: 'nieuw', expires_in: 3600 });
    await expect(pending).resolves.toBeNull();
    expect(written).toEqual([]);
    expect(map.has('a@x.nl')).toBe(false);
  });

  it('coalesces two concurrent callers into one refresh request and one store write', async () => {
    const { store, map, written } = fakeStore({ 'a@x.nl': expired() });
    const first = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    const second = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    expect(requestCount).toBe(1);
    respond!({ access_token: 'nieuw', expires_in: 3600 });
    await expect(first).resolves.toBe('nieuw');
    await expect(second).resolves.toBe('nieuw');
    expect(requestCount).toBe(1);
    expect(written).toEqual(['a@x.nl']);
    expect(map.get('a@x.nl')?.accessToken).toBe('nieuw');
  });

  it('refreshes again on a later expiry once the in-flight request has settled', async () => {
    const { store, map } = fakeStore({ 'a@x.nl': expired() });
    const first = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    respond!({ access_token: 'eerste', expires_in: 3600 });
    await expect(first).resolves.toBe('eerste');

    map.set('a@x.nl', expired());
    const second = accessTokenFor(cfg, store, 'a@x.nl', NOW);
    expect(requestCount).toBe(2);
    respond!({ access_token: 'tweede', expires_in: 3600 });
    await expect(second).resolves.toBe('tweede');
  });
});

describe('forceRefresh', () => {
  it('slaat het verlengde token op zolang het account gekoppeld blijft', async () => {
    const { store, map, written } = fakeStore({ 'a@x.nl': expired() });
    const pending = forceRefresh(cfg, store, 'a@x.nl', NOW);
    respond!({ access_token: 'nieuw', expires_in: 3600 });
    await expect(pending).resolves.toBe('nieuw');
    expect(written).toEqual(['a@x.nl']);
    expect(map.get('a@x.nl')?.accessToken).toBe('nieuw');
  });

  it('schrijft niets terug als het account tijdens de verlenging verwijderd is', async () => {
    const { store, map, written } = fakeStore({ 'a@x.nl': expired() });
    const pending = forceRefresh(cfg, store, 'a@x.nl', NOW);
    store.remove('a@x.nl');
    respond!({ access_token: 'nieuw', expires_in: 3600 });
    await expect(pending).resolves.toBeNull();
    expect(written).toEqual([]);
    expect(map.has('a@x.nl')).toBe(false);
  });
});
