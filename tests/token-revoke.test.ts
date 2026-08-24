// Revoking a grant at Google when an account is unlinked. oauth-flow.ts requires `electron`
// lazily inside postForm, which vi.mock cannot reach, so the test fills Node's CJS cache
// instead — the same trick oauth-flow.test.ts uses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { revokeRefreshToken } from '../electron/auth/token-revoke';
import { postForm } from '../electron/auth/oauth-flow';
import { REVOKE_ENDPOINT, revokeBody } from '../electron/auth/google-oauth';

const ELECTRON_ID = require.resolve('electron');
let realElectron: NodeJS.Module | undefined;

let respond: ((json: unknown, statusCode?: number) => void) | null = null;
let respondRaw: ((text: string, statusCode?: number) => void) | null = null;
let respondWithError: ((err: Error) => void) | null = null;
let requestCount = 0;
let requestedUrl: string | undefined;

type Handler = (...args: unknown[]) => void;

const fakeNet = {
  request: (opts: { url: string }) => {
    requestCount++;
    requestedUrl = opts.url;
    const reqHandlers = new Map<string, Handler>();
    const send = (text: string, statusCode = 200) => {
      const resHandlers = new Map<string, Handler>();
      const res = {
        statusCode,
        on: (event: string, fn: Handler) => resHandlers.set(event, fn),
      };
      reqHandlers.get('response')?.(res);
      resHandlers.get('data')?.(Buffer.from(text, 'utf8'));
      resHandlers.get('end')?.();
    };
    respond = (json, statusCode) => send(JSON.stringify(json), statusCode);
    respondRaw = send;
    respondWithError = (err) => {
      reqHandlers.get('error')?.(err);
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
  respondRaw = null;
  respondWithError = null;
  requestCount = 0;
  requestedUrl = undefined;
});

afterEach(() => {
  if (realElectron) require.cache[ELECTRON_ID] = realElectron;
  else delete require.cache[ELECTRON_ID];
});

describe('revokeBody', () => {
  it('urlencodes the refresh token under the field Google expects', () => {
    const body = new URLSearchParams(revokeBody('RT-123'));
    expect(body.get('token')).toBe('RT-123');
  });
});

describe('revokeRefreshToken', () => {
  it('reports ok on the empty 200 body Google actually sends for a revoke', async () => {
    const pending = revokeRefreshToken('RT-123');
    respondRaw!('');
    await expect(pending).resolves.toEqual({ ok: true });
    expect(requestedUrl).toBe(REVOKE_ENDPOINT);
  });

  it('treats an already-dead token as alreadyGone, not an error', async () => {
    const pending = revokeRefreshToken('RT-123');
    respond!({ error: 'invalid_token' }, 400);
    await expect(pending).resolves.toEqual({ ok: false, alreadyGone: true });
  });

  it('reports a network error without throwing', async () => {
    const pending = revokeRefreshToken('RT-123');
    respondWithError!(new Error('ECONNREFUSED'));
    await expect(pending).resolves.toEqual({
      ok: false,
      alreadyGone: false,
      error: 'ECONNREFUSED',
    });
  });

  it('makes no request for an empty or whitespace token', async () => {
    await expect(revokeRefreshToken('')).resolves.toEqual({ ok: false, alreadyGone: true });
    await expect(revokeRefreshToken('   ')).resolves.toEqual({ ok: false, alreadyGone: true });
    expect(requestCount).toBe(0);
  });
});

describe('postForm', () => {
  it('resolves an empty object on a 2xx with an empty body, instead of rejecting', async () => {
    const pending = postForm(REVOKE_ENDPOINT, revokeBody('RT-123'));
    respondRaw!('');
    await expect(pending).resolves.toEqual({});
  });

  it('resolves an empty object on a 2xx with a whitespace-only body', async () => {
    const pending = postForm(REVOKE_ENDPOINT, revokeBody('RT-123'));
    respondRaw!('   ');
    await expect(pending).resolves.toEqual({});
  });

  it('still rejects a 2xx whose non-empty body is not JSON', async () => {
    const pending = postForm(REVOKE_ENDPOINT, revokeBody('RT-123'));
    respondRaw!('<html>not json</html>');
    await expect(pending).rejects.toThrow('onleesbaar antwoord (HTTP 200)');
  });
});
