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
  pushActive();
  refreshNotifyAllowed();
  flushPendingMailto();
}

/** Builds a mail view off-screen so it is ready the first time it is switched to. Skipped
 * for a view already showing, and for one already warming. */
export function warmAccount(profile: Profile): void {
  if (!manager) return;
  const key = keyOf(profile);
  if (manager.isShowing(key, 'mail')) return;
  if (!warmup.begin(key, Date.now())) return;
  manager.warm(profile.ref, 'mail');
  if (!warmupTimer) warmupTimer = setInterval(tickWarmup, 1000);
}

/** Adds a calendar view for every account that wants one and drops the rest. A calendar
 * currently on screen is left alone, however the setting reads. */
export function syncCalendarViews(): void {
  if (!prefs || !manager) return;
  for (const profile of profiles) {
    const enabled = wantsCalendarView(prefs.getAll(), profile.email, profile.ref);
    if (enabled) {
      manager.ensureView(profile.ref, 'calendar', false);
    } else if (!manager.isShowing(keyOf(profile), 'calendar')) {
      manager.discardView(keyOf(profile), 'calendar');
    }
  }
  refreshNotifyAllowed();
}


//===========================
// Helper functions
//===========================

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
