// Decides whether a notification may show at all, whether it must be silent, and
// whether it stays up until dismissed. Pure, so it is testable without Electron.
// The master switches (sound, googleApps) are checked before the per-account flags;
// only the mail surface honours a per-account toggle, and pushCovered means the API
// already notifies so the webview must stay quiet. In mergeNotificationsFromPanel
// ...current must come first: the panel knows only dnd and quietHours and would
// otherwise wipe the sound and content fields, and a running dndUntil is cleared
// only when dnd itself is flipped, never when the quiet hours change.
import type { NotificationPrefs, Prefs, QuietHours } from './prefs-store';
import { surfacesForRef, type Surface } from '../renderer/lib/surfaces';
import type { AccountRef } from '../renderer/lib/account-ref';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inQuietHours(start: string, end: string, minutes: number): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e;
}

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

export function notificationSilent(
  prefs: Prefs,
  email: string,
  surface: Surface = 'mail',
): boolean {
  if (prefs.notifications.sound === false) return true;
  if (surface !== 'mail') return false;
  return prefs.accounts[email]?.notifySound === false;
}

// Our own notifications stay on screen until they are dismissed; this switch is how an
// account opts out of that and gets a card that fades instead. It reads `!== false`
// rather than `=== true` because staying is the default, and a prefs file written before
// this existed has no opinion to honour.
export function notificationPersist(prefs: Prefs, email: string): boolean {
  return prefs.accounts[email]?.notifyPersist !== false;
}

export function wantsCalendarView(prefs: Prefs, email: string, ref: AccountRef): boolean {
  if (prefs.accounts[email]?.calendarNotify !== true) return false;
  return surfacesForRef(ref).includes('calendar');
}
