// Access tokens and forced refreshes. oauth-flow.ts requires `electron` lazily inside
// postForm, which vi.mock cannot reach, so the test fills Node's CJS cache instead.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { accessTokenFor, forceRefresh } from '../electron/oauth-flow';
import type { OAuthConfig, StoredToken } from '../electron/google-oauth';
import type { OAuthStore } from '../electron/oauth-store';

const ELECTRON_ID = require.resolve('electron');
let realElectron: NodeJS.Module | undefined;

let respond: ((json: unknown) => void) | null = null;

type Handler = (...args: unknown[]) => void;

const fakeNet = {
  request: () => {
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

beforeEach(() => {
  realElectron = require.cache[ELECTRON_ID];
  require.cache[ELECTRON_ID] = {
    id: ELECTRON_ID,
    filename: ELECTRON_ID,
    loaded: true,
    exports: { net: fakeNet },
  } as unknown as NodeJS.Module;
  respond = null;
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
