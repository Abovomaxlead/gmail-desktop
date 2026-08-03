import { createHash, randomBytes } from 'node:crypto';

// OAuth voor de Gmail API. Staat los van de inlog van de Gmail-views: die
// werken op Google's sessiecookies, dit levert een access token. Het een is niet
// in het ander om te zetten. Wat we wél delen is de sessiepartitie waarin de
// consent-pagina wordt getoond, zodat de gebruiker daar al is ingelogd.
//
// De flow is die voor een desktop-app: authorization code + PKCE, met een
// loopback-redirect. Google's secret voor een desktop-client geldt niet als
// vertrouwelijk (hij zit onvermijdelijk in de app), en PKCE is wat de
// uitwisseling beschermt.

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

// Lezen om de originele berichten op te halen (format=raw) en labels te kunnen
// opsommen; insert om een bericht in een ánder postvak te zetten. Allebei
// "restricted" scopes: zonder Google-verificatie werkt dit alleen voor accounts
// die als testgebruiker staan aangemerkt.
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
];

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Loopback is de enige redirect die Google voor desktop-clients toestaat. De
// poort mag alles zijn en hoeft niet geregistreerd te worden; we vangen de
// navigatie ernaartoe zelf op, dus er hoeft ook niets te luisteren.
export const REDIRECT_URI = 'http://127.0.0.1:47813/oauth2callback';

export interface Pkce {
  verifier: string;
  challenge: string;
}

const base64url = (b: Buffer) => b.toString('base64url');

export function pkce(random: (n: number) => Buffer = randomBytes): Pkce {
  const verifier = base64url(random(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authUrl(opts: {
  clientId: string;
  challenge: string;
  loginHint?: string;
  scopes?: string[];
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: (opts.scopes ?? SCOPES).join(' '),
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    // offline + consent: anders krijgen we bij een tweede keer geen refresh
    // token en is de koppeling na een uur weer weg.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (opts.loginHint) q.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

// Herkent de redirect na de consent-pagina. Geeft null terug voor elke andere
// url, zodat de aanroeper gewoon door kan laten navigeren.
export function parseCallback(url: string): { code?: string; error?: string } | null {
  if (!url.startsWith(REDIRECT_URI)) return null;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return { error: 'onleesbare redirect' };
  }
  const error = params.get('error');
  if (error) return { error };
  const code = params.get('code');
  return code ? { code } : { error: 'geen code in de redirect' };
}

export function codeExchangeBody(cfg: OAuthConfig, code: string, verifier: string): string {
  return new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  }).toString();
}

export function refreshBody(cfg: OAuthConfig, refreshToken: string): string {
  return new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();
}

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scopes: string[];
}

// Google stuurt bij een verversing géén nieuwe refresh token mee; die van de
// eerste keer blijft geldig en moet dus bewaard worden.
export function applyTokenResponse(
  previous: StoredToken | null,
  json: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  },
  now: number,
): StoredToken | { error: string } {
  if (!json.access_token) return { error: 'geen access token in het antwoord' };
  const refreshToken = json.refresh_token ?? previous?.refreshToken ?? '';
  if (!refreshToken) {
    return { error: 'geen refresh token; opnieuw toestemming geven met prompt=consent' };
  }
  // Een minuut marge: liever te vroeg verversen dan een verzoek verliezen.
  const lifetime = (json.expires_in ?? 3600) * 1000;
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: now + lifetime - 60_000,
    scopes: json.scope ? json.scope.split(' ') : previous?.scopes ?? [],
  };
}

export function isExpired(token: StoredToken, now: number): boolean {
  return now >= token.expiresAt;
}

export function hasScopes(token: StoredToken, wanted: string[] = SCOPES): boolean {
  return wanted.every((s) => token.scopes.includes(s));
}
