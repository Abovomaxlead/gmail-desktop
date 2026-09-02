// Which account and surface the window is showing, and the two background jobs that keep
// the other views usable: warming a mail view that has never been on screen, and adding or
// dropping calendar views as the settings change.
//
// The warm-up exists because a view left at setVisible(false) counts as occluded, and Gmail
// then never builds its message list — so an account switched to for the first time would
// sit empty for a moment. Warming shows it just long enough for the page to do that work.
// view-warmup.ts decides when it has, by watching the title.

import { pushActive } from '../core/broadcast';
import { keyOf, manager, prefs, profiles } from '../core/runtime';
import { refreshNotifyAllowed } from '../notify/notify-gating';
import { flushPendingMailto } from '../compose/mailto-controller';
import { wantsCalendarView } from '../notify/notification-policy';
import { WarmupTracker } from './view-warmup';
import { mayBuildAheadOfDemand, viewsToDiscard } from './view-budget';
import type { AccountRef } from '../accounts/account-ref';
import type { Profile, Surface } from './profile-view-manager';


//===========================
// Module state
//===========================

const warmup = new WarmupTracker();
let warmupTimer: ReturnType<typeof setInterval> | null = null;


//===========================
// Exported functions
//===========================

export function showAccount(ref: AccountRef, surface: Surface): void {
  manager?.show(ref, surface);
  trimViewsToVisible();
  pushActive();
  refreshNotifyAllowed();
  flushPendingMailto();
}

/**
 * Builds a mail view off-screen so it is ready the first time it is switched to
 *
 * Skipped for a view already showing, and for one already warming.
 *
 * @param profile
 */
export function warmAccount(profile: Profile): void {
  if (!manager) return;
  if (!mayBuildAheadOfDemand(lowMemory())) return;
  const key = keyOf(profile);
  if (manager.isShowing(key, 'mail')) return;
  if (!warmup.begin(key, Date.now())) return;
  manager.warm(profile.ref, 'mail');
  if (!warmupTimer) warmupTimer = setInterval(tickWarmup, 1000);
}

/**
 * Adds a calendar view for every account that wants one and drops the rest
 *
 * A calendar currently on screen is left alone, however the setting reads.
 */
export function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled =
      mayBuildAheadOfDemand(lowMemory()) &&
      wantsCalendarView(prefs.getAll(), profile.email, profile.ref);
    if (enabled) {
      manager.ensureView(profile.ref, 'calendar', false);
    } else if (!manager.isShowing(keyOf(profile), 'calendar')) {
      manager.discardView(keyOf(profile), 'calendar');
    }
  }
  refreshNotifyAllowed();
}


/**
 * Brings the live views into line with the low-memory setting
 *
 * Called when the setting changes, so the switch acts at once: turning it on throws away
 * everything but the mailbox on screen, turning it off warms the others back up.
 */
export function applyViewBudget(): void {
  if (!manager) return;
  if (lowMemory()) {
    trimViewsToVisible();
    syncCalendarViews();
    return;
  }
  syncCalendarViews();
  for (const profile of profiles) warmAccount(profile);
}


/**
 * Throws away every view except the one on screen
 *
 * Does nothing unless the setting is on. A discarded view takes its unread count with it --
 * discardView reports zero -- which the API puts back for the accounts it covers and cannot
 * put back for the others. That is the trade the setting spells out.
 */
export function trimViewsToVisible(): void {
  if (!manager || !lowMemory()) return;
  // Only views belonging to a registered account may be swept. Detection and the add-account
  // flow open views for an index that has not become a profile yet, and throwing one of those
  // away mid-flight would abandon the probe or the consent page.
  const registered = new Set(profiles.map((p) => keyOf(p)));
  const live = manager.liveViewIds().filter((v) => registered.has(v.accountKey));
  for (const view of viewsToDiscard({ live, active: manager.activeViewId() })) {
    manager.discardView(view.accountKey, view.surface);
  }
}


//===========================
// Helper functions
//===========================

/**
 * Whether the user asked for the smaller memory footprint
 *
 * @private
 */
function lowMemory(): boolean {
  return prefs?.getAll().advanced.lowMemory === true;
}


/** Stops the timer once nothing is warming, so an idle app is not waking every second. */
function tickWarmup(): void {
  const now = Date.now();
  for (const key of warmup.pending()) {
    if (warmup.verdict(key, manager?.titleOf(key, 'mail') ?? null, now) !== 'cool') continue;
    manager?.cool(key, 'mail');
    warmup.finish(key);
  }
  if (warmup.pending().length === 0 && warmupTimer) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
}
