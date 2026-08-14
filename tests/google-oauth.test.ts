// The Google OAuth flow: PKCE, auth URLs, callbacks, token handling and scopes.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  pkce,
  authUrl,
  parseCallback,
  codeExchangeBody,
  refreshBody,
  applyTokenResponse,
  isExpired,
  hasScopes,
  REDIRECT_URI,
  SCOPES,
  type StoredToken,
} from '../electron/auth/google-oauth';
import { ALLOWED_EMAIL_DOMAINS } from '../electron/auth/account-domain';

const cfg = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'GEHEIM' };

describe('pkce', () => {
  it('derives the challenge as base64url sha256 of the verifier', () => {
    const { verifier, challenge } = pkce(() => Buffer.alloc(32, 7));
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
  it('produces url-safe values without padding', () => {
    const { verifier, challenge } = pkce();
    for (const v of [verifier, challenge]) {
      expect(v).not.toMatch(/[+/=]/);
      expect(v.length).toBeGreaterThanOrEqual(43);
    }
  });
  it('gives a different verifier each time', () => {
    expect(pkce().verifier).not.toBe(pkce().verifier);
  });
});

describe('authUrl', () => {
  const url = () => new URL(authUrl({ clientId: cfg.clientId, challenge: 'UITDAGING' }));

  it('asks for a code with PKCE on the loopback redirect', () => {
    const q = url().searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge')).toBe('UITDAGING');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(q.get('client_id')).toBe(cfg.clientId);
  });

  it('asks for offline access so we get a refresh token', () => {
    const q = url().searchParams;
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
  });

  it('requests the read and insert scopes', () => {
    expect(url().searchParams.get('scope')).toBe(SCOPES.join(' '));
  });

  it('passes the account to preselect, and omits it when unknown', () => {
    const withHint = new URL(
      authUrl({ clientId: cfg.clientId, challenge: 'x', loginHint: 'luca@example.com' }),
    );
    expect(withHint.searchParams.get('login_hint')).toBe('luca@example.com');
    expect(url().searchParams.has('login_hint')).toBe(false);
  });

  it('lets Google refuse an account outside the work domain', () => {
    expect(url().searchParams.get('hd')).toBe(ALLOWED_EMAIL_DOMAINS.join(','));
  });
});

describe('parseCallback', () => {
  it('reads the code from the redirect', () => {
    expect(parseCallback(`${REDIRECT_URI}?code=4/ABC&scope=x`)).toEqual({ code: '4/ABC' });
  });
  it('reports a refusal', () => {
    expect(parseCallback(`${REDIRECT_URI}?error=access_denied`)).toEqual({ error: 'access_denied' });
  });
  it('reports a redirect without a code', () => {
    expect(parseCallback(`${REDIRECT_URI}?state=x`)?.error).toBeTruthy();
  });
  it('ignores any other url so navigation can continue', () => {
    expect(parseCallback('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBeNull();
    expect(parseCallback('https://mail.google.com/mail/u/0/')).toBeNull();
  });
});

describe('request bodies', () => {
  it('exchanges the code with the verifier and the redirect it was issued for', () => {
    const body = new URLSearchParams(codeExchangeBody(cfg, '4/ABC', 'VERIFIER'));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('4/ABC');
    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(body.get('client_secret')).toBe('GEHEIM');
  });
  it('refreshes with the refresh token', () => {
    const body = new URLSearchParams(refreshBody(cfg, 'REFRESH'));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('REFRESH');
  });
});

describe('applyTokenResponse', () => {
  const now = 1_800_000_000_000;

  it('stores the token with an expiry a minute early', () => {
    const t = applyTokenResponse(
      null,
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPES.join(' ') },
      now,
    ) as StoredToken;
    expect(t.accessToken).toBe('AT');
    expect(t.refreshToken).toBe('RT');
    expect(t.expiresAt).toBe(now + 3600_000 - 60_000);
    expect(t.scopes).toEqual(SCOPES);
  });

  it('keeps the old refresh token when a refresh omits it', () => {
    const previous: StoredToken = {
      accessToken: 'oud',
      refreshToken: 'RT',
      expiresAt: 0,
      scopes: SCOPES,
    };
    const t = applyTokenResponse(previous, { access_token: 'nieuw', expires_in: 3600 }, now) as StoredToken;
    expect(t.refreshToken).toBe('RT');
    expect(t.scopes).toEqual(SCOPES);
  });

  it('reports a first grant without a refresh token instead of storing it', () => {
    expect(applyTokenResponse(null, { access_token: 'AT', expires_in: 3600 }, now)).toHaveProperty(
      'error',
    );
  });

  it('reports a response without an access token', () => {
    expect(applyTokenResponse(null, {}, now)).toHaveProperty('error');
  });
});

describe('isExpired / hasScopes', () => {
  const token: StoredToken = {
    accessToken: 'AT',
    refreshToken: 'RT',
    expiresAt: 1000,
    scopes: SCOPES,
  };
  it('is expired at or past the expiry', () => {
    expect(isExpired(token, 999)).toBe(false);
    expect(isExpired(token, 1000)).toBe(true);
  });
  it('checks that every wanted scope was granted', () => {
    expect(hasScopes(token)).toBe(true);
    expect(hasScopes({ ...token, scopes: [SCOPES[0]] })).toBe(false);
  });
});

describe('SCOPES', () => {
  it('includes the email scope the relay needs to identify the account', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
  });

  it('still includes what the app itself needs', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(SCOPES).toContain('https://www.googleapis.com/auth/gmail.insert');
  });

  it('sees a token minted before the email scope as incomplete', () => {
    const old = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 0,
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.insert',
      ],
    };
    expect(hasScopes(old)).toBe(false);
  });

  it('sees a token with everything as complete', () => {
    expect(hasScopes({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, scopes: SCOPES })).toBe(
      true,
    );
  });
});
