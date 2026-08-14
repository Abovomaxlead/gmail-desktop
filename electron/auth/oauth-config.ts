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
import { parseMailboxesUrl } from '../delegation/delegated-mailboxes';
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

/** Where to ask for a token for a mailbox nobody signed into. Absent means the relay is not
 * configured, and copying to delegated mailboxes stays off — the same optional shape push
 * config has. */
export function delegatedTokenUrl(): string | null {
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { delegatedTokenUrl?: unknown };
    const url = typeof raw.delegatedTokenUrl === 'string' ? raw.delegatedTokenUrl.trim() : '';
    return url === '' ? null : url;
  } catch {
    return null;
  }
}

/**
 * Where to ask which mailboxes this person may reach. Absent means discovery stays off and
 * the switcher scrape is the only source.
 *
 * Environment before file, the rule push already follows (`push-config.ts:34`), and for the
 * same reason: a relay on loopback has to be testable without editing the one file that holds
 * the client secret. Read before the file is even opened, so it works on a machine that has no
 * config at all.
 *
 * An env var that is set but unusable is not quietly replaced by the file. It was set on
 * purpose; falling back would hide the mistake behind behaviour that looks like it worked,
 * which is the failure mode the whole config path is written to avoid.
 */
export function delegatedMailboxesUrl(): string | null {
  const fromEnv = (process.env.GMAIL_DELEGATED_MAILBOXES_URL ?? '').trim();
  if (fromEnv !== '') return parseMailboxesUrl(fromEnv);
  const text = oauthConfigText();
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { delegatedMailboxesUrl?: unknown };
    return parseMailboxesUrl(raw.delegatedMailboxesUrl);
  } catch {
    return null;
  }
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
