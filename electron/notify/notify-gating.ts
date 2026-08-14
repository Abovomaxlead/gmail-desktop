// What each Gmail view is allowed to raise, and the sound and privacy replacements that go
// with it. notification-policy.ts holds the decisions; this is where they are applied and
// pushed into the views.
//
// The push into the views is the part that matters. A mail view told to keep quiet raises
// nothing at all, which from the outside is indistinguishable from mail not arriving — so
// every change of that answer is written to notify.log, and only the changes, because this
// runs every minute for every account and every surface.

import { IPC } from '../core/ipc';
import { pushUnread, pushPrefs, refreshBadge } from '../core/broadcast';
import {
  coverage,
  keyOf,
  mainWindow,
  manager,
  prefs,
  profiles,
  unread,
} from '../core/runtime';
import { notificationsAllowed, notificationSilent } from './notification-policy';
import { notifyLog } from './notify-log';
import { SURFACES } from '../../renderer/lib/surfaces';
import { soundNameOrDefault } from '../../renderer/lib/notification-sound';
import type { Prefs } from '../core/prefs-store';


//===========================
// Types
//===========================

/** The one thing this needs from above it. Kept a hook rather than an import so nothing in
 * here points up the stack: the tray menu, the update flow and the download notifications
 * all reach down for playNotificationSound, and an import back to the tray would close a
 * loop through all three. */
export interface NotifyGatingHooks {
  /** A timed snooze ran out, so whatever draws its state should redraw. */
  onDndCleared(): void;
}


//===========================
// Constants
//===========================

const NOTIFY_HIDDEN_SENDER = 'New email';
const NOTIFY_HIDDEN_SUBJECT = 'You have new mail.';

/** Long enough that a burst of arrivals is one sound rather than a chord. */
const SOUND_GAP_MS = 1500;


//===========================
// Module state
//===========================

let hooks: NotifyGatingHooks = { onDndCleared: () => {} };

let lastSoundAt = 0;
let notifyTimer: ReturnType<typeof setInterval> | null = null;

/** What each mail view was last told, so the log line is written on a change and not on
 * every tick of the minute timer. */
const notifyAllowedLast = new Map<string, boolean>();


//===========================
// Exported functions
//===========================

export function setNotifyGatingHooks(h: NotifyGatingHooks): void {
  hooks = h;
}

export function playNotificationSound(p: Prefs): void {
  if (p.notifications.sound === false) return;
  const name = soundNameOrDefault(p.notifications.soundName);
  const now = Date.now();
  if (now - lastSoundAt < SOUND_GAP_MS) return;
  lastSoundAt = now;
  mainWindow?.webContents.send(IPC.NOTIFY_SOUND_PLAY, { name, volume: p.notifications.volume });
}

/** Lets a deliberate test be heard even if something just sounded. Whether it may sound at
 * all stays playNotificationSound's decision. */
export function resetSoundThrottle(): void {
  lastSoundAt = 0;
}

/** The stand-in text for whichever of sender and subject the privacy settings hide. */
export function hiddenNotificationText(p: Prefs): {
  hiddenSender?: string;
  hiddenSubject?: string;
} {
  return {
    ...(p.notifications.showSender === false ? { hiddenSender: NOTIFY_HIDDEN_SENDER } : {}),
    ...(p.notifications.showSubject === false ? { hiddenSubject: NOTIFY_HIDDEN_SUBJECT } : {}),
  };
}

export function refreshNotifyAllowed(): void {
  if (!prefs) return;
  let p = prefs.getAll();
  const now = new Date();
  if (p.notifications.dndUntil && now.getTime() >= p.notifications.dndUntil) {
    prefs.setNotifications({ ...p.notifications, dndUntil: undefined });
    p = prefs.getAll();
    pushPrefs();
    hooks.onDndCleared();
  }
  for (const profile of profiles) {
    for (const surface of SURFACES) {
      const show = notificationsAllowed(p, profile.email, now, surface, coverage.has(profile.email));
      // Only mail, and only when it changes: this runs every minute for every account and
      // every surface, and a log that repeats the same thing sixty times an hour hides the
      // line that matters.
      if (surface === 'mail' && notifyAllowedLast.get(profile.email) !== show) {
        notifyAllowedLast.set(profile.email, show);
        notifyLog(
          `[notify] mail view for ${profile.email} may notify: ${show}` +
            (show
              ? ''
              : ` (dnd=${p.notifications.dnd} quiet=${p.notifications.quietHours.enabled} account=${p.accounts[profile.email]?.notify !== false} push=${coverage.has(profile.email)})`),
        );
      }
      manager?.pushNotifyAllowed(keyOf(profile), surface, {
        show,
        silent: notificationSilent(p, profile.email, surface),
      });
    }
  }
}

export function startNotifyTimer(): void {
  if (notifyTimer) return;
  notifyTimer = setInterval(refreshNotifyAllowed, 60_000);
}

/**
 * The inbox count as the API counts it, used only for an account the relay delivers for.
 *
 * The gate looks like a leftover — push covers no account while RELAY_PUSH_ENABLED is false,
 * so this count is fetched every five minutes and dropped every time — and it stays, because
 * the two sources do not count the same mailbox. labels/INBOX/threadsUnread counts every
 * unread conversation in the inbox; the page title counts the tab Gmail is showing, which
 * with categories on is Primary alone. Letting both write would swap the badge between two
 * numbers every five minutes. The title is the one that matches what Gmail itself puts on
 * screen, so it stays the source, and preload.ts is where it was made to read the inbox
 * rather than whatever label is open.
 */
export function reportApiUnread(email: string, count: number | null): void {
  if (count === null) return;
  if (!coverage.has(email)) return;
  const profile = profiles.find((p) => p.email === email);
  if (!profile) return;
  unread.report(keyOf(profile), count);
  pushUnread();
  refreshBadge();
}
