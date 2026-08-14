// Finding out which Google accounts this browser session is signed into, and keeping the
// list current.
//
// Google serves accounts at /mail/u/0, /u/1 and so on, and there is no API that lists them.
// So they are probed: a mail view is opened at each index in turn and the page is asked who
// it belongs to. detection-planner.ts decides what each answer means -- a new account, a
// repeat, or the end of the list -- and this drives the walk.
//
// A probe that never answers is why there is a timeout. Index 0 is exempt: it always exists,
// and giving up on it would leave the app showing nothing at all.
//
// accounts.json is never written empty, because empty usually means detection has confirmed
// nothing yet rather than that there is nothing -- see broadcast.saveAccountCache.

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
  removed,
  setCachedAccounts,
  syncRunners,
  unread,
} from '../core/runtime';
import { showAccount, syncCalendarViews, warmAccount } from '../windows/view-surfaces';
import { refreshNotifyAllowed, playNotificationSound } from '../notify/notify-gating';
import { showToast } from '../toast/toast-presenter';
import { startMailSync } from '../push/mail-sync-controller';
import { maybeStartDelegatedApiScan } from '../delegation/delegated-controller';
import { connectAccount } from '../auth/oauth-flow';
import { isAllowedAccount } from '../auth/account-domain';
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

/** Addresses already seen this run, so the planner can tell a new account from a repeat of
 * one Google served under a higher authuser index. */
const seenEmails = new Set<string>();

let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probingIndex: number | null = null;

/** Set when the probe is one the user started from the + menu, which is visible and asks for
 * consent rather than running quietly. */
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

  const email = identity?.email;
  const isVisibleAdd = visibleProbe === index;

  if (isVisibleAdd && email && removed!.has(email)) removed!.remove(email);

  if (!isVisibleAdd && email && removed!.has(email)) {
    clearProbeTimer();
    probingIndex = null;
    manager?.discardView(keyOfIndex(index), 'mail');
    if (manager?.activeKey() == null && profiles[0]) switchSurface(authIdx(profiles[0]), 'mail');
    probe(index + 1);
    return;
  }

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
  // An address outside the work domain is added without ever being asked for consent. Asking
  // and being refused would land in the branch below, which throws the view away — so a
  // private mailbox someone signed into would not be readable here at all. It is readable;
  // it is only never linked to the API.
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
  removed!.add(email);
  accountCache?.remove(email);
  const stopToken = oauthTokens?.get(email)?.accessToken;
  if (stopToken) void stopWatch(stopToken).catch(() => undefined);
  history?.remove(email);
  coverage.forget(email);
  syncRunners.delete(email);
  oauthTokens?.remove(email);
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
  // profiles[0] is not necessarily openable: authIdx returns -1 for every delegated
  // profile, so a mailbox known only by address (no mailUrl yet) sorts ahead of every
  // authuser account and would otherwise be handed to showAccount, which now refuses it —
  // leaving the window showing nothing at all where a removal used to always land on
  // something. Pick the first profile that actually has a mail surface instead.
  if (wasActive) {
    const next = profiles.find((p) => surfacesForRef(p.ref).includes('mail'));
    if (next) showAccount(next.ref, 'mail');
    // Nothing left to show. Say so, or the bar keeps the tab that was just removed lit.
    else pushActive();
  }
}
