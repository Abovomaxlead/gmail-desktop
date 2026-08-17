// Decides whether a notification may show at all, whether it must be silent, and whether it
// stays up until dismissed. Pure, so it is testable without Electron.
//
// The master switches are checked before the per-account flags; only the mail surface
// honours a per-account toggle, and pushCovered means the API already notifies.
import type { NotificationPrefs, Prefs, QuietHours } from '../core/prefs-store';
import { surfacesForRef, type Surface } from '../../renderer/lib/surfaces';
import type { AccountRef } from '../../renderer/lib/account-ref';



//===========================
// Exported functions
//===========================

/**
 * Whether a moment falls inside the quiet-hours window
 *
 * @param start "HH:MM"
 * @param end "HH:MM"
 * @param minutes minutes since midnight
 * @returns true inside the window, which may wrap past midnight
 */
export function inQuietHours(start: string, end: string, minutes: number): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e;
}

// The master switches (sound, googleApps) are checked before the per-account flags, and
// only the mail surface honours a per-account toggle.

/**
 * Whether a notification may show at all
 *
 * @param prefs
 * @param email
 * @param now
 * @param surface
 * @param pushCovered the API already notifies, so the webview must stay quiet
 * @returns true when the notification may be raised
 */
export function notificationsAllowed(
  prefs: Prefs,
  email: string,
  now: Date,
  surface: Surface = 'mail',
  pushCovered = false,
): boolean {
  const { dnd, dndUntil, quietHours } = prefs.notifications;
  if (dnd) return false;
  if (dndUntil && now.getTime() < dndUntil) return false;
  if (
    quietHours.enabled &&
    inQuietHours(quietHours.start, quietHours.end, now.getHours() * 60 + now.getMinutes())
  ) {
    return false;
  }
  const account = prefs.accounts[email];
  if (surface === 'calendar') {
    return prefs.notifications.googleApps !== false && account?.calendarNotify === true;
  }
  if (surface !== 'mail') return false;
  if (pushCovered) return false;
  return account?.notify !== false;
}

/**
 * Chromium's own permission answer for the Google session
 *
 * @param permission
 * @returns false for notifications, true for everything else
 */
export function sessionPermissionAllowed(permission: string): boolean {
  return permission !== 'notifications';
}

/**
 * Folds the panel's two fields onto the stored notification preferences
 *
 * ...current comes first, or the panel wipes the sound and content fields it knows
 * nothing about. A running dndUntil clears only when dnd itself is flipped.
 *
 * @param current
 * @param panel
 * @returns the preferences to store
 */
export function mergeNotificationsFromPanel(
  current: NotificationPrefs,
  panel: { dnd: boolean; quietHours: QuietHours },
): NotificationPrefs {
  return {
    ...current,
    ...panel,
    dndUntil: panel.dnd === current.dnd ? current.dndUntil : undefined,
  };
}

/**
 * Whether a notification must be raised without sound
 *
 * @param prefs
 * @param email
 * @param surface
 * @returns true when it must stay silent
 */
export function notificationSilent(
  prefs: Prefs,
  email: string,
  surface: Surface = 'mail',
): boolean {
  if (prefs.notifications.sound === false) return true;
  if (surface !== 'mail') return false;
  return prefs.accounts[email]?.notifySound === false;
}

/**
 * Whether an account's cards stay up until dismissed
 *
 * @param prefs
 * @param email
 * @returns true to stay, false for a card that fades
 */
export function notificationPersist(prefs: Prefs, email: string): boolean {
  return prefs.accounts[email]?.notifyPersist === true;
}

/**
 * Whether an account needs a calendar view kept alive to notify from
 *
 * @param prefs
 * @param email
 * @param ref
 * @returns true when the account both wants it and can have it
 */
export function wantsCalendarView(prefs: Prefs, email: string, ref: AccountRef): boolean {
  if (prefs.accounts[email]?.calendarNotify !== true) return false;
  return surfacesForRef(ref).includes('calendar');
}


//===========================
// Helper functions
//===========================

/**
 * Converts "HH:MM" to minutes since midnight
 *
 * @param hhmm
 * @returns the minutes
 * @private
 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
