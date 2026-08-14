// Reading the one config file everything Google-facing is configured from: the OAuth
// credentials, the push settings, and the two relay URLs.
//
// Every reader goes through oauthConfigText so they can never disagree about which project
// the app is talking to. The push settings live in the same file as the credentials, and
// picking them from different sources would link accounts against one project and subscribe
// for notifications against another. See oauth-source.ts for the precedence between the
// machine's own copy and the shipped one, and oauth-bundled.ts for where the shipped one is.
//
// Nothing here is cached. The file can be imported from inside the app while it runs, and a
// cache would mean the app stayed unlinkable until a restart.

import { readFileSync } from 'node:fs';
import { OAUTH_CONFIG_PATH } from '../core/paths';
import { chooseRelayUrl } from '../delegation/relay-url';
import { readBundledOAuthConfig } from './oauth-bundled';
import { chooseOAuthConfigText } from './oauth-source';
import type { OAuthConfig } from './google-oauth';
import { parsePushConfig, type PushConfig } from '../push/push-config';


//===========================
// Exported functions
//===========================

/** The config text in force: the machine's own if it has a usable one, otherwise the copy
 * shipped in the app. */
export function oauthConfigText(): string | null {
  return chooseOAuthConfigText(readIfPresent(OAUTH_CONFIG_PATH), readBundledOAuthConfig());
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

/**
 * Where to ask for a token for a mailbox nobody signed into. Absent means the relay is not
 * configured, and copying to delegated mailboxes stays off — the same optional shape push
 * config has.
 *
 * This one used to read the file and trim it, and that was all: no scheme check, no
 * environment. It is the endpoint whose answer carries gmail.insert and gmail.modify, so it
 * was the worst of the three to leave that way — see `relay-url.ts` for both halves of why.
 */
export function delegatedTokenUrl(): string | null {
  return relayUrlFromConfig(process.env.GMAIL_DELEGATED_TOKEN_URL, 'delegatedTokenUrl');
}

/**
 * Where to ask which mailboxes this person may reach. Absent means discovery stays off and
 * the switcher scrape is the only source.
 */
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
 * `chooseRelayUrl` owns which of the two sources wins and what counts as usable; this only
 * fetches them. The file is left unopened when the environment has already decided, so an
 * override works on a machine that has no config at all.
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
