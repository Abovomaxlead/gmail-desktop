// Finding out which Google accounts this browser session is signed into.
//
// No API lists them, so they are probed: a mail view is opened at /mail/u/0, /u/1 and so on
// until detection-planner says to stop. Index 0 is exempt from the probe timeout, since
// giving up on it would leave the app showing nothing at all.

import { pushActive, pushProfiles, pushUnread, refreshBadge } from '../core/broadcast';
import {
  SESSION_PARTITION,
  accountCache,
  authIdx,
  authRef,
  colors,
  coverage,
  delegated,
  currentLocale,
  history,
  keyOf,
  keyOfIndex,
  mainWindow,
  manager,
  oauthTokens,
  prefs,
  profiles,
  setCachedAccounts,
  syncRunners,
  unread,
} from '../core/runtime';
import {
  showAccount,
  syncCalendarViews,
  trimViewsToVisible,
  warmAccount,
} from '../windows/view-surfaces';
import { refreshNotifyAllowed, playNotificationSound } from '../notify/notify-gating';
import { showToast } from '../toast/toast-presenter';
import { startMailSync } from '../push/mail-sync-controller';
import { maybeStartDelegatedApiScan } from '../delegation/delegated-controller';
import { connectAccount } from '../auth/oauth-flow';
import { isAllowedAccount } from '../auth/account-domain';
import { revokeRefreshToken } from '../auth/token-revoke';
import { oauthConfig } from '../auth/oauth-config';
import { stopWatch } from '../gmail/gmail-api';
import { colorForIndex } from './palette';
import { planNext } from './detection-planner';
import { addAccountUrl } from '../gmail/google-urls';
import { nativeLabels } from '../menus/native-labels';
import { SURFACES, surfacesForRef } from '../../renderer/lib/surfaces';
import type { Profile, Surface } from '../windows/profile-view-manager';

//===========================
// Constants
//===========================

// how long an account probe waits for the page to say who it belongs to
const PROBE_TIMEOUT_MS = 16000;


//===========================
// Module state
//===========================

const seenEmails = new Set<string>();

let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;

let visibleProbe: number | null = null;


//===========================
// Exported functions
//===========================

function switchSurface(index: number, surface: Surface): void {
  showAccount(authRef(index), surface);
}

export function startDetection(): void {
  switchSurface(0, 'mail');
}

export function redetect(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  probingIndex = null;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1);
}

export function addAccount(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  const nextIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) + 1 : 0;
  probingIndex = nextIndex;
  visibleProbe = nextIndex;
  manager?.ensureView(authRef(nextIndex), 'mail', true, addAccountUrl());
}

function settleDetection(): void {
  probingIndex = null;
  setCachedAccounts([]);
  pushProfiles();
  maybeStartDelegatedApiScan();
  // Detection has to open a view per account to find it at all, so on a low-memory setup this
  // is the first moment there is anything to give back. Without it the saving would not arrive
  // until the user switched mailboxes by hand.
  trimViewsToVisible();
}

function clearProbeTimer(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

function probe(index: number): void {
  probingIndex = index;
  manager?.ensureView(authRef(index), 'mail', false);
  clearProbeTimer();
  if (index > 0) {
    probeTimer = setTimeout(() => {
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      settleDetection();
    }, PROBE_TIMEOUT_MS);
  }
}

export function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  if (profiles.some((p) => authIdx(p) === index)) return;

  const isVisibleAdd = visibleProbe === index;

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    if (isVisibleAdd) {
      visibleProbe = null;
      void addAccountAfterConsent(index, identity, decision.stop);
      return;
    }
    registerAccount(index, identity);
    if (manager?.activeKey() == null) {
      switchSurface(index, 'mail');
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail');
    if (isVisibleAdd) {
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1);
  else if (identity?.email) settleDetection();
}

function registerAccount(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
): void {
  seenEmails.add(identity.email);
  const dup = profiles.findIndex(
    (p) => p.kind === 'delegated' && p.email.toLowerCase() === identity.email.toLowerCase(),
  );
  if (dup !== -1) {
    for (const surface of SURFACES) manager?.discardView(keyOf(profiles[dup]), surface);
    profiles.splice(dup, 1);
  }
  const color = colors!.get(identity.email) ?? colorForIndex(index);
  const profile: Profile = {
    ref: authRef(index),
    kind: 'authuser',
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    color,
  };
  profiles.push(profile);
  profiles.sort((a, b) => authIdx(a) - authIdx(b));
  pushProfiles();
  refreshNotifyAllowed();
  startMailSync();
  syncCalendarViews();
  warmAccount(profile);
}

async function addAccountAfterConsent(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
  stopProbing: boolean,
): Promise<void> {
  const email = identity.email;
  const cfg = oauthConfig();
  const needsConsent =
    isAllowedAccount(email) &&
    cfg !== null &&
    oauthTokens !== null &&
    !oauthTokens.get(email) &&
    !!mainWindow &&
    !mainWindow.isDestroyed();

  if (needsConsent) {
    const result = await connectAccount(mainWindow!, SESSION_PARTITION, cfg!, oauthTokens!, email);
    if (!result.ok) {
      manager?.discardView(keyOfIndex(index), 'mail');
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
      const L = nativeLabels(currentLocale(), prefs?.getAll().reneMode === true);
      showToast({
        kind: 'error',
        title: L.accountNotAddedTitle,
        body: L.accountNotAddedBody(email, result.error),
        persist: true,
      });
      if (prefs) playNotificationSound(prefs.getAll());
      if (!stopProbing) probe(index + 1);
      else settleDetection();
      return;
    }
  }

  registerAccount(index, identity);
  switchSurface(index, 'mail');
  if (!stopProbing) probe(index + 1);
  else settleDetection();
}

export function removeAccount(email: string): void {
  accountCache?.remove(email);
  const doomed = oauthTokens?.get(email);
  if (doomed?.accessToken) void stopWatch(doomed.accessToken).catch(() => undefined);
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
  oauthTokens?.remove(email);
  // Deleting our copy leaves the grant standing at Google, so a refresh token that leaked
  // before the unlink would keep working. Told separately, and never waited on: unlinking is
  // a local act and must finish with the network down.
  if (doomed?.refreshToken) void reportRevoke(email, doomed.refreshToken);
  const profile = profiles.find((p) => p.email === email);
  if (!profile) {
    pushProfiles();
    return;
  }
  if (profile.kind === 'delegated') delegated?.remove(email);
  const wasActive = manager?.activeKey() === keyOf(profile);
  profiles.splice(profiles.indexOf(profile), 1);
  seenEmails.delete(email);
  unread.forget(keyOf(profile));
  for (const surface of SURFACES) manager?.discardView(keyOf(profile), surface);
  pushProfiles();
  pushUnread();
  refreshBadge();
  startMailSync();
  if (wasActive) {
    const next = profiles.find((p) => surfacesForRef(p.ref).includes('mail'));
    if (next) showAccount(next.ref, 'mail');
    else pushActive();
  }
}


//===========================
// Helper functions
//===========================

/**
 * Revokes an unlinked account's grant and records what Google said
 *
 * @param email
 * @param refreshToken
 * @private
 */
async function reportRevoke(email: string, refreshToken: string): Promise<void> {
  const outcome = await revokeRefreshToken(refreshToken);
  if (outcome.ok) return;
  if (outcome.alreadyGone) return;
  console.warn(`[oauth] could not revoke the grant for ${email}: ${outcome.error}`);
}
