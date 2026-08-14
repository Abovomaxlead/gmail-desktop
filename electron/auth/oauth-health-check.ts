// Whether each of the user's own accounts still has a working link to the Gmail API, and
// the two places that answer shows up: the accounts panel, and the banner over the mail view
// offering to reconnect.
//
// oauth-health.ts decides what a set of facts means; this gathers the facts, publishes them
// and draws the banner. Both readings come from one object built in a single synchronous
// pass, so the banner and the panel can never describe different moments.
//
// The check is debounced rather than run on the spot. It is triggered by every profile push,
// and a run of those at startup would otherwise mean a run of token refreshes.

import { OverlayView } from '../windows/overlay-view';
import { IPC } from '../core/ipc';
import { DEV_URL, SIDEBAR_PRELOAD_PATH } from '../core/paths';
import {
  mainWindow,
  oauthStatuses,
  oauthTokens,
  profiles,
  reconnectBanner,
  setOauthStatuses,
  setReconnectAccounts,
  setReconnectBanner,
} from '../core/runtime';
import { accessTokenFor } from './oauth-flow';
import { linkableOwnEmails } from './account-domain';
import { hasScopes } from './google-oauth';
import { oauthConfig, pushConfig } from './oauth-config';
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from './oauth-health';
import type { ReconnectAccount } from './oauth-health';


//===========================
// Module state
//===========================

let healthTimer: ReturnType<typeof setTimeout> | null = null;

/** Own accounts whose refresh token would not produce an access token. Only an own account
 * can be in here: a delegated mailbox has no link of its own to expire. */
const refreshFailures = new Set<string>();

/** Accounts Google refused a push subscription for, which is a different fault from an
 * expired link and gets a different sentence in the panel. */
const pushRefusals = new Set<string>();


//===========================
// Exported functions
//===========================

export function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

/** Flags an own account as needing a reconnect, and asks for the check that will say so. */
export function markRefreshFailed(email: string): void {
  refreshFailures.add(email);
  scheduleOAuthHealthCheck();
}

export function clearRefreshFailure(email: string): void {
  refreshFailures.delete(email);
}

export function notePushRefused(email: string): void {
  pushRefusals.add(email);
}

/** @returns {boolean} whether this account was in fact refused before, so the caller only
 *   asks for a re-check when something actually changed */
export function clearPushRefusal(email: string): boolean {
  return pushRefusals.delete(email);
}

/** The one place the panel's picture of linking is sent. Reports whether this machine can
 * link at all as well as the per-account statuses, because those are different facts and
 * an empty list is the honest answer to both "nothing is wrong" and "nothing is possible". */
export function pushOAuthStatus(): void {
  mainWindow?.webContents.send(IPC.OAUTH_STATUS_CHANGED, {
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  });
}

export async function checkOAuthHealth(): Promise<void> {
  const cfg = oauthConfig();
  // Split from the guard below on purpose. A machine with no OAuth config is not a machine
  // with nothing to report — it is the one state where the panel would otherwise look
  // identical to a healthy one, which is how an install with no consent screen, no status
  // and no banner reached someone who then had to ask why.
  if (!cfg) {
    setOauthStatuses([]);
    pushOAuthStatus();
    return;
  }
  if (!oauthTokens || !mainWindow || mainWindow.isDestroyed()) return;

  // Out-of-domain accounts are left out rather than reported as unlinked: they cannot be
  // linked at all, and 'unlinked' would put a Verbinden button in the panel and a row in
  // the banner that no amount of clicking could ever resolve.
  const ownEmails = linkableOwnEmails(profiles);
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token) continue;
    const fresh = await accessTokenFor(cfg, oauthTokens, email);
    if (fresh) refreshFailures.delete(email);
    else refreshFailures.add(email);
  }

  // One object, handed to both functions, so the banner and the accounts panel can never
  // describe the same accounts differently. Its closures are not read once — OAuthStore.get
  // hits the filesystem on every call, and accountsNeedingReconnect below calls
  // accountOAuthStatuses again internally, so the token file is read roughly twice as often
  // per health check as a single pass would suggest. That is fine here: both passes are
  // synchronous with no `await` between them, so nothing can change underneath them, and at
  // a handful of accounts every five minutes the extra reads cost nothing worth avoiding.
  const health = {
    ownEmails,
    hasToken: (e: string) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e: string) => refreshFailures.has(e),
    pushConfigured: pushConfig() !== null,
    missingScopes: (e: string) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && !hasScopes(token);
    },
    pushRefused: (e: string) => pushRefusals.has(e),
  };
  setOauthStatuses(accountOAuthStatuses(health));
  pushOAuthStatus();
  showReconnectBanner(accountsNeedingReconnect(health));
}


//===========================
// Helper functions
//===========================

function showReconnectBanner(accounts: ReconnectAccount[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (accounts.length === 0) {
    reconnectBanner?.close();
    setReconnectAccounts([]);
    return;
  }
  setReconnectAccounts(accounts);
  const banner =
    reconnectBanner ??
    new OverlayView(
      mainWindow,
      SIDEBAR_PRELOAD_PATH,
      DEV_URL ? `${DEV_URL}/reconnect` : 'app://bundle/reconnect.html',
      IPC.OAUTH_RECONNECT_LIST,
      bannerBounds,
    );
  setReconnectBanner(banner);
  if (banner.isOpen()) banner.update({ accounts }, accounts.length);
  else banner.open({ accounts }, accounts.length);
}
