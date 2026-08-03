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
import type { OAuthStore } from './oauth-store';

// Het Electron-deel van de OAuth-flow. De pure delen staan in google-oauth.ts;
// `electron` wordt lui geladen zodat die module onder Vitest importeerbaar blijft.

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

// Toont de consent-pagina in een view op de partitie waarin de Gmail-views ook
// leven. Daardoor is de gebruiker daar al ingelogd: geen wachtwoord, alleen
// toestemming geven. Dat is de enige zinvolle koppeling tussen deze flow en de
// inlog van de webviews — een sessiecookie is geen access token en omgekeerd.
//
// De redirect naar de loopback-url wordt opgevangen voordat hij laadt; er hoeft
// dus niets op die poort te luisteren.
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
    // Een afgebroken navigatie is normaal zodra wij de redirect opvangen.
  }

  const result = await done;
  try {
    win.contentView.removeChildView(view);
  } catch {
    // Venster al afgebroken.
  }
  if (!view.webContents.isDestroyed()) view.webContents.close();
  return result;
}

// Volledige koppeling: toestemming vragen, code inwisselen, token opslaan.
export async function connectAccount(
  win: BrowserWindow,
  partition: string,
  cfg: OAuthConfig,
  store: OAuthStore,
  email: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
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

// Verlengt ongeacht wat onze eigen klok zegt. Nodig omdat Google een token kan
// intrekken terwijl het volgens ons nog geldig is (bijvoorbeeld als dezelfde
// client-id door een andere app gebruikt wordt en daar toegang wordt ingetrokken).
// Null betekent: ook de refresh token is niet meer geldig, opnieuw toestemming
// vragen is het enige wat rest.
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
    store.set(email, next);
    return next.accessToken;
  } catch {
    return null;
  }
}

// Geeft een geldig access token en verlengt het als het verlopen is. Null als
// het account niet gekoppeld is of de verlenging faalt — dan moet de gebruiker
// opnieuw toestemming geven.
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
    store.set(email, next);
    return next.accessToken;
  } catch {
    // Verlopen refresh token (in testmodus na zeven dagen) of geen netwerk.
    return null;
  }
}

export type { StoredToken };
