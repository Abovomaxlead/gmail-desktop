// Whether each own account still has a working link to the Gmail API, shown in the accounts
// panel and in the reconnect banner over the mail view.
//
// oauth-health.ts decides what the facts mean; this gathers them in one synchronous pass, so
// the banner and the panel cannot describe different moments. Debounced, because every
// profile push triggers it and a startup run would mean a run of token refreshes.
//
// This is also what keeps the access tokens alive: every check renews a token that is within
// ten minutes of running out, so an API call never has to find a dead one. A renewal that
// fails without Google refusing the grant -- no network yet after waking from sleep -- is
// tried again after RETRY_MS instead of waiting for the next five-minute round.

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
import { forceRefresh, grantRejected } from './oauth-flow';
import { hasScopes, renewalDue } from './google-oauth';
import { linkableOwnEmails } from './account-domain';
import { oauthConfig } from './oauth-config';
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from './oauth-health';
import type { ReconnectAccount } from '../../renderer/lib/reconnect';



//===========================
// Constants
//===========================

const RETRY_MS = 30 * 1000;

//===========================
// Module state
//===========================

let healthTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;


//===========================
// Exported functions
//===========================

export function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

export async function checkOAuthHealth(): Promise<void> {
  const cfg = oauthConfig();
  if (!cfg) {
    setOauthStatuses([]);
    pushOAuthStatus();
    return;
  }
  if (!oauthTokens || !mainWindow || mainWindow.isDestroyed()) return;

  const ownEmails = linkableOwnEmails(profiles);
  let retry = false;
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token || !renewalDue(token, Date.now())) continue;
    // Whether a failure means "reconnect" or "try again" is recorded by oauth-flow and read
    // below through grantRejected.
    const fresh = await forceRefresh(cfg, oauthTokens, email);
    if (!fresh && !grantRejected(email)) retry = true;
  }
  clearTimeout(retryTimer ?? undefined);
  retryTimer = retry ? setTimeout(() => void checkOAuthHealth(), RETRY_MS) : null;


  const health = {
    ownEmails,
    hasToken: (e: string) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e: string) => grantRejected(e),
    scopesComplete: (e: string) => {
      const token = oauthTokens!.get(e);
      return token !== undefined && hasScopes(token);
    },
  };
  setOauthStatuses(accountOAuthStatuses(health));
  pushOAuthStatus();
  showReconnectBanner(accountsNeedingReconnect(health));
}


//===========================
// Helper functions
//===========================

function pushOAuthStatus(): void {
  mainWindow?.webContents.send(IPC.OAUTH_STATUS_CHANGED, {
    configured: oauthConfig() !== null,
    accounts: oauthStatuses,
  });
}

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
