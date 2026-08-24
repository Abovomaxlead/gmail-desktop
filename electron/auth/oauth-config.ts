// The one config file everything Google-facing is read from: the OAuth credentials, the push
// settings, and the two relay URLs.
//
// Every reader goes through oauthConfigText, so the app cannot link against one project and
// subscribe for notifications against another. Nothing is cached, because the file can be
// imported from inside the running app.

import { readFileSync } from 'node:fs';
import { backupPath } from '../core/json-store';
import { OAUTH_CONFIG_PATH } from '../core/paths';
import { chooseRelayUrl } from '../delegation/relay-url';
import { readBundledOAuthConfig } from './oauth-bundled';
import { chooseOAuthConfigText } from './oauth-source';
import type { OAuthConfig } from './google-oauth';
import { parsePushConfig, type PushConfig } from '../push/push-config';


//===========================
// Exported functions
//===========================

export function oauthConfigText(): string | null {
  return chooseOAuthConfigText(
    readIfPresent(OAUTH_CONFIG_PATH),
    readIfPresent(backupPath(OAUTH_CONFIG_PATH)),
    readBundledOAuthConfig(),
  );
}

export function oauthConfig(): OAuthConfig | null {
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text);
    if (typeof raw?.clientId === 'string' && typeof raw?.clientSecret === 'string') {
      return { clientId: raw.clientId, clientSecret: raw.clientSecret };
    }
  } catch {
  }
  return null;
}

export function pushConfig(): PushConfig | null {
  const text = oauthConfigText();
  try {
    return parsePushConfig(text === null ? null : JSON.parse(text), process.env);
  } catch {
    return parsePushConfig(null, process.env);
  }
}

export function delegatedTokenUrl(): string | null {
  return relayUrlFromConfig(process.env.GMAIL_DELEGATED_TOKEN_URL, 'delegatedTokenUrl');
}

export function delegatedMailboxesUrl(): string | null {
  return relayUrlFromConfig(process.env.GMAIL_DELEGATED_MAILBOXES_URL, 'delegatedMailboxesUrl');
}


//===========================
// Helper functions
//===========================

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * One relay endpoint, read the way every relay endpoint is read
 *
 * The file is left unopened when the environment has already decided, so an override works
 * on a machine with no config at all.
 *
 * @param fromEnv the value of this endpoint's environment variable
 * @param key the endpoint's key in the OAuth config file
 * @returns the URL to call, or null when neither source yields a usable one
 * @private
 */
function relayUrlFromConfig(fromEnv: string | undefined, key: string): string | null {
  const fromFile = (fromEnv ?? '').trim() === '' ? relayUrlInFile(key) : undefined;
  return chooseRelayUrl(fromEnv, fromFile);
}

/**
 * One endpoint's raw value out of the config file
 *
 * @param key
 * @returns whatever stands under that key, or undefined when there is no readable config
 * @private
 */
function relayUrlInFile(key: string): unknown {
  const text = oauthConfigText();
  if (text === null) return undefined;
  try {
    return (JSON.parse(text) as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
