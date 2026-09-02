// Whether each own account still has a working link to the Gmail API, shown in the accounts
// panel and in the reconnect banner over the mail view.
//
// oauth-health.ts decides what the facts mean; this gathers them in one synchronous pass, so
// the banner and the panel cannot describe different moments. Debounced, because every
// profile push triggers it and a startup run would mean a run of token refreshes.

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
import { oauthConfig } from './oauth-config';
import { accountOAuthStatuses, accountsNeedingReconnect, bannerBounds } from './oauth-health';
import type { ReconnectAccount } from '../../renderer/lib/reconnect';


//===========================
// Module state
//===========================

let healthTimer: ReturnType<typeof setTimeout> | null = null;

const refreshFailures = new Set<string>();


//===========================
// Exported functions
//===========================

export function scheduleOAuthHealthCheck(): void {
  if (healthTimer) clearTimeout(healthTimer);
  healthTimer = setTimeout(() => void checkOAuthHealth(), 1500);
}

export function markRefreshFailed(email: string): void {
  refreshFailures.add(email);
  scheduleOAuthHealthCheck();
}

export function clearRefreshFailure(email: string): void {
  refreshFailures.delete(email);
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
  for (const email of ownEmails) {
    const token = oauthTokens.get(email);
    if (!token) continue;
    const fresh = await accessTokenFor(cfg, oauthTokens, email);
    if (fresh) refreshFailures.delete(email);
    else refreshFailures.add(email);
  }


  const health = {
    ownEmails,
    hasToken: (e: string) => oauthTokens!.get(e) !== undefined,
    refreshFailed: (e: string) => refreshFailures.has(e),
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
