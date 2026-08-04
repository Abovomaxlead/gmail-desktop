// OAuth for the Gmail API. Separate from the Gmail views' sign-in: those run on
// Google's session cookies, this yields an access token, and neither converts into the
// other. They only share the session partition the consent page is shown in.
//
// Desktop-app flow: authorization code + PKCE with a loopback redirect, the only
// redirect Google allows for desktop clients — the port is arbitrary and nothing
// listens, because the navigation to it is intercepted. `access_type=offline` with
// `prompt=consent` is required or a second run returns no refresh token, and a refresh
// response never carries a new refresh token, so the original must be kept.
//
// Changing SCOPES invalidates every stored token, since `hasScopes` compares against
// this list. userinfo.email is not for Gmail but for the push relay, which maps a
// connection to an account via tokeninfo — without it the relay closes with 4401.

import { createHash, randomBytes } from 'node:crypto';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

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
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (opts.loginHint) q.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

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
  expiresAt: number;
  scopes: string[];
}

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
