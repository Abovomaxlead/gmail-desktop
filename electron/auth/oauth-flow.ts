// The Electron half of the OAuth flow; the pure parts live in google-oauth.ts and 'electron'
// is required lazily so this module stays importable under Vitest.
//
// Consent loads in a view on the Gmail views' session partition, so the user only grants
// permission rather than signing in again, and the loopback redirect is intercepted before
// it loads. Every refresh re-checks the account is still linked before saving.

import type { BrowserWindow } from 'electron';
import {
  authUrl,
  codeExchangeBody,
  refreshBody,
  applyTokenResponse,
  parseCallback,
  pkce,
  isExpired,
  TOKEN_ENDPOINT,
  type OAuthConfig,
  type StoredToken,
} from './google-oauth';
import { ALLOWED_EMAIL_DOMAINS, isAllowedAccount } from './account-domain';
import type { OAuthStore } from './oauth-store';


//===========================
// Exported functions
//===========================

/**
 * Runs the consent flow and stores the resulting token
 *
 * @param win the window the consent view is parented to
 * @param partition the session the Gmail views already use
 * @param cfg
 * @param store
 * @param email the account being linked, used as the login hint
 * @param now epoch ms
 * @returns ok, or the reason the link failed
 */
export async function connectAccount(
  win: BrowserWindow,
  partition: string,
  cfg: OAuthConfig,
  store: OAuthStore,
  email: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAllowedAccount(email)) {
    return { ok: false, error: `Alleen accounts van ${domainList()} kunnen gekoppeld worden` };
  }

  const { verifier, challenge } = pkce();
  const consent = await consentCode(win, partition, cfg, challenge, email);
  if ('error' in consent) return { ok: false, error: consent.error };

  let json: Record<string, unknown>;
  try {
    json = await postForm(TOKEN_ENDPOINT, codeExchangeBody(cfg, consent.code, verifier));
  } catch (e) {
    return { ok: false, error: `Inwisselen mislukt: ${(e as Error).message}` };
  }
  const token = applyTokenResponse(store.get(email) ?? null, json, now);
  if ('error' in token) return { ok: false, error: token.error };
  store.set(email, token);
  return { ok: true };
}

/**
 * Refreshes an account's token whether or not it had expired
 *
 * @param cfg
 * @param store
 * @param email
 * @param now epoch ms
 * @returns a fresh access token, or null when the account can no longer be refreshed
 */
export async function forceRefresh(
  cfg: OAuthConfig,
  store: OAuthStore,
  email: string,
  now = Date.now(),
): Promise<string | null> {
  const token = store.get(email);
  if (!token) return null;
  try {
    const json = await postForm(TOKEN_ENDPOINT, refreshBody(cfg, token.refreshToken));
    const next = applyTokenResponse(token, json, now);
    if ('error' in next) return null;
    if (!storeIfStillLinked(store, email, next)) return null;
    return next.accessToken;
  } catch {
    return null;
  }
}

/**
 * The access token to call the API with, refreshing it only once it has expired
 *
 * @param cfg
 * @param store
 * @param email
 * @param now epoch ms
 * @returns an access token, or null when the account is not usable
 */
export async function accessTokenFor(
  cfg: OAuthConfig,
  store: OAuthStore,
  email: string,
  now = Date.now(),
): Promise<string | null> {
  const token = store.get(email);
  if (!token) return null;
  if (!isExpired(token, now)) return token.accessToken;

  try {
    const json = await postForm(TOKEN_ENDPOINT, refreshBody(cfg, token.refreshToken));
    const next = applyTokenResponse(token, json, now);
    if ('error' in next) return null;
    if (!storeIfStillLinked(store, email, next)) return null;
    return next.accessToken;
  } catch {
    return null;
  }
}

export type { StoredToken };


//===========================
// Helper functions
//===========================

/**
 * The allowed domains as they are read out in the refusal
 *
 * @returns '@one.nl' or '@one.nl of @two.nl'
 * @private
 */
function domainList(): string {
  return ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' of ');
}

/**
 * Posts a urlencoded body and reads the JSON back
 *
 * @param url
 * @param body
 * @returns the parsed response
 * @private
 */
async function postForm(url: string, body: string): Promise<Record<string, unknown>> {
  const { net } = require('electron') as typeof import('electron');
  return await new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'POST' });
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          reject(new Error(`onleesbaar antwoord (HTTP ${res.statusCode})`));
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error(String(json.error_description ?? json.error ?? `HTTP ${res.statusCode}`)));
          return;
        }
        resolve(json);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Saves a refreshed token only if the account is still linked
 *
 * @param store
 * @param email
 * @param next
 * @returns false when the account was removed during the round trip
 * @private
 */
function storeIfStillLinked(store: OAuthStore, email: string, next: StoredToken): boolean {
  if (!store.get(email)) return false;
  store.set(email, next);
  return true;
}

/**
 * Shows the consent page and catches the code off the intercepted redirect
 *
 * @param win
 * @param partition
 * @param cfg
 * @param challenge the PKCE challenge
 * @param loginHint
 * @returns the code, or why consent did not produce one
 * @private
 */
async function consentCode(
  win: BrowserWindow,
  partition: string,
  cfg: OAuthConfig,
  challenge: string,
  loginHint: string,
): Promise<{ code: string } | { error: string }> {
  const { WebContentsView } = require('electron') as typeof import('electron');
  const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true } });
  const [width, height] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width, height });
  win.contentView.addChildView(view);

  const done = new Promise<{ code: string } | { error: string }>((resolve) => {
    let settled = false;
    const finish = (r: { code: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const onNavigate = (e: { preventDefault(): void }, url: string) => {
      const result = parseCallback(url);
      if (!result) return;
      e.preventDefault();
      finish(result.code ? { code: result.code } : { error: result.error ?? 'onbekende fout' });
    };
    view.webContents.on('will-navigate', onNavigate);
    view.webContents.on('will-redirect', onNavigate);
    view.webContents.on('destroyed', () => finish({ error: 'toestemmingsvenster gesloten' }));
  });

  try {
    await view.webContents.loadURL(authUrl({ clientId: cfg.clientId, challenge, loginHint }));
  } catch {
  }

  const result = await done;
  try {
    win.contentView.removeChildView(view);
  } catch {
  }
  if (!view.webContents.isDestroyed()) view.webContents.close();
  return result;
}
