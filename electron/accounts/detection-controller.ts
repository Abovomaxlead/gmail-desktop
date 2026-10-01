// Finding out which Google accounts this browser session is signed into.
//
// No API lists them, so they are probed: a mail view is opened at /mail/u/0, /u/1 and so on
// until detection-planner says to stop. Index 0 is exempt from the probe timeout, since
// giving up on it would leave the app showing nothing at all.

import { pushActive, pushHidden, pushProfiles, pushUnread, refreshBadge } from '../core/broadcast';
import { SESSION_PARTITION } from '../core/session-partition';
import { accountCache, authIdx, authRef, colors, delegated, currentLocale, hidden, history, keyOf, keyOfIndex, mainWindow, manager, oauthTokens, prefs, profiles, setCachedAccounts, unread } from '../core/runtime';
import {
  showAccount,
  syncCalendarViews,
  trimViewsToVisible,
  warmAccount,
} from '../windows/view-surfaces';
import { refreshNotifyAllowed, playNotificationSound } from '../notify/notify-gating';
import { showToast } from '../toast/toast-presenter';
import { startMailSync, stopMailboxSync } from '../push/mail-sync-controller';
import { addDelegatedMailboxes, maybeStartDelegatedApiScan } from '../delegation/delegated-controller';
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

// bumped by redetect()/addAccount() so a walk started before it can tell it has been
// superseded and must abandon instead of touching this walk's bookkeeping
let runToken = 0;

let visibleProbe: number | null = null;

// The indexes whose consent screen is up. The page keeps polling its identity every second,
// and a report accepted while consent is pending would register the account behind it.
const consentPending = new Set<number>();


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
  consentPending.clear();
  // A new walk invalidates the last one: a consent continuation still awaiting the user
  // sees its captured token go stale and abandons instead of clobbering this walk.
  runToken += 1;
  const maxIndex = profiles.length ? Math.max(...profiles.map((p) => authIdx(p))) : -1;
  probe(maxIndex + 1, runToken);
}

export function addAccount(): void {
  clearProbeTimer();
  if (probingIndex !== null && !profiles.some((p) => authIdx(p) === probingIndex)) {
    manager?.discardView(keyOfIndex(probingIndex), 'mail');
  }
  runToken += 1;
  consentPending.clear();
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

function probe(index: number, token: number): void {
  if (token !== runToken) return;
  probingIndex = index;
  manager?.ensureView(authRef(index), 'mail', false);
  clearProbeTimer();
  if (index > 0) {
    probeTimer = setTimeout(() => {
      if (token !== runToken) return;
      manager?.discardView(keyOfIndex(index), 'mail');
      probeTimer = null;
      settleDetection();
    }, PROBE_TIMEOUT_MS);
  }
}

export function onIdentity(index: number, identity: { email: string; name: string; avatarUrl: string }): void {
  if (consentPending.has(index)) return;
  if (profiles.some((p) => authIdx(p) === index)) return;

  const isVisibleAdd = visibleProbe === index;
  const token = runToken;

  const decision = planNext([...seenEmails], index, identity);
  clearProbeTimer();
  probingIndex = null;
  if (decision.register && identity.email) {
    if (isVisibleAdd) {
      visibleProbe = null;
      // Asking for an account by name outranks having waved it away: the + button is how a
      // hidden own account comes back, and it must not be gated on the list below.
      hidden?.remove(identity.email);
      consentPending.add(index);
      void addAccountAfterConsent(index, identity, decision.stop, token);
      return;
    }
    // Found again, as it will be at every launch: no API lists the signed-in accounts, so the
    // probe cannot be told to skip an index. Seen, so the planner still recognises a repeat and
    // knows where the list ends; never registered, so it draws no row.
    if (hidden?.has(identity.email)) {
      seenEmails.add(identity.email);
      manager?.discardView(keyOfIndex(index), 'mail');
    } else {
      registerAccount(index, identity);
      if (manager?.activeKey() == null) {
        switchSurface(index, 'mail');
      }
    }
  } else if (index > 0) {
    manager?.discardView(keyOfIndex(index), 'mail');
    if (isVisibleAdd) {
      visibleProbe = null;
      if (profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    }
  }
  if (!decision.stop) probe(index + 1, token);
  else if (identity.email) settleDetection();
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
  // A view that loaded before this account registered stopped asking after fifteen tries;
  // this is the push that lets drag-to-save arrive once the answer is finally knowable.
  manager?.pushMailDropAllowed(keyOf(profile));
  refreshNotifyAllowed();
  startMailSync();
  syncCalendarViews();
  warmAccount(profile);
}

async function addAccountAfterConsent(
  index: number,
  identity: { email: string; name: string; avatarUrl: string },
  stopProbing: boolean,
  token: number,
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
    // The screen is gone either way, so the page's identity polls count again from here
    consentPending.delete(index);
    // A redetect() during the wait for consent started a new walk; this chain's captured
    // token is stale and it must not touch that walk's probingIndex or timer.
    if (token !== runToken) return;
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
      if (!stopProbing) probe(index + 1, token);
      else settleDetection();
      return;
    }
  }

  consentPending.delete(index);
  registerAccount(index, identity);
  switchSurface(index, 'mail');
  if (!stopProbing) probe(index + 1, token);
  else settleDetection();
}

export function removeAccount(email: string): void {
  // Remembered before anything else is undone, because both discovery paths keep running: the
  // probe finds a signed-in account again at the next launch, and the relay names a delegation
  // again the moment it is asked. This list is the only thing that makes a removal outlast the
  // session it happened in. A row that is already gone reads as an own account -- the delegated
  // half is prunable and would be dropped again by the first scan.
  const profile = profiles.find((p) => p.email === email);
  hidden?.add(email, profile?.kind === 'delegated' ? 'delegated' : 'authuser');
  pushHidden();
  accountCache?.remove(email);
  const doomed = oauthTokens?.get(email);
  if (doomed?.accessToken) void stopWatch(doomed.accessToken).catch(() => undefined);
  history?.remove(email);
  stopMailboxSync(email);
  oauthTokens?.remove(email);
  // Deleting our copy leaves the grant standing at Google, so a refresh token that leaked
  // before the unlink would keep working. Told separately, and never waited on: unlinking is
  // a local act and must finish with the network down.
  if (doomed?.refreshToken) void reportRevoke(email, doomed.refreshToken).catch(() => undefined);
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

/**
 * Lets a mailbox be found again, and goes looking for it where that is possible
 *
 * The two halves differ in how soon it comes back. A delegation can be asked for on the spot,
 * so the row returns within seconds. An own account cannot: the probe walks /mail/u/0 upward
 * from an empty list, and once accounts hold the indexes below it there is no way back into
 * that walk -- so it returns at the next start, which is what the line under the list says.
 *
 * @param email
 */
export function unhideAccount(email: string): void {
  const entry = hidden?.list().find((h) => h.email === email.trim().toLowerCase());
  if (!entry) return;
  hidden?.remove(entry.email);
  pushHidden();
  // Unhiding is a person asking for the row back, which is the one other place a delegated
  // mailbox may be added; the hourly relay sweep takes it away again if it is not theirs.
  if (entry.kind === 'delegated') addDelegatedMailboxes([entry.email]);
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
